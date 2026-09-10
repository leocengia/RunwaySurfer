// Shallow follow: fetch the most relevant nested links to give the AI context
// beyond the current page, while keeping prompt cost under control.
//
// KEY MECHANISM: the fetch is same-origin with `credentials: 'include'`, so it
// reuses whatever session the browser already has for this origin. On the real
// Runway KB that is the agent's SSO session: no separate credentials.
import { withTimeout } from './abort';
import type { KbLink, KbPage } from './outcome';
import { extractPageText, hasRenderedContent } from './extract';
import { matchedKeywords, normalize, unique, wordsOf } from './text';
import { INTENT_ALIASES, KB_ACRONYMS, anchoredTermsInQuery, expandQueryTerms } from './kb-vocab';
import { nameInitials, rangeInitialBoost } from './kb-ranges';
import { kbIndexAsLinks } from './kb-index';
import { linkIdentity } from './site-profile';
import type { RetrievalEvidence } from './query-quality';

export const MAX_FOLLOW = 3;
/** Scadenza per la lettura di una pagina collegata (vedi fetchPage). */
const PAGE_FETCH_TIMEOUT_MS = 8_000;
const MIN_SELECTED_SCORE = 5;
const STRONG_SINGLE_SCORE = 13;
const SECONDARY_RATIO = 0.58;

/**
 * Dimensione della shortlist ampia inviata al reranker AI (`shortlistCandidates`).
 * Volutamente larga: il prefiltro locale deve solo GARANTIRE che l'articolo giusto
 * sia presente (recall), non sceglierlo.
 *
 * Portata da 30 a 40 nel Giro 4, che è il tetto già accettato dal backend
 * (`MAX_RANK_CANDIDATES` in server/src/config.ts): il client ne mandava 30 e
 * quei 10 posti erano semplicemente sprecati. Sono casi reali che stavano al
 * limite — «contatti avis» trovava l'articolo giusto in 30ª posizione — e il
 * costo sono ~10 titoli in più nel prompt del reranker, dell'ordine di 150 token
 * su Haiku. Se sale ancora, va alzato anche il tetto lato server.
 */
export const SHORTLIST_SIZE = 40;

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

/**
 * Tutto ciò che dipende dalla SOLA query, calcolato una volta.
 *
 * Prima concetti, frase e normalizzazione venivano ricavati dentro `scoreLink`,
 * cioè una volta per candidato: con l'indice KB intero sono ~2964 giri identici
 * per ogni ricerca. Ora sono qui, e i campi nuovi del Giro 4 (acronimi ancorati,
 * iniziali per gli intervalli alfabetici) non moltiplicano quel costo.
 */
interface QueryPlan {
  /** Le parole che l'agente ha DAVVERO scritto (acronimi compresi). Peso pieno. */
  keywords: string[];
  /** I sinonimi che iniettiamo noi (ponte IT→EN, espansione acronimi). Peso ridotto. */
  expansions: string[];
  /** Termini da confrontare con confine di parola; `undefined` = nessuno (percorso veloce). */
  anchored: ReadonlySet<string> | undefined;
  concepts: string[];
  /** Iniziali dei nomi cercati, per scegliere fra i fratelli di un intervallo. */
  initials: string[];
  /** Query normalizzata per `exactPhraseBoost`, o '' se troppo corta per contare. */
  phrase: string;
}

function planQuery(query: string): QueryPlan | null {
  const base = wordsOf(query);
  // A2 · gli acronimi (ASC, NDC, LH…) sono ≤3 caratteri e `wordsOf` li scarta:
  // vanno aggiunti a mano, e cercati come parola intera.
  const acronyms = anchoredTermsInQuery(query);
  if (!base.length && !acronyms.length) return null;
  const keywords = unique([...base, ...acronyms]);
  const have = new Set(keywords);
  // E3 · espansione cross-lingua: i termini EN dei concetti colpiti dalla query
  // (anche via alias IT), così label/slug inglesi matchano una query italiana.
  const expansions = expandQueryTerms(query, base).filter((t) => !have.has(t));
  const cleanQuery = normalize(query).replace(/\s+/g, ' ').trim();
  return {
    keywords,
    expansions,
    anchored: acronyms.length ? KB_ACRONYMS : undefined,
    concepts: queryConcepts(query),
    initials: nameInitials(query),
    phrase: cleanQuery.length >= 8 ? cleanQuery : '',
  };
}

function conceptMatches(text: string, concepts: string[]): string[] {
  const haystack = normalize(text).replace(/[^a-z0-9]+/g, ' ');
  return concepts.filter((concept) =>
    INTENT_ALIASES[concept].some((alias) => haystack.includes(normalize(alias))),
  );
}

function exactPhraseBoost(link: KbLink, phrase: string): number {
  if (!phrase) return 0;
  const haystack = normalize([link.text, slugText(link.url), link.context ?? ''].join(' '));
  return haystack.includes(phrase) ? 8 : 0;
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
  plan: QueryPlan,
): { score: number; reason: string; matched: string[] } {
  const { keywords, expansions, anchored, concepts } = plan;
  const slug = slugText(link.url);
  const context = link.context ?? '';
  const combinedText = [link.text, slug, context].join(' ');
  const labelMatches = matchedKeywords(link.text, keywords, anchored);
  const slugMatches = matchedKeywords(slug, keywords, anchored);
  const contextMatches = matchedKeywords(context, keywords, anchored);
  const labelExp = matchedKeywords(link.text, expansions, anchored);
  const slugExp = matchedKeywords(slug, expansions, anchored);
  const contextExp = matchedKeywords(context, expansions, anchored);
  const conceptHits = conceptMatches(combinedText, concepts);
  const phrase = exactPhraseBoost(link, plan.phrase);
  // A1 · fra i fratelli di un intervallo alfabetico, premia quello che copre
  // l'iniziale cercata: `lufthansa` → `L` → `… policies I L`.
  const rangeBoost = rangeInitialBoost(link.text, plan.initials);
  const penalty = genericPenalty(link);
  const score =
    labelMatches.length * 5 +
    slugMatches.length * 3 +
    contextMatches.length * 1.5 +
    // Le espansioni valgono ~60% di una parola scritta dall'agente. Sono una
    // nostra ipotesi sul significato, non evidenza: pesarle uguale faceva sì che
    // `asc queues asc` — dove ASC è letterale — venisse sepolta dai 21 articoli
    // che scrivono «airline schedule change» per esteso, cioè dall'espansione di
    // ASC stesso. Il ponte IT→EN resta intatto: in una query tutta italiana ogni
    // match è un'espansione, quindi la scala è uniforme e l'ordine non cambia.
    labelExp.length * 3 +
    slugExp.length * 1.8 +
    contextExp.length * 0.9 +
    conceptHits.length * 3 +
    phrase +
    rangeBoost -
    penalty;
  const matched = unique([
    ...labelMatches,
    ...slugMatches,
    ...contextMatches,
    ...labelExp,
    ...slugExp,
    ...contextExp,
    ...conceptHits,
  ]);
  const hits = labelMatches.length + slugMatches.length + contextMatches.length;
  const expHits = labelExp.length + slugExp.length + contextExp.length;
  const reason = [
    labelMatches.length ? `${labelMatches.length} hit testo` : '',
    slugMatches.length ? `${slugMatches.length} hit URL` : '',
    contextMatches.length ? `${contextMatches.length} hit contesto` : '',
    !hits && expHits ? `${expHits} hit su sinonimi` : '',
    conceptHits.length ? `${conceptHits.join('+')} intent` : '',
    phrase ? 'frase query vicina' : '',
    rangeBoost ? 'intervallo alfabetico' : '',
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
  const plan = planQuery(query);
  if (!plan) return [];
  return links.map((link, fallbackOrder) => {
    const result = scoreLink(link, plan);
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
 * Cosa il prefiltro sa dire di una domanda, per `assessQuery` (A4).
 *
 * Costa una scansione dell'indice (~60ms in locale, nessuna rete) e gira PRIMA
 * della richiesta, dove la shortlist vera non esiste ancora: il giudizio va dato
 * all'agente prima di spendere una chiamata a pagamento, non dopo. È lo stesso
 * scorer di `shortlistCandidates`, quindi il verdetto non può divergere dai
 * candidati che verranno poi davvero usati.
 */
export function retrievalEvidence(pageLinks: KbLink[], query: string): RetrievalEvidence {
  const index = kbIndexAsLinks();
  const pageIds = new Set(pageLinks.map((l) => identityOf(l.url)));
  const indexOnly = index.filter((l) => !pageIds.has(identityOf(l.url)));
  const scored = scoreAll([...pageLinks, ...indexOnly], query).filter((x) => x.score > 0);
  return {
    candidates: scored.length,
    topScore: scored.reduce((max, x) => Math.max(max, x.score), 0),
  };
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
  // Queste fetch partono in parallelo su tutti i candidati: senza scadenza, una
  // sola pagina che non risponde tiene in attesa l'intera ricerca.
  const deadline = withTimeout(PAGE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(link.url, { credentials: 'include', signal: deadline.signal });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Pagina client-rendered (es. Salesforce Aura): il fetch vede solo lo
    // shell, senza il testo dell'articolo. La scarto invece di inviare una
    // pagina vuota all'AI (token sprecati + risposta peggiore).
    if (!hasRenderedContent(doc)) {
      // Nessun URL nel log: sono indirizzi di articoli KB, e la console del
      // browser dell'agente non è il posto dove lasciarli.
      console.warn('[rs] pagina client-rendered senza contenuto nell’HTML grezzo, la salto');
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
    console.warn(
      deadline.expired()
        ? '[rs] fetch della pagina collegata scaduta'
        : '[rs] fetch della pagina collegata fallita:',
      e,
    );
    return null;
  } finally {
    deadline.dispose();
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
