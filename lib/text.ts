// Utility di testo condivise fra estrazione (lib/extract.ts) e scoring dei link
// (lib/crawl.ts). Prima erano duplicate quasi identiche nei due file: normalize,
// stop-words, tokenizzazione e conteggio keyword. Consolidate qui per avere una
// sola fonte di verità prima di aggiungere nuovi consumatori (retrieval
// per-heading, vocabolario di dominio, glossario cross-lingua).

/**
 * Parole troppo comuni (IT/EN) da ignorare in tokenizzazione e scoring.
 *
 * Il secondo blocco viene dalle 27 query reali del sondaggio agenti: sono forme
 * che ricorrono in domande italiane e che compaiono anche nelle label italiane
 * della KB, quindi come keyword producevano match su articoli del tutto
 * scorrelati. Servono anche a lib/kb-ranges.ts, che tratta come possibile nome
 * proprio ogni parola non-vocabolario: senza queste, «dimmi tutte le
 * casistiche…» offrirebbe D e T come iniziali di vettore.
 */
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
  // Dalle query reali del sondaggio (2026-08)
  'cosa',
  'della',
  'dimmi',
  'elencami',
  'quali',
  'quando',
  'quanto',
  'sapere',
  'tutte',
  'tutti',
  'vorrei',
  'devo',
  'posso',
  'nel',
  'una',
  'del',
  'what',
  'which',
  'when',
  'where',
  'how',
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

/**
 * Quali delle `keywords` compaiono nell'`haystack` (sottostringa, normalizzato).
 *
 * I termini elencati in `anchored` richiedono invece un **confine di parola**.
 * Serve agli acronimi: `asc` come sottostringa matcherebbe *Madagascar*, *TASC*
 * e *mascotas* — tre falsi positivi reali dell'indice KB — mentre come parola
 * intera colpisce esattamente le 40 label che parlano di *airline schedule
 * change*. Il confronto è per token esatto, che è sufficiente perché ogni
 * acronimo è una parola sola.
 */
export function matchedKeywords(
  haystack: string,
  keywords: string[],
  anchored?: ReadonlySet<string>,
): string[] {
  const hay = normalize(haystack);
  if (!anchored?.size) return keywords.filter((kw) => hay.includes(kw));
  const tokens = new Set(hay.split(/[^a-z0-9]+/));
  return keywords.filter((kw) => (anchored.has(kw) ? tokens.has(kw) : hay.includes(kw)));
}

/** Numero di keyword presenti nel testo (comodo per lo scoring dei blocchi). */
export function countKeywords(text: string, keywords: string[]): number {
  const hay = normalize(text);
  return keywords.reduce((score, kw) => score + (hay.includes(kw) ? 1 : 0), 0);
}

/** Un alias di una sola parola è "abbastanza lungo" da matchare anche come sottostringa. */
const MIN_SUBSTRING_ALIAS_LENGTH = 5;

/** Tokenizza un alias del vocabolario negli stessi termini di `wordsOf`/`matchedKeywords`. */
function aliasTokens(alias: string): string[] {
  return normalize(alias)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Un alias del vocabolario (lib/kb-vocab.ts, `INTENT_ALIASES`) combacia con
 * `haystackTokens` a livello di TOKEN, mai di sottostringa senza controllo.
 *
 * Un alias di UNA parola combacia anche come sottostringa DI UN SOLO token più
 * lungo, ma solo se l'alias ha almeno `MIN_SUBSTRING_ALIAS_LENGTH` caratteri: è la
 * lunghezza a proteggere dai falsi positivi, non la posizione. `car` (3
 * lettere) è sottostringa sia di `cercare` («devo **cer**car**e** la policy di
 * emirates») sia di `Carrier` (*Low Cost **Carr**ier*, che significa
 * "vettore", non "autonoleggio"): con `car` sotto soglia nessuna delle due
 * scatta più. Ma la posizione da sola non basta a distinguere: `noleggio` (8
 * lettere, sopra soglia) è un SUFFISSO di `autonoleggio` («contatti
 * autonoleggio», dove l'alias italiano di *car* è `noleggio`), non un
 * prefisso — un controllo "solo prefisso" perderebbe questo caso genuino
 * insieme a quelli spuri. La lunghezza minima è quindi l'unico filtro: sotto
 * soglia niente sottostringhe (comunque coperto da alias più espliciti, es.
 * `bag`/`bags` elencati entrambi), sopra soglia la sottostringa è già
 * abbastanza specifica da fidarsi. Un alias già lungo (`cancel`, 6 lettere)
 * copre così anche `cancellazione`/`cancellato` senza doverli elencare uno per
 * uno.
 *
 * Un alias di PIÙ parole (`check-in`) combacia solo come sequenza CONTIGUA di
 * token, ognuno esatto — la lunghezza non c'entra, è già un confine di parola.
 */
export function aliasMatchesTokens(alias: string, haystackTokens: readonly string[]): boolean {
  const parts = aliasTokens(alias);
  if (!parts.length) return false;
  if (parts.length === 1) {
    const [needle] = parts;
    return haystackTokens.some(
      (t) => t === needle || (needle.length >= MIN_SUBSTRING_ALIAS_LENGTH && t.includes(needle)),
    );
  }
  for (let i = 0; i + parts.length <= haystackTokens.length; i++) {
    if (parts.every((part, j) => haystackTokens[i + j] === part)) return true;
  }
  return false;
}
