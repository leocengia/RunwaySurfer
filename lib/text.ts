// Utility di testo condivise fra estrazione (lib/extract.ts) e scoring dei link
// (lib/crawl.ts). Prima erano duplicate quasi identiche nei due file: normalize,
// stop-words, tokenizzazione e conteggio keyword. Consolidate qui per avere una
// sola fonte di verità prima di aggiungere nuovi consumatori (retrieval
// per-heading, vocabolario di dominio, glossario cross-lingua).

/** Parole troppo comuni (IT/EN) da ignorare in tokenizzazione e scoring. */
export const STOP_WORDS = new Set([
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

/** Minuscolo + rimozione dei diacritici (NFD), per confronti insensibili ad accenti/maiuscole. */
export function normalize(raw: string): string {
  return raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

/**
 * Tokenizza un testo in parole significative: normalizza, spezza sui
 * non-alfanumerici, tiene i token lunghi >3 non stop-word. `dedupe` controlla
 * se rimuovere i duplicati (lo scorer dei link vuole l'insieme unico; il
 * retrieval vuole le keyword della query così come sono).
 */
export function wordsOf(text: string, dedupe = true): string[] {
  const words = normalize(text)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !STOP_WORDS.has(w));
  return dedupe ? unique(words) : words;
}

/** Quante delle `keywords` compaiono nell'`haystack` (sottostringa, normalizzato). */
export function matchedKeywords(haystack: string, keywords: string[]): string[] {
  const hay = normalize(haystack);
  return keywords.filter((kw) => hay.includes(kw));
}

/** Numero di keyword presenti nel testo (comodo per lo scoring dei blocchi). */
export function countKeywords(text: string, keywords: string[]): number {
  const hay = normalize(text);
  return keywords.reduce((score, kw) => score + (hay.includes(kw) ? 1 : 0), 0);
}
