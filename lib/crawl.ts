// Shallow follow: fetch the most relevant nested links to give the AI context
// beyond the current page, while keeping prompt cost under control.
//
// KEY MECHANISM: the fetch is same-origin with `credentials: 'include'`, so it
// reuses whatever session the browser already has for this origin. On the real
// Runway KB that is the agent's SSO session: no separate credentials.
import type { KbLink, KbPage } from './outcome';
import { extractPageText, hasRenderedContent } from './extract';
import { matchedKeywords, normalize, unique, wordsOf } from './text';
import { INTENT_ALIASES, expandQueryTerms } from './kb-vocab';
import { kbIndexAsLinks } from './kb-index';
import { linkIdentity } from './site-profile';

export const MAX_FOLLOW = 3;
const MIN_SELECTED_SCORE = 5;
const STRONG_SINGLE_SCORE = 13;
const SECONDARY_RATIO = 0.58;

/**
 * Dimensione della shortlist ampia inviata al reranker AI (`shortlistCandidates`).
 * Volutamente larga: il prefiltro locale deve solo GARANTIRE che l'articolo giusto
 * sia presente (recall), non sceglierlo. Rivedibile in base a recall@shortlist
 * misurato dall'harness di valutazione (Fase 5).
 */
export const SHORTLIST_SIZE = 30;

const GENERIC_LINK_WORDS = new Set([
  'overview',
  'introduction',
  'general',
  'details',
  'history',
  'external',
  'references',
  'notes',
  'edit',
  'source',
  'category',
  'help',
]);

function slugText(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname).replace(/[_/-]+/g, ' ');
  } catch {
    return url;
  }
}

function queryConcepts(query: string): string[] {
  const haystack = normalize(query).replace(/[^a-z0-9]+/g, ' ');
  return Object.entries(INTENT_ALIASES)
    .filter(([, aliases]) => aliases.some((alias) => haystack.includes(normalize(alias))))
    .map(([concept]) => concept);
}

function conceptMatches(text: string, concepts: string[]): string[] {
  const haystack = normalize(text).replace(/[^a-z0-9]+/g, ' ');
  return concepts.filter((concept) =>
    INTENT_ALIASES[concept].some((alias) => haystack.includes(normalize(alias))),
  );
}

function exactPhraseBoost(link: KbLink, query: string): number {
  const cleanQuery = normalize(query).replace(/\s+/g, ' ').trim();
  if (cleanQuery.length < 8) return 0;
  const haystack = normalize([link.text, slugText(link.url), link.context ?? ''].join(' '));
  return haystack.includes(cleanQuery) ? 8 : 0;
}

function genericPenalty(link: KbLink): number {
  const words = wordsOf(`${link.text} ${slugText(link.url)}`);
  const genericHits = words.filter((word) => GENERIC_LINK_WORDS.has(word)).length;
  const shortLabelPenalty = link.text.trim().length < 4 ? 2 : 0;
  return genericHits * 2 + shortLabelPenalty;
}

/** Relevance score from link label, URL slug, nearby context and phrase match. */
function scoreLink(
  link: KbLink,
  keywords: string[],
  query: string,
): { score: number; reason: string; matched: string[] } {
  const concepts = queryConcepts(query);
  const combinedText = [link.text, slugText(link.url), link.context ?? ''].join(' ');
  const labelMatches = matchedKeywords(link.text, keywords);
  const slugMatches = matchedKeywords(slugText(link.url), keywords);
  const contextMatches = matchedKeywords(link.context ?? '', keywords);
  const conceptHits = conceptMatches(combinedText, concepts);
  const phrase = exactPhraseBoost(link, query);
  const penalty = genericPenalty(link);
  const score =
    labelMatches.length * 5 +
    slugMatches.length * 3 +
    contextMatches.length * 1.5 +
    conceptHits.length * 3 +
    phrase -
    penalty;
  const matched = unique([...labelMatches, ...slugMatches, ...contextMatches, ...conceptHits]);
  const reason = [
    labelMatches.length ? `${labelMatches.length} hit testo` : '',
    slugMatches.length ? `${slugMatches.length} hit URL` : '',
    contextMatches.length ? `${contextMatches.length} hit contesto` : '',
    conceptHits.length ? `${conceptHits.join('+')} intent` : '',
    phrase ? 'frase query vicina' : '',
    penalty ? `-${penalty} generico` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return { score, reason: reason || 'nessuna corrispondenza', matched };
}

function dynamicSelection(
  scored: Array<{ link: KbLink; score: number; order: number }>,
  max: number,
): KbLink[] {
  const ranked = scored
    .filter((x) => x.score >= MIN_SELECTED_SCORE)
    .sort((a, b) => b.score - a.score || a.order - b.order || a.link.url.localeCompare(b.link.url));

  const best = ranked[0];
  if (!best) return [];
  if (best.score >= STRONG_SINGLE_SCORE) return [best.link];

  const minimumRelativeScore = best.score * SECONDARY_RATIO;
  return ranked
    .filter((x) => x.score >= minimumRelativeScore)
    .slice(0, max)
    .map((x) => x.link);
}

/**
 * Scora OGNI link (senza tagli) e ritorna i link arricchiti con
 * score/reason/matchedKeywords + l'ordine per il tie-break. Choke-point unico
 * dello scoring: sia `pickRelevantLinks` (con `dynamicSelection`) sia
 * `shortlistCandidates` (senza gating) partono da qui, così non esiste una
 * seconda logica di rilevanza da tenere allineata.
 */
function scoreAll(
  links: KbLink[],
  query: string,
): Array<{ link: KbLink; score: number; order: number }> {
  const base = wordsOf(query);
  if (!base.length) return [];
  // E3 · espansione cross-lingua: aggiunge i termini EN dei concetti colpiti
  // dalla query (anche via alias IT), così label/slug inglesi matchano una
  // query italiana. I concetti restano gestiti a parte in scoreLink.
  const kws = unique([...base, ...expandQueryTerms(query, base)]);
  return links.map((link, fallbackOrder) => {
    const result = scoreLink(link, kws, query);
    return {
      link: {
        ...link,
        score: Number(result.score.toFixed(2)),
        reason: result.reason,
        matchedKeywords: result.matched,
      },
      score: result.score,
      order: link.order ?? fallbackOrder,
    };
  });
}

/** Pick the top relevant links, dynamically narrowing weak candidates. */
export function pickRelevantLinks(links: KbLink[], query: string, max = MAX_FOLLOW): KbLink[] {
  return dynamicSelection(scoreAll(links, query), max);
}

/**
 * E4 · Candidati KB-wide a costo-token zero. `pickRelevantLinks` vede solo i
 * link presenti nel DOM della pagina corrente; qui uniamo quei link con l'INTERO
 * indice della KB (asset statico, consultato in locale) e li ordiniamo insieme
 * con lo stesso scorer. Così l'articolo giusto emerge anche se non è linkato
 * dalla pagina — senza alcun costo per l'AI (nessun corpo viene letto qui).
 *
 * I candidati dell'indice si deduplicano contro i link di pagina per identità
 * canonica: un articolo già presente nella pagina non viene proposto due volte
 * (e conserva il `context` reale del DOM, che l'indice non ha).
 */
export function pickCandidatesWithKbIndex(
  pageLinks: KbLink[],
  query: string,
  max = MAX_FOLLOW,
): KbLink[] {
  const index = kbIndexAsLinks();
  if (!index.length) return pickRelevantLinks(pageLinks, query, max);

  const pageIds = new Set(pageLinks.map((l) => identityOf(l.url)));
  const indexOnly = index.filter((l) => !pageIds.has(identityOf(l.url)));
  // I link di pagina vengono per primi: a parità di score, il loro `order`
  // reale (e il tie-break su URL) li tiene stabili rispetto ai sintetici.
  return pickRelevantLinks([...pageLinks, ...indexOnly], query, max);
}

function identityOf(url: string): string {
  try {
    return linkIdentity(new URL(url));
  } catch {
    return url;
  }
}

/**
 * Shortlist AMPIA per il reranker AI: fonde i link di pagina con l'intero indice
 * KB (dedup per identità come `pickCandidatesWithKbIndex`), scora tutto e ritorna
 * i primi `max` con score > 0 — **senza** i gate di `dynamicSelection`
 * (niente `STRONG_SINGLE`, `SECONDARY_RATIO` o soglia `MIN_SELECTED_SCORE`). Un
 * articolo debolmente pertinente ma corretto deve restare in lista: è il prefiltro
 * a garantire il recall, la selezione fine la fa l'Aty a valle. I candidati sono
 * arricchiti (score/reason/matchedKeywords) così chi legge può fidarsi.
 */
export function shortlistCandidates(
  pageLinks: KbLink[],
  query: string,
  max = SHORTLIST_SIZE,
): KbLink[] {
  const index = kbIndexAsLinks();
  const pageIds = new Set(pageLinks.map((l) => identityOf(l.url)));
  const indexOnly = index.filter((l) => !pageIds.has(identityOf(l.url)));
  return scoreAll([...pageLinks, ...indexOnly], query)
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order || a.link.url.localeCompare(b.link.url))
    .slice(0, max)
    .map((x) => x.link);
}

/**
 * Traduce gli URL scelti dal reranker (già filtrati anti-allucinazione dal
 * backend) nei `KbLink` arricchiti della shortlist, per identità e in ordine.
 * Se la selezione è vuota o nessun URL corrisponde alla shortlist → `localFallback`
 * (la selezione locale di oggi): il rerank non è mai peggio del comportamento
 * attuale. Puro: testabile senza rete né React.
 */
export function resolveFollowLinks(
  shortlist: KbLink[],
  selectedUrls: string[],
  localFallback: KbLink[],
): KbLink[] {
  if (!selectedUrls.length) return localFallback;
  const byIdentity = new Map(shortlist.map((l) => [identityOf(l.url), l] as const));
  const seen = new Set<string>();
  const out: KbLink[] = [];
  for (const url of selectedUrls) {
    const id = identityOf(url);
    const link = byIdentity.get(id);
    if (!link || seen.has(id)) continue;
    seen.add(id);
    out.push(link);
  }
  return out.length ? out : localFallback;
}

/** Fetch one same-origin page reusing the current session and extract its text. */
async function fetchPage(link: KbLink, query: string): Promise<KbPage | null> {
  try {
    const res = await fetch(link.url, { credentials: 'include' });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Pagina client-rendered (es. Salesforce Aura): il fetch vede solo lo
    // shell, senza il testo dell'articolo. La scarto invece di inviare una
    // pagina vuota all'AI (token sprecati + risposta peggiore).
    if (!hasRenderedContent(doc)) {
      console.warn(
        `[rs] pagina client-rendered senza contenuto nell'HTML grezzo, la salto: ${link.url}`,
      );
      return null;
    }
    return {
      url: link.url,
      title: doc.title || link.text,
      text: extractPageText(doc, query),
      origin: 'followed',
    };
  } catch (e) {
    // Rende distinguibile un guasto di rete/sessione da una pagina scartata
    // perché non rilevante: prima questo errore era completamente muto.
    console.warn(`[rs] fetch della pagina collegata fallita (${link.url}):`, e);
    return null;
  }
}

/**
 * Follow relevant links (in parallel) and return the pages that loaded.
 * Failures are skipped silently: the current page is still usable.
 */
export async function shallowFollow(
  links: KbLink[],
  query: string,
  max = MAX_FOLLOW,
): Promise<KbPage[]> {
  const chosen =
    links.length <= max && links.every((link) => typeof link.score === 'number')
      ? links
      : pickRelevantLinks(links, query, max);
  const results = await Promise.all(chosen.map((link) => fetchPage(link, query)));
  return results.filter((p): p is KbPage => p !== null);
}
