// DOM extraction: read the main text and the internal (same-origin) links of
// the current KB page. In the demo this runs on Wikipedia; in production the
// same code reads the authenticated Runway KB page from the rendered DOM.
import type { KbPage, KbLink } from './outcome';
import { linkIdentity, normalizeLinkUrl, siteProfile } from './site-profile';
import { countKeywords, wordsOf } from './text';

/** Rough token budget for a single page's text (~4 chars/token). */
const MAX_PAGE_CHARS = 6_000;
const FOCUSED_PAGE_CHARS = 4_500;
const MIN_QUERY_TEXT_CHARS = 900;

function pickContentRoot(doc: Document): Element {
  for (const sel of siteProfile.contentSelectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return doc.body;
}

/**
 * Keyword della query per il retrieval: non deduplica (una keyword ripetuta
 * nella query \u00e8 un segnale, non rumore) e mantiene la semantica dello storico
 * `keywordsOf`.
 */
function keywordsOf(query: string): string[] {
  return wordsOf(query, false);
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

const BLOCK_SELECTOR = 'h1, h2, h3, p, li, td';
const HEADING_RE = /^H[1-6]$/i;

type Block = { order: number; text: string; score: number };

/** Trasforma un elenco di elementi-blocco in Block con score keyword. */
function blocksFrom(elements: Element[], keywords: string[]): Block[] {
  return elements
    .map((el, order) => ({
      order,
      text: normalizeText(el.textContent ?? '', 1_200),
      score: countKeywords(el.textContent ?? '', keywords),
    }))
    .filter((block) => block.text.length > 30);
}

/** Raccoglie i blocchi testuali (con score keyword) di un sottoalbero. */
function blocksOf(root: Element, keywords: string[]): Block[] {
  return blocksFrom(Array.from(root.querySelectorAll(BLOCK_SELECTOR)), keywords);
}

/** Blocchi testuali dei nodi di una sezione (ogni nodo + i suoi discendenti). */
function blocksOfNodes(nodes: Element[], keywords: string[]): Block[] {
  const els: Element[] = [];
  for (const n of nodes) {
    if (n.matches(BLOCK_SELECTOR)) els.push(n);
    els.push(...Array.from(n.querySelectorAll(BLOCK_SELECTOR)));
  }
  return blocksFrom(els, keywords);
}

/** Top-N blocchi per score, riordinati per posizione, uniti entro `budget`. */
function topBlocks(blocks: Block[], budget: number, limit = 10): string | null {
  const selected = blocks
    .filter((block) => block.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .sort((a, b) => a.order - b.order);
  if (!selected.length) return null;
  return normalizeText(selected.map((block) => block.text).join('\n'), budget);
}

type Section = { heading: string; nodes: Element[]; order: number };

/**
 * Segmenta il content-root in sezioni "intestazione → contenuto fino al
 * prossimo heading". È la leva #1 sul costo-token: gli articoli KB arrivano a
 * ~126k caratteri e sono organizzati per intestazioni; isolando la sezione
 * pertinente alla query si passa da ~31k token a ~4,5k senza perdere coesione
 * (a differenza del retrieval per-blocco, che pescava frasi sparse).
 *
 * Percorre i figli DIRETTI del root in ordine di documento: ogni h1-h6 apre una
 * nuova sezione; il testo prima del primo heading diventa la sezione "intro"
 * (heading vuoto). Ritorna [] se il root non ha heading di primo livello (es.
 * pagine a struttura piatta) → il chiamante ricade sul retrieval per-blocco.
 */
function sectionsByHeading(root: Element): Section[] {
  const sections: Section[] = [];
  let current: Section | null = null;
  let order = 0;
  for (const child of Array.from(root.children)) {
    if (HEADING_RE.test(child.tagName)) {
      current = { heading: normalizeText(child.textContent ?? '', 220), nodes: [], order: order++ };
      sections.push(current);
    } else {
      if (!current) {
        current = { heading: '', nodes: [], order: order++ };
        sections.push(current);
      }
      current.nodes.push(child);
    }
  }
  return sections.filter((s) => s.heading || s.nodes.length);
}

/** Score di una sezione: intestazione (peso doppio) + prima frase di corpo. */
function scoreSection(section: Section, keywords: string[]): number {
  const bodyLead = normalizeText(section.nodes.map((n) => n.textContent ?? '').join(' '), 400);
  return countKeywords(section.heading, keywords) * 2 + countKeywords(bodyLead, keywords);
}

/** Testo completo di una sezione (intestazione + corpo), entro `budget`. */
function sectionText(section: Section, budget: number): string {
  const body = section.nodes.map((n) => n.textContent ?? '').join('\n');
  return normalizeText([section.heading, body].filter(Boolean).join('\n'), budget);
}

/**
 * Retrieval a due stadi:
 *  Stadio 1 — scegli le sezioni (per heading) più pertinenti alla query.
 *  Stadio 2 — dentro le sezioni scelte, se il testo eccede il budget, estrai i
 *             blocchi pertinenti (riuso della logica per-blocco).
 * Ricade su null se non c'è struttura a sezioni utile → per-blocco sul root.
 */
function focusedByHeading(root: Element, keywords: string[]): string | null {
  const sections = sectionsByHeading(root);
  const withHeading = sections.filter((s) => s.heading);
  if (withHeading.length < 2) return null; // struttura piatta: usa il per-blocco

  const ranked = sections
    .map((section) => ({ section, score: scoreSection(section, keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.section.order - b.section.order);
  if (!ranked.length) return null;

  const chosen: string[] = [];
  let used = 0;
  for (const { section } of ranked) {
    if (used >= FOCUSED_PAGE_CHARS) break;
    const remaining = FOCUSED_PAGE_CHARS - used;
    const full = sectionText(section, remaining);
    // Sezione grande: restringi ai blocchi pertinenti; altrimenti tienila intera.
    const wrapper =
      full.length >= remaining
        ? (topBlocks(blocksOfNodes(section.nodes, keywords), remaining) ?? full)
        : full;
    const piece = normalizeText([section.heading, wrapper].filter(Boolean).join('\n'), remaining);
    if (!piece) continue;
    chosen.push(piece);
    used += piece.length;
  }

  const joined = normalizeText(chosen.join('\n\n'), FOCUSED_PAGE_CHARS);
  return joined.length ? joined : null;
}

function queryFocusedText(root: Element, query: string): string | null {
  const keywords = keywordsOf(query);
  if (!keywords.length) return null;

  // Stadio principale: retrieval per-heading (coeso su articoli lunghi).
  const byHeading = focusedByHeading(root, keywords);
  if (byHeading && byHeading.length >= MIN_QUERY_TEXT_CHARS) return byHeading;

  // Fallback / pagine a struttura piatta: retrieval per-blocco storico.
  const blocks = blocksOf(root, keywords);
  const focused = topBlocks(blocks, FOCUSED_PAGE_CHARS) ?? byHeading;
  if (!focused) return null;

  if (focused.length < MIN_QUERY_TEXT_CHARS) {
    const intro = normalizeText(
      blocks
        .slice(0, 4)
        .map((block) => block.text)
        .join('\n'),
      1_600,
    );
    return normalizeText([intro, focused].filter(Boolean).join('\n'), FOCUSED_PAGE_CHARS);
  }
  return focused;
}

function isUsefulInternalUrl(url: URL): boolean {
  const path = decodeURIComponent(url.pathname).toLowerCase();
  // NB: non si scartano più gli URL con query-string — la KB Salesforce usa
  // ?language= per identificare la pagina. La normalizzazione (normalizeLinkUrl)
  // rimuove i param non essenziali, così le varianti (?nocache=…) deduplicano.
  return !siteProfile.rejectPathIncludes.some((frag) => path.includes(frag));
}

/**
 * True se il documento contiene un vero content-root, non solo lo shell
 * dell'app. Le pagine Salesforce Aura sono client-rendered: un fetch() ne
 * restituisce lo shell (i selettori del contenuto compaiono solo dopo il boot
 * JS), quindi non avrebbe testo utile. Usato da fetchPage per scartarle invece
 * di mandare pagine vuote all'AI. Su una pagina server-rendered (es. Wikipedia)
 * i selettori sono già presenti nell'HTML grezzo → true.
 */
export function hasRenderedContent(doc: Document): boolean {
  return siteProfile.contentSelectors.some((sel) => doc.querySelector(sel));
}

/** Extract the readable text of the current page. */
export function extractPageText(doc: Document = document, query = ''): string {
  const root = pickContentRoot(doc);
  // Drop obvious non-content nodes before reading innerText.
  const clone = root.cloneNode(true) as Element;
  clone.querySelectorAll(siteProfile.noiseSelectors).forEach((n) => n.remove());

  const focused = queryFocusedText(clone, query);
  return focused ?? normalizeText((clone as HTMLElement).innerText ?? clone.textContent ?? '');
}

/**
 * Collect internal (same-origin) links from the content area: the nested
 * structure of the KB. Deduplicated, capped, and stripped of fragments.
 */
export function extractInternalLinks(doc: Document = document, max = 40): KbLink[] {
  const here = new URL(doc.location.href);
  const hereId = linkIdentity(here);
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
    const id = linkIdentity(url);
    if (id === hereId || seen.has(id)) continue;
    const text = (a.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    seen.add(id);
    links.push({ url: normalizeLinkUrl(url), text, context: nearbyText(a), order });
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
