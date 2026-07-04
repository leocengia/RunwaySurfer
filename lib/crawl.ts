// Shallow follow: fetch a few of the most relevant nested links to give the AI
// context beyond the current page.
//
// KEY MECHANISM: the fetch is same-origin with `credentials: 'include'`, so it
// reuses whatever session the browser already has for this origin. On the real
// Runway KB that is the agent's SSO session: no separate credentials.
import type { KbLink, KbPage } from './outcome';
import { extractPageText } from './extract';

const MAX_FOLLOW = 3;

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

function normalize(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function wordsOf(text: string): string[] {
  return normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

function slugText(url: string): string {
  try {
    const parsed = new URL(url);
    return decodeURIComponent(parsed.pathname).replace(/[_/-]+/g, ' ');
  } catch {
    return url;
  }
}

function hitCount(text: string, keywords: string[]): number {
  const haystack = normalize(text);
  return keywords.reduce((n, kw) => n + (haystack.includes(kw) ? 1 : 0), 0);
}

/** Relevance score from link label, URL slug and nearby page context. */
function scoreLink(link: KbLink, keywords: string[]): { score: number; reason: string } {
  const labelHits = hitCount(link.text, keywords);
  const slugHits = hitCount(slugText(link.url), keywords);
  const contextHits = hitCount(link.context ?? '', keywords);
  const score = labelHits * 4 + slugHits * 2 + contextHits;
  const reason = [
    labelHits ? `${labelHits} hit testo link` : '',
    slugHits ? `${slugHits} hit URL` : '',
    contextHits ? `${contextHits} hit contesto` : '',
  ]
    .filter(Boolean)
    .join(', ');
  return { score, reason: reason || 'nessuna corrispondenza' };
}

/** Pick the top-N links most relevant to the query. */
export function pickRelevantLinks(links: KbLink[], query: string, max = MAX_FOLLOW): KbLink[] {
  const kws = wordsOf(query);
  if (!kws.length) return [];

  return links
    .map((link, fallbackOrder) => {
      const scored = scoreLink(link, kws);
      return {
        link: { ...link, reason: scored.reason },
        score: scored.score,
        order: link.order ?? fallbackOrder,
      };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order || a.link.url.localeCompare(b.link.url))
    .slice(0, max)
    .map((x) => x.link);
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
 * Follow the top-N relevant links (in parallel) and return the pages that
 * loaded. Failures are skipped silently: the current page is still usable.
 */
export async function shallowFollow(
  links: KbLink[],
  query: string,
  max = MAX_FOLLOW,
): Promise<KbPage[]> {
  const chosen = pickRelevantLinks(links, query, max);
  const results = await Promise.all(chosen.map((link) => fetchPage(link, query)));
  return results.filter((p): p is KbPage => p !== null);
}
