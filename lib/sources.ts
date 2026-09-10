// Dalla risposta markdown dell'AI alle fonti cliccabili della sidebar.
//
// Il provider emette la sezione `## Fonti` come righe `- Titolo: <url>` (vedi
// server/src/provider/shared.ts e mock.ts). Renderizzarle come testo lasciava
// URL nudi non cliccabili; qui la sezione diventa una lista {titolo, url} e il
// resto della risposta resta in blocchi di testo, così App.tsx non deve fare
// parsing durante il render.
//
// Logica pura (nessun DOM, nessuna storage API) per poterla testare offline.
import { SOURCES_SECTION, type KbPage } from './outcome';
import { normalizeUrl } from './tour';
import { urlsIn } from './tour-target';

export interface Source {
  title: string;
  url: string;
}

/** Segmento di testo inline: il grassetto markdown reso senza innerHTML. */
export interface InlineSegment {
  text: string;
  bold: boolean;
}

export type OutcomeBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; inline: InlineSegment[] }
  | { kind: 'list'; ordered: boolean; items: InlineSegment[][] }
  | { kind: 'sources'; sources: Source[] };

/** Escape dei metacaratteri per interpolare un titolo dentro una regex. */
function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Il titolo della sezione fonti arriva da shared/sections.json, lo stesso file da
// cui il backend costruisce il prompt: prima era hardcoded qui come /fonti/i e
// bastava rinominarlo lato server per far tornare gli URL nudi.
const SOURCES_HEADING = new RegExp(`^##\\s*${escapeRegex(SOURCES_SECTION)}\\b`, 'i');
const HEADING = /^##\s+/;
/** Bullet o numerazione all'inizio della riga: `- `, `* `, `1. `, `1) `. */
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s*/;

/** Titolo di ripiego da un URL: ultimo segmento leggibile, altrimenti l'host. */
function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop();
    if (!segment) return parsed.hostname;
    const readable = decodeURIComponent(segment)
      .replace(/\.(html?|php|aspx?)$/i, '')
      .replace(/[_+-]+/g, ' ')
      .trim();
    return readable || parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Titolo scritto dall'AI sulla riga, ovvero tutto ciò che precede l'URL: così
 * un titolo che contiene i due punti ("Rimborsi: casi particolari") resta
 * intero, dove uno split su ':' lo taglierebbe a metà.
 */
function titleOnLine(line: string, url: string): string {
  const before = line.slice(0, line.indexOf(url));
  return before
    .replace(BULLET, '')
    .replace(/[\s:–—-]+$/, '')
    .replace(/^[[(<"'«]+/, '')
    .replace(/[\])>"'»]+$/, '')
    .trim();
}

/** Titolo di una pagina effettivamente letta durante la richiesta, se combacia. */
function titleFromPages(url: string, pages: KbPage[]): string {
  const want = normalizeUrl(url);
  const page = pages.find((p) => normalizeUrl(p.url) === want);
  return page?.title?.trim() ?? '';
}

/**
 * Fonti citate nella sezione `## Fonti`, deduplicate per URL normalizzato.
 * Il titolo viene dalla riga; se manca, dalla pagina letta con lo stesso URL;
 * in ultima istanza dall'URL stesso — così un chip non è mai vuoto.
 */
export function parseSources(outcome: string, pages: KbPage[] = []): Source[] {
  const lines = outcome.split('\n');
  const start = lines.findIndex((line) => SOURCES_HEADING.test(line.trim()));
  if (start === -1) return [];
  const endRelative = lines.slice(start + 1).findIndex((line) => HEADING.test(line.trim()));
  const body = lines.slice(start + 1, endRelative === -1 ? undefined : start + 1 + endRelative);

  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const line of body) {
    for (const url of urlsIn(line)) {
      const key = normalizeUrl(url);
      if (seen.has(key)) continue;
      seen.add(key);
      const title = titleOnLine(line, url) || titleFromPages(url, pages) || titleFromUrl(url);
      sources.push({ title, url });
    }
  }
  return sources;
}

/** Riga di elenco puntato o numerato: cattura il marcatore per distinguerli. */
const LIST_ITEM = /^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/;

/**
 * Grassetto markdown `**testo**` in segmenti. Restituisce dati, non HTML: il
 * render li trasforma in nodi React, quindi non esiste alcun percorso da testo
 * del modello a `innerHTML`.
 */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  const re = /\*\*(.+?)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) segments.push({ text: text.slice(last, m.index), bold: false });
    segments.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ text: text.slice(last), bold: false });
  return segments.length ? segments : [{ text, bold: false }];
}

/**
 * La risposta come blocchi pronti al render: heading, paragrafi, elenchi e — al
 * posto della sezione Fonti — la lista dei link. Tollera il markdown parziale che
 * arriva durante lo streaming (una sezione Fonti ancora vuota non produce
 * blocco, non un blocco vuoto).
 *
 * Gli elenchi contano: il modello emette i passi operativi come `- voce`, e
 * renderizzarli come paragrafi piatti rendeva illeggibile ogni procedura.
 */
export function buildOutcomeBlocks(outcome: string, pages: KbPage[] = []): OutcomeBlock[] {
  const blocks: OutcomeBlock[] = [];
  const lines = outcome.split('\n');
  let inSources = false;
  /** Elenco in costruzione: righe consecutive dello stesso tipo si fondono. */
  let list: { ordered: boolean; items: InlineSegment[][] } | null = null;

  const flushList = () => {
    if (list) blocks.push({ kind: 'list', ...list });
    list = null;
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (HEADING.test(trimmed)) {
      flushList();
      inSources = SOURCES_HEADING.test(trimmed);
      blocks.push({ kind: 'heading', text: trimmed.replace(HEADING, '') });
      if (inSources) {
        const sources = parseSources(outcome, pages);
        if (sources.length) blocks.push({ kind: 'sources', sources });
      }
      continue;
    }
    // Le righe della sezione Fonti sono già rese come chip: non ripeterle come
    // testo (sarebbe l'URL nudo che stiamo eliminando).
    if (inSources) continue;

    const item = LIST_ITEM.exec(line);
    if (item) {
      const ordered = item[2] !== undefined;
      // Un elenco puntato che diventa numerato (o viceversa) è un elenco nuovo.
      if (list && list.ordered !== ordered) flushList();
      list ??= { ordered, items: [] };
      list.items.push(parseInline(item[3]));
      continue;
    }

    flushList();
    blocks.push({ kind: 'text', text: line, inline: parseInline(line) });
  }
  flushList();
  return blocks;
}
