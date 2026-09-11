// Articoli dedicati per vettore (Fase 2, D1 del tuning del routing).
//
// LA PROVA. La KB ha 10 pagine "<Nome> <CODICE IATA> airline policies" — una
// per vettore. Sul modulo di etichettatura compilato dagli esperti KB
// (docs/Domande Agenti e match con la KB (compilato).docx), 8 risposte su 27
// indicano `Lufthansa-LH-airline-policies` come l'articolo giusto, su CINQUE
// temi diversi (riprotezione, cancellazione, ASC, rimborso posti, major
// schedule change): quando la query nomina un vettore che ha un articolo
// dedicato, quell'articolo è la risposta, qualunque sia il tema. Prima di
// questo modulo lo scorer non lo sapeva: l'unico segnale per i nomi di
// vettore era il bonus di intervallo alfabetico (lib/kb-ranges.ts), che porta
// al fratello sbagliato — un intervallo con 4-5 vettori dentro, non
// all'articolo specifico.
//
// L'intervallo alfabetico resta il RIPIEGO per i vettori che un articolo
// dedicato non ce l'hanno: Emirates non è in questo elenco, e la risposta
// giusta per «devo cercare la policy di emirates» è infatti
// `Global-airline-schedule-change-policies-E-H` (Emirates → E).
//
// LA TABELLA SI DERIVA DALL'INDICE, non è scritta a mano: se la KB aggiunge o
// rimuove un vettore dedicato, questo modulo lo segue da solo alla prossima
// build, senza bisogno di una modifica qui. `tests/kb-carriers.test.ts`
// verifica che i 10 codici attesi siano ancora risolvibili — la rete di
// sicurezza contro un rebuild dell'indice che rinomini le label in silenzio.
import { cleanKbLabel } from './kb-index';
import { aliasMatchesTokens, normalize } from './text';
import { linkIdentity } from './site-profile';
import { acronymsInQuery } from './kb-vocab';
import indexData from './kb-index.json';

interface KbIndexRecord {
  u: string;
  s: string;
  l: string;
}
interface KbIndexFile {
  articles: KbIndexRecord[];
}

const index = indexData as KbIndexFile;

/** Bonus quando la query nomina un vettore che ha un articolo dedicato. */
export const DEDICATED_CARRIER_BOOST = 20;

const DEDICATED_ARTICLE_RE = /^(.+?)\s+([A-Za-z0-9]{2})\s+airline policies$/i;
const TRAILING_ARTICLE_ID = /\s+\d{10,}$/;

let cache: Map<string, string> | null = null;

/**
 * Codice IATA (minuscolo) → identità dell'URL (`linkIdentity`, non l'URL
 * grezzo: così il confronto in lib/crawl.ts ignora query param e fragment,
 * coerente con come il resto del file compara i link) del suo articolo
 * dedicato. Scansiona l'indice una sola volta (memoizzato): è statico per
 * tutta la vita della pagina, come `kbIndexAsLinks` in lib/kb-index.ts.
 */
export function dedicatedCarrierArticles(): Map<string, string> {
  if (cache) return cache;
  cache = new Map();
  for (const a of index.articles) {
    const label = cleanKbLabel(a.l).replace(TRAILING_ARTICLE_ID, '').trim();
    const m = label.match(DEDICATED_ARTICLE_RE);
    if (!m) continue;
    try {
      cache.set(m[2].toLowerCase(), linkIdentity(new URL(a.u)));
    } catch {
      /* URL non valido nell'indice: lo salta invece di far cadere l'intero modulo. */
    }
  }
  return cache;
}

/** Solo per i test: forza una nuova scansione dell'indice al prossimo uso. */
export function resetDedicatedCarrierArticlesCache(): void {
  cache = null;
}

/**
 * Come riconoscere ogni vettore dedicato PER NOME nella query — mai per
 * codice nudo quando il codice collide con una parola comune (vedi il
 * commento su `am`/`as`/`ac` in lib/kb-vocab.ts, CARRIER_NAMES). Include
 * comunque i vettori il cui codice È sicuro come token bare (lh, ba, dl, ua,
 * aa — già in CARRIER_NAMES): per quelli il riconoscimento per nome è
 * ridondante con `acronymsInQuery` sotto, ma tenerli qui rende questa tabella
 * completa e leggibile da sola, senza dover incrociare due file per sapere
 * come si riconosce un vettore.
 */
const CARRIER_RECOGNITION_ALIASES: Record<string, string[]> = {
  aa: ['american', 'american airlines'],
  ac: ['air canada'],
  am: ['aeromexico', 'aero mexico'],
  as: ['alaska', 'alaska airlines'],
  ba: ['british airways'],
  b6: ['jetblue', 'jet blue'],
  dl: ['delta'],
  // `lhg` = Lufthansa Group — stesso riconoscimento già usato per l'espansione
  // in lib/kb-vocab.ts (ACRONYM_EXPANSIONS.lhg).
  lh: ['lufthansa', 'lhg'],
  ua: ['united', 'united airlines'],
  ws: ['westjet', 'west jet'],
};

/**
 * I codici IATA dei vettori DEDICATI nominati nella query, per nome o (per i
 * codici sicuri) per codice nudo. Ogni codice tornato ha per costruzione un
 * articolo dedicato risolvibile in `dedicatedCarrierArticles()`.
 */
export function carriersInQuery(query: string): string[] {
  const tokens = normalize(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const dedicated = dedicatedCarrierArticles();
  const found = new Set<string>();
  for (const [code, aliases] of Object.entries(CARRIER_RECOGNITION_ALIASES)) {
    if (!dedicated.has(code)) continue; // l'indice non ha (più) questo articolo
    if (aliases.some((a) => aliasMatchesTokens(a, tokens))) found.add(code);
  }
  // Codici bare già vagliati come sicuri da lib/kb-vocab.ts (nessuna
  // collisione con parole comuni): riusa il riconoscimento esistente invece
  // di duplicarne le regole.
  for (const code of acronymsInQuery(query)) {
    if (dedicated.has(code)) found.add(code);
  }
  return [...found];
}
