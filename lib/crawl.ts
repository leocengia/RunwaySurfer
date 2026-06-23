// Shallow follow: fetch a few of the most relevant nested links to give the AI
// context beyond the current page.
//
// KEY MECHANISM: the fetch is same-origin with `credentials: 'include'`, so it
// reuses whatever session the browser already has for this origin. On the real
// Runway KB that is the agent's SSO session — no separate credentials, no
// external scraper. The demo exercises the exact same path on Wikipedia.
//
// JUN/demo scope: one level deep, top-N links. AUG turns this into a real
// query-guided multi-level crawl reusing the same KbPage contract.
import type { KbLink, KbPage } from './outcome';
import { extractPageText } from './extract';

const MAX_FOLLOW = 3;

/** Naive relevance score: count query keyword hits in the link text. */
function scoreLink(link: KbLink, keywords: string[]): number {
  const text = link.text.toLowerCase();
  return keywords.reduce((n, kw) => (kw && text.includes(kw) ? n + 1 : n), 0);
}

function keywordsOf(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter((w) => w.length > 3);
}

/** Pick the top-N links most relevant to the query. */
export function pickRelevantLinks(
  links: KbLink[],
  query: string,
  max = MAX_FOLLOW,
): KbLink[] {
  const kws = keywordsOf(query);
  return [...links]
    .map((link) => ({ link, score: scoreLink(link, kws) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.link);
}

/** Fetch one same-origin page reusing the current session and extract its text. */
async function fetchPage(link: KbLink): Promise<KbPage | null> {
  try {
    const res = await fetch(link.url, { credentials: 'include' });
    if (!res.ok) return null;
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return {
      url: link.url,
      title: doc.title || link.text,
      text: extractPageText(doc),
      origin: 'followed',
    };
  } catch {
    return null;
  }
}

/**
 * Follow the top-N relevant links (in parallel) and return the pages that
 * loaded. Failures are skipped silently — the current page is still usable.
 */
export async function shallowFollow(
  links: KbLink[],
  query: string,
  max = MAX_FOLLOW,
): Promise<KbPage[]> {
  const chosen = pickRelevantLinks(links, query, max);
  const results = await Promise.all(chosen.map(fetchPage));
  return results.filter((p): p is KbPage => p !== null);
}
