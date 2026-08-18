// Intervalli alfabetici della KB Runway (Giro 4, causa n.1 del sondaggio agenti).
//
// IL PROBLEMA. La KB archivia i vettori e gli autonoleggi per intervallo di
// iniziale, e il nome cercato non compare nel titolo:
//
//   Global airline schedule change policies A / B D / E H / I L / M R / S Z
//   Car rental companies contact information A D / E J / K Z
//   Flight ADM IAR Errors A C / D F / G I / N Z
//
// L'articolo che risponde a «ASC lufthansa policy» è quello in `I L`, perché
// Lufthansa comincia per L. Sono 49 articoli in 23 famiglie, e coprono proprio
// gli argomenti più chiesti dagli agenti: Lufthansa è citata in 6 delle 27 query.
//
// COSA FA (E COSA NON FA) QUESTO MODULO. Non inventa candidati e non filtra
// nulla: aggiunge un bonus di punteggio al fratello il cui intervallo copre
// l'iniziale del nome cercato. È additivo, quindi il caso peggiore è il
// comportamento di oggi — nessun candidato può uscire dalla shortlist per colpa
// sua. Serve su due percorsi:
//   - la shortlist inviata al reranker AI, dove porta in alto il fratello giusto;
//   - la selezione LOCALE (`dynamicSelection`), che gira quando `/rank` scade o
//     il provider è in mock: lì non c'è alcuna AI a rimediare, e senza questo
//     bonus i fratelli pareggiano e vince il primo per ordine alfabetico di URL.
//
// NOTA su cosa NON serviva: scorare sulla famiglia invece che sulla label intera
// (l'ipotesi iniziale) è un no-op. `matchedKeywords` cerca sottostringhe, e le
// due lettere in più di ` I L` non impediscono a nessuna keyword di matchare.
// La label valeva zero per ragioni diverse — l'acronimo scartato dal
// tokenizzatore e `policy` che non matcha `policies` — risolte in lib/kb-vocab.ts.
import { CARRIER_NAMES, VOCAB_TERMS, acronymsInQuery } from './kb-vocab';
import { STOP_WORDS, normalize, unique } from './text';

/** Bonus per il fratello il cui intervallo copre l'iniziale cercata. */
export const RANGE_INITIAL_BOOST = 4;

/** Lunghezza minima di un token per essere considerato un possibile nome proprio. */
const MIN_NAME_LENGTH = 4;

export interface KbRange {
  /** La label senza l'intervallo: raggruppa i fratelli della stessa famiglia. */
  family: string;
  /** Prima lettera coperta, maiuscola. */
  from: string;
  /** Ultima lettera coperta, maiuscola (uguale a `from` per gli intervalli di una lettera). */
  to: string;
}

/** L'ID articolo Salesforce in coda alla label (13 cifre), presente su 852 label su 2964. */
const TRAILING_ARTICLE_ID = /\s+\d{10,}$/;
/** Due lettere singole consecutive, a fine label o seguite da un suffisso (`… A C APAC`). */
const LETTER_PAIR = /(?:^|\s)([A-Za-z])\s([A-Za-z])(?=\s|$)/g;
/** Una sola lettera in coda: nell'indice esiste un unico caso, `… policies A`. */
const TRAILING_LETTER = /\s([A-Za-z])$/;

function familyAround(label: string, start: number, length: number): string {
  return `${label.slice(0, start)} ${label.slice(start + length)}`.replace(/\s+/g, ' ').trim();
}

/**
 * Riconosce una label «a intervallo» e la scompone in famiglia + estremi.
 * `null` se la label non è di quel tipo.
 *
 * La validità è l'intervallo **crescente** (`from` ≤ `to`), ed è il filtro che
 * scarta i due falsi positivi reali dell'indice: `Hotwire Account Holder Data
 * Requests only U S` (che è «only U.S.») e `Handle inquiries from TPG team
 * Global English team S O`. Entrambi sono discendenti, quindi non sono intervalli.
 */
export function parseKbRange(rawLabel: string): KbRange | null {
  const label = rawLabel.replace(TRAILING_ARTICLE_ID, '').trim();
  if (!label) return null;

  LETTER_PAIR.lastIndex = 0;
  for (let m = LETTER_PAIR.exec(label); m; m = LETTER_PAIR.exec(label)) {
    const from = m[1].toUpperCase();
    const to = m[2].toUpperCase();
    if (from > to) continue; // non è un intervallo: «only U S», «team S O»
    // m[0] può iniziare con lo spazio che precede la prima lettera.
    const offset = m[0].startsWith(' ') ? 1 : 0;
    const family = familyAround(label, m.index + offset, m[0].length - offset);
    if (!family) continue;
    return { family, from, to };
  }

  const single = label.match(TRAILING_LETTER);
  if (single) {
    const letter = single[1].toUpperCase();
    const family = label.slice(0, single.index).trim();
    // Una famiglia di una sola parola sarebbe quasi certamente un falso positivo
    // (una label che finisce per caso con una lettera), non un intervallo.
    if (family.split(/\s+/).length < 2) return null;
    // E se la parola precedente è ANCH'ESSA una lettera sola, la label finisce
    // per coppia — e se siamo arrivati qui la coppia è stata rifiutata perché
    // discendente. Trattarne l'ultima lettera come intervallo di una lettera
    // rimetterebbe dentro esattamente i due falsi positivi che volevamo fuori:
    // «… Requests only U S» e «… English team S O».
    if (/\s[A-Za-z]$/.test(family)) return null;
    return { family, from: letter, to: letter };
  }
  return null;
}

/** L'intervallo copre l'iniziale data? */
export function rangeCovers(range: KbRange, initial: string): boolean {
  const letter = initial.toUpperCase();
  return letter >= range.from && letter <= range.to;
}

/**
 * Le iniziali dei probabili nomi propri nella query: è ciò che seleziona il
 * fratello giusto. Un nome è un token abbastanza lungo che non è una stop-word
 * né un termine del vocabolario di dominio — `lufthansa` e `avis` lo sono,
 * `riprotezione` e `policy` no perché sono vocabolario, `dimmi` e `tutte` no
 * perché sono stop-word.
 *
 * I codici vettore IATA contribuiscono l'iniziale del NOME, non del codice:
 * `TK` → *turkish* → `T`. È l'unico modo di raggiungere `S Z` per una domanda
 * su Turkish Airlines, dato che «turkish» non compare in nessun titolo.
 *
 * La regola è volutamente permissiva: un'iniziale di troppo fa salire due
 * fratelli invece di uno (entrambi restano in shortlist, e il reranker
 * sceglie), mentre un'iniziale mancante ci riporta al comportamento di oggi.
 * Fra i due errori il primo costa meno, quindi si preferisce sbagliare per
 * eccesso.
 */
export function nameInitials(query: string): string[] {
  const initials: string[] = [];
  for (const token of normalize(query).split(/[^a-z0-9]+/)) {
    if (token.length < MIN_NAME_LENGTH) continue;
    if (STOP_WORDS.has(token) || VOCAB_TERMS.has(token)) continue;
    initials.push(token[0].toUpperCase());
  }
  for (const acronym of acronymsInQuery(query)) {
    const carrier = CARRIER_NAMES[acronym];
    if (carrier) initials.push(carrier[0].toUpperCase());
  }
  return unique(initials);
}

/**
 * Il bonus da sommare al punteggio di un candidato: `RANGE_INITIAL_BOOST` se la
 * label è un intervallo che copre una delle iniziali cercate, altrimenti 0.
 */
export function rangeInitialBoost(label: string, initials: string[]): number {
  if (!initials.length) return 0;
  const range = parseKbRange(label);
  if (!range) return 0;
  return initials.some((i) => rangeCovers(range, i)) ? RANGE_INITIAL_BOOST : 0;
}
