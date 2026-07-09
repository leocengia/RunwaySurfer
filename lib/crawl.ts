// Shallow follow: fetch the most relevant nested links to give the AI context
// beyond the current page, while keeping prompt cost under control.
//
// KEY MECHANISM: the fetch is same-origin with `credentials: 'include'`, so it
// reuses whatever session the browser already has for this origin. On the real
// Runway KB that is the agent's SSO session: no separate credentials.
import type { KbLink, KbPage } from './outcome';
import { extractPageText } from './extract';

const MAX_FOLLOW = 3;
const MIN_SELECTED_SCORE = 5;
const STRONG_SINGLE_SCORE = 13;
const SECONDARY_RATIO = 0.58;

const STOP_WORDS = new Set([
  'alla',
  'allo',
  'anche',
  'come',
  'con',
  'dalla',
  'delle',
  'dello',
  'deve',
  'dopo',
  'fare',
  'gli',
  'per',
  'puo',
  'puoi',
  'qual',
  'quale',
  'sono',
  'the',
  'and',
  'for',
  'with',
  'from',
  'that',
  'this',
]);

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

const INTENT_ALIASES: Record<string, string[]> = {
  address: ['address', 'indirizzo', 'deliveryaddress', 'shippingaddress', 'recapito'],
  cancel: ['cancel', 'cancellation', 'annulla', 'annullare', 'cancellare', 'rimborso'],
  change: ['change', 'changed', 'modify', 'update', 'edit', 'cambiare', 'modifica', 'aggiorna'],
  delivery: ['delivery', 'shipping', 'shipment', 'spedizione', 'consegna'],
  order: ['order', 'booking', 'purchase', 'ordine', 'acquisto', 'prenotazione'],
  payment: ['payment', 'billing', 'invoice', 'pagamento', 'fattura', 'addebito'],
  refund: ['refund', 'reimbursement', 'rimborso', 'rimborsare', 'credito'],
  return: ['return', 'returns', 'reso', 'restituzione', 'restituire'],
};

function normalize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function wordsOf(text: string): string[] {
  return unique(
    normalize(text)
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w)),
  );
}

function slugText(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname).replace(/[_/-]+/g, ' ');
  } catch {
    return url;
  }
}

function matchedKeywords(text: string, keywords: string[]): string[] {
  const haystack = normalize(text);
  return keywords.filter((kw) => haystack.includes(kw));
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

function dynamicSelection(scored: Array<{ link: KbLink; score: number; order: number }>, max: number): KbLink[] {
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

/** Pick the top relevant links, dynamically narrowing weak candidates. */
export function pickRelevantLinks(links: KbLink[], query: string, max = MAX_FOLLOW): KbLink[] {
  const kws = wordsOf(query);
  if (!kws.length) return [];

  const scored = links.map((link, fallbackOrder) => {
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

  return dynamicSelection(scored, max);
}

/** Fetch one same-origin page reusing the current session and extract its text. */
async function fetchPage(link: KbLink, query: string): Promise<KbPage | null> {
  try {
    const res = await fetch(link.url, { credentials: 'include' });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return {
      url: link.url,
      title: doc.title || link.text,
      text: extractPageText(doc, query),
      origin: 'followed',
    };
  } catch {
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
