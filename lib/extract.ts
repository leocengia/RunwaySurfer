// DOM extraction: read the main text and the internal (same-origin) links of
// the current KB page. In the demo this runs on Wikipedia; in production the
// same code reads the authenticated Runway KB page from the rendered DOM.
import type { KbPage, KbLink } from './outcome';
import { linkIdentity, normalizeLinkUrl, siteProfile } from './site-profile';
import { countKeywords, wordsOf } from './text';
import { expandQueryTerms } from './kb-vocab';

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
 * Root per la raccolta LINK: volutamente più ampia del content-root testo. Sulla
 * KB Aura i link "collegati" utili (pannello Suggested/Trending) stanno nella
 * colonna 4-of-12, FUORI da `c-runway-article-viewer` che è il root del testo.
 * Usando `[role="main"]` per i link, li catturiamo insieme ai cross-link del corpo.
 */
function pickLinkRoot(doc: Document): Element {
  for (const sel of siteProfile.linkRootSelectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return doc.body;
}

/**
 * Keyword della query per il retrieval. Non deduplica (una keyword ripetuta \u00e8
 * un segnale). In coda aggiunge l'espansione cross-lingua (E3): i termini EN
 * del concetto di dominio colpito dalla query, cos\u00ec il retrieval trova la
 * sezione giusta anche quando la query \u00e8 in italiano e il contenuto in inglese
 * (es. "rimborso" \u2192 "refund").
 */
function keywordsOf(query: string): string[] {
  const base = wordsOf(query, false);
  return [...base, ...expandQueryTerms(query, base)];
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
 * Percorre gli elementi in ordine di documento a QUALSIASI profondità (non solo i
 * figli diretti): sulla KB Aura le `<h2 class="section-title">` sono annidate in
 * `.article-section`, quindi la vecchia scansione dei soli figli diretti non
 * segmentava e l'intera leva E2 restava spenta. Segmenta al livello di heading
 * più alto presente (es. h2), trattando gli heading più profondi (h3/h4) come
 * contenuto di sezione. Salta i blocchi annidati in un blocco già incluso
 * (niente doppio conteggio di `<p>` dentro `<td>`). Ritorna [] con < 2 heading
 * (pagina piatta) → il chiamante ricade sul retrieval per-blocco.
 */
function sectionsByHeading(root: Element): Section[] {
  const els = Array.from(root.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, td'));
  const isHeading = (el: Element) => HEADING_RE.test(el.tagName);
  const named = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim().length > 0;
  const headings = els.filter((el) => isHeading(el) && named(el));
  if (headings.length < 2) return [];
  const minRank = Math.min(...headings.map((h) => Number(h.tagName[1])));

  const sections: Section[] = [];
  let current: Section | null = null;
  let order = 0;
  for (const el of els) {
    if (isHeading(el) && Number(el.tagName[1]) === minRank && named(el)) {
      current = { heading: normalizeText(el.textContent ?? '', 220), nodes: [], order: order++ };
      sections.push(current);
    } else if (current) {
      if (current.nodes.some((n) => n.contains(el))) continue; // già coperto da un blocco outer
      current.nodes.push(el);
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

/**
 * Rileva quando il DOM NON è un articolo leggibile ma la pagina di **login**
 * (sessione SSO scaduta) o **"record non trovato"**. Serve alla sidebar per NON
 * mandare all'AI il contenuto della login come se fosse un articolo. Conservativo:
 * richiede sia un segnale (campo password / marker) SIA un content-root corto,
 * così NON blocca articoli veri (il cui corpo è ampio). Euristica allineata al
 * probe recon C4. Ritorna null quando la pagina è un normale articolo.
 */
export function detectUnreadablePage(doc: Document = document): 'login' | 'notfound' | null {
  const root = pickContentRoot(doc);
  const rootLen = normalizeText((root as HTMLElement).innerText ?? root.textContent ?? '').length;
  const head = normalizeText(doc.body?.textContent ?? '', 800).toLowerCase();
  const hasPassword = !!doc.querySelector('input[type="password"]');
  const loginMarker = /\b(log ?in|sign ?in|accedi|forgot password|password dimenticata)\b/.test(
    head,
  );
  const notFoundMarker =
    /\b(not found|no longer available|record non trovato|articolo non trovato)\b/.test(head);
  if ((hasPassword || loginMarker) && rootLen < 500) return 'login';
  if (notFoundMarker && rootLen < 1200) return 'notfound';
  return null;
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
export function extractInternalLinks(doc: Document = document, max = 80): KbLink[] {
  const here = new URL(doc.location.href);
  const hereId = linkIdentity(here);
  const root = pickLinkRoot(doc);
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
