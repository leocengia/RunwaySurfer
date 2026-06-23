// DOM extraction: read the main text and the internal (same-origin) links of
// the current KB page. In the demo this runs on Wikipedia; in production the
// same code reads the authenticated Runway KB page (the DOM is already rendered
// for the logged-in agent, so there is nothing to scrape with separate creds).
import type { KbPage, KbLink } from './outcome';

/** Rough token budget for a single page's text (~4 chars/token). */
const MAX_PAGE_CHARS = 12_000;

/** Selectors that usually hold the meaningful content, best-effort. */
const CONTENT_SELECTORS = [
  'main',
  'article',
  '#mw-content-text', // Wikipedia main content
  '#content',
  '[role="main"]',
];

function pickContentRoot(doc: Document): Element {
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return doc.body;
}

/** Collapse whitespace and trim to the page budget. */
function normalizeText(raw: string): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length > MAX_PAGE_CHARS ? text.slice(0, MAX_PAGE_CHARS) + '…' : text;
}

/** Extract the readable text of the current page. */
export function extractPageText(doc: Document = document): string {
  const root = pickContentRoot(doc);
  // Drop obvious non-content nodes before reading innerText.
  const clone = root.cloneNode(true) as Element;
  clone
    .querySelectorAll('script, style, nav, footer, aside, .navbox, .reference, .mw-editsection')
    .forEach((n) => n.remove());
  return normalizeText((clone as HTMLElement).innerText ?? clone.textContent ?? '');
}

/**
 * Collect internal (same-origin) links from the content area — the "nested
 * structure" of the KB. Deduplicated, capped, and stripped of fragments.
 */
export function extractInternalLinks(
  doc: Document = document,
  max = 40,
): KbLink[] {
  const here = new URL(doc.location.href);
  const root = pickContentRoot(doc);
  const seen = new Set<string>();
  const links: KbLink[] = [];

  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    let url: URL;
    try {
      url = new URL(href, here.href);
    } catch {
      continue;
    }
    if (url.origin !== here.origin) continue; // same-origin only
    url.hash = '';
    const key = url.href;
    if (key === here.href || seen.has(key)) continue;
    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    seen.add(key);
    links.push({ url: key, text });
    if (links.length >= max) break;
  }
  return links;
}

/** Build the KbPage for the page the agent is currently on. */
export function extractCurrentPage(doc: Document = document): KbPage {
  return {
    url: doc.location.href,
    title: doc.title,
    text: extractPageText(doc),
    origin: 'current',
  };
}
