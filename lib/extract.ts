// DOM extraction: read the main text and the internal (same-origin) links of
// the current KB page. In the demo this runs on Wikipedia; in production the
// same code reads the authenticated Runway KB page from the rendered DOM.
import type { KbPage, KbLink } from './outcome';

/** Rough token budget for a single page's text (~4 chars/token). */
const MAX_PAGE_CHARS = 6_000;
const FOCUSED_PAGE_CHARS = 4_500;
const MIN_QUERY_TEXT_CHARS = 900;

/** Selectors that usually hold the meaningful content, best-effort. */
const CONTENT_SELECTORS = [
  'main',
  'article',
  '#mw-content-text', // Wikipedia main content
  '#content',
  '[role="main"]',
];

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

function pickContentRoot(doc: Document): Element {
  for (const sel of CONTENT_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return doc.body;
}

function normalizeForSearch(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function keywordsOf(query: string): string[] {
  return normalizeForSearch(query)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
}

/** Collapse whitespace and trim to the page budget. */
function normalizeText(raw: string, max = MAX_PAGE_CHARS): string {
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function nearestHeadingText(el: Element): string {
  let node: Element | null = el;
  while (node) {
    let prev = node.previousElementSibling;
    while (prev) {
      if (/^H[1-6]$/i.test(prev.tagName)) return normalizeText(prev.textContent ?? '', 220);
      prev = prev.previousElementSibling;
    }
    node = node.parentElement;
  }
  return '';
}

function nearbyText(el: Element): string {
  const heading = nearestHeadingText(el);
  const parent = el.closest('p, li, td, th, section, article, div') ?? el.parentElement;
  const body = normalizeText(parent?.textContent ?? el.textContent ?? '', 260);
  return [heading, body].filter(Boolean).join(' - ');
}

function scoreText(text: string, keywords: string[]): number {
  const haystack = normalizeForSearch(text);
  return keywords.reduce((score, kw) => score + (haystack.includes(kw) ? 1 : 0), 0);
}

function queryFocusedText(root: Element, query: string): string | null {
  const keywords = keywordsOf(query);
  if (!keywords.length) return null;

  const blocks = Array.from(root.querySelectorAll('h1, h2, h3, p, li, td'))
    .map((el, order) => ({
      order,
      text: normalizeText(el.textContent ?? '', 1_200),
      score: scoreText(el.textContent ?? '', keywords),
    }))
    .filter((block) => block.text.length > 30);

  const selected = blocks
    .filter((block) => block.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 10)
    .sort((a, b) => a.order - b.order);

  if (!selected.length) return null;

  const focused = normalizeText(selected.map((block) => block.text).join('\n'), FOCUSED_PAGE_CHARS);
  if (focused.length < MIN_QUERY_TEXT_CHARS) {
    const intro = normalizeText(blocks.slice(0, 4).map((block) => block.text).join('\n'), 1_600);
    return normalizeText([intro, focused].filter(Boolean).join('\n'), FOCUSED_PAGE_CHARS);
  }
  return focused;
}

function isUsefulInternalUrl(url: URL): boolean {
  const path = decodeURIComponent(url.pathname).toLowerCase();
  if (path.includes('/wiki/special:')) return false;
  if (path.includes('/wiki/help:')) return false;
  if (path.includes('/wiki/category:')) return false;
  if (path.includes('/wiki/file:')) return false;
  if (path.includes('/wiki/template:')) return false;
  if (path.includes('/wiki/talk:')) return false;
  if (url.search) return false;
  return true;
}

/** Extract the readable text of the current page. */
export function extractPageText(doc: Document = document, query = ''): string {
  const root = pickContentRoot(doc);
  // Drop obvious non-content nodes before reading innerText.
  const clone = root.cloneNode(true) as Element;
  clone
    .querySelectorAll('script, style, nav, footer, aside, .navbox, .reference, .mw-editsection')
    .forEach((n) => n.remove());

  const focused = queryFocusedText(clone, query);
  return focused ?? normalizeText((clone as HTMLElement).innerText ?? clone.textContent ?? '');
}

/**
 * Collect internal (same-origin) links from the content area: the nested
 * structure of the KB. Deduplicated, capped, and stripped of fragments.
 */
export function extractInternalLinks(doc: Document = document, max = 40): KbLink[] {
  const here = new URL(doc.location.href);
  const root = pickContentRoot(doc);
  const seen = new Set<string>();
  const links: KbLink[] = [];

  for (const [order, a] of Array.from(root.querySelectorAll('a[href]')).entries()) {
    const href = a.getAttribute('href') ?? '';
    let url: URL;
    try {
      url = new URL(href, here.href);
    } catch {
      continue;
    }
    if (url.origin !== here.origin) continue; // same-origin only
    if (!isUsefulInternalUrl(url)) continue;
    url.hash = '';
    const key = url.href;
    if (key === here.href || seen.has(key)) continue;
    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    seen.add(key);
    links.push({ url: key, text, context: nearbyText(a), order });
    if (links.length >= max) break;
  }
  return links;
}

/** Build the KbPage for the page the agent is currently on. */
export function extractCurrentPage(query = '', doc: Document = document): KbPage {
  return {
    url: doc.location.href,
    title: doc.title,
    text: extractPageText(doc, query),
    origin: 'current',
  };
}
