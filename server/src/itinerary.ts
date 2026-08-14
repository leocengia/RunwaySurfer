// Da "Milano-Parigi" a "MIL-PAR".
//
// Gli agenti scrivono la coppia di città in un unico campo, indifferentemente come
// sigle o come nomi: la ricerca in Knowledge Base funziona sui codici, quindi qui
// si normalizza. La mappa è volutamente un SEED delle città più frequenti — una
// tabella IATA completa (~10.000 voci) è fuori perimetro e andrebbe caricata come
// dato, non scritta a mano. Ciò che non si risolve passa così com'è e viene
// segnalato: meglio una ricerca con il nome della città che una ricerca sbagliata.
//
// Logica pura: nessun accesso a rete o DB.

/** Città → codice IATA di città (non di aeroporto): MIL, non LIN o MXP. */
const CITY_CODES: Record<string, string> = {
  milano: 'MIL',
  milan: 'MIL',
  roma: 'ROM',
  rome: 'ROM',
  venezia: 'VCE',
  venice: 'VCE',
  napoli: 'NAP',
  naples: 'NAP',
  torino: 'TRN',
  turin: 'TRN',
  bologna: 'BLQ',
  firenze: 'FLR',
  florence: 'FLR',
  catania: 'CTA',
  palermo: 'PMO',
  bari: 'BRI',
  cagliari: 'CAG',
  parigi: 'PAR',
  paris: 'PAR',
  londra: 'LON',
  london: 'LON',
  madrid: 'MAD',
  barcellona: 'BCN',
  barcelona: 'BCN',
  lisbona: 'LIS',
  lisbon: 'LIS',
  amsterdam: 'AMS',
  bruxelles: 'BRU',
  brussels: 'BRU',
  francoforte: 'FRA',
  frankfurt: 'FRA',
  monaco: 'MUC',
  munich: 'MUC',
  berlino: 'BER',
  berlin: 'BER',
  vienna: 'VIE',
  zurigo: 'ZRH',
  zurich: 'ZRH',
  ginevra: 'GVA',
  geneva: 'GVA',
  copenaghen: 'CPH',
  copenhagen: 'CPH',
  stoccolma: 'STO',
  stockholm: 'STO',
  oslo: 'OSL',
  helsinki: 'HEL',
  dublino: 'DUB',
  dublin: 'DUB',
  praga: 'PRG',
  prague: 'PRG',
  varsavia: 'WAW',
  warsaw: 'WAW',
  budapest: 'BUD',
  atene: 'ATH',
  athens: 'ATH',
  istanbul: 'IST',
  'new york': 'NYC',
  newyork: 'NYC',
  boston: 'BOS',
  chicago: 'CHI',
  'los angeles': 'LAX',
  miami: 'MIA',
  toronto: 'YTO',
  dubai: 'DXB',
  doha: 'DOH',
  singapore: 'SIN',
  tokyo: 'TYO',
  'hong kong': 'HKG',
};

export interface CityPair {
  /** Coppia normalizzata, es. `MIL-PAR`. */
  normalized: string;
  /** Le due parti come risolte (codice o testo originale). */
  parts: string[];
  /** Parti che non è stato possibile mappare a un codice. */
  unresolved: string[];
}

/** Forma di un codice città/aeroporto: 3 lettere. NON garantisce che esista. */
function looksLikeIataCode(token: string): boolean {
  return /^[a-z]{3}$/i.test(token);
}

/** I codici che il seed conosce, per distinguere una sigla vera da un refuso. */
const KNOWN_CODES = new Set(Object.values(CITY_CODES));

function resolveOne(raw: string): { value: string; resolved: boolean } {
  const token = raw.trim();
  if (!token) return { value: '', resolved: false };
  if (looksLikeIataCode(token)) {
    const code = token.toUpperCase();
    // La forma da sola non basta: "MIL" è un codice, "XYZ" e un refuso di tre
    // lettere hanno la stessa forma. Marcare `resolved: true` su qualunque
    // tripletta significava promuovere un errore di battitura a codice IATA
    // valido, con l'agente convinto di aver scritto un itinerario corretto.
    // Il seed non è completo, quindi il codice si tiene comunque (maiuscolo,
    // pronto per la ricerca) ma solo quelli noti risultano risolti.
    return { value: code, resolved: KNOWN_CODES.has(code) };
  }
  const key = token.toLowerCase().replace(/\s+/g, ' ');
  const code = CITY_CODES[key] ?? CITY_CODES[key.replace(/\s+/g, '')];
  return code ? { value: code, resolved: true } : { value: token, resolved: false };
}

/**
 * Interpreta il campo libero "Impacted Itinerary (City Pair)".
 *
 * Accetta i separatori che gli agenti usano davvero (`-`, `–`, `/`, `>`, `→`,
 * ` a `, ` to `). Se non trova un separatore restituisce il testo come parte
 * singola, invece di indovinare: una coppia inventata sarebbe peggio di una
 * ricerca sul testo originale.
 */
export function parseCityPair(input: string): CityPair {
  const raw = (input ?? '').trim();
  if (!raw) return { normalized: '', parts: [], unresolved: [] };

  const tokens = raw
    .split(/\s*(?:-|–|—|\/|>|→|\bto\b|\ba\b)\s*/i)
    .map((t) => t.trim())
    .filter(Boolean);

  const resolvedParts = tokens.map(resolveOne);
  return {
    normalized: resolvedParts.map((p) => p.value).join('-'),
    parts: resolvedParts.map((p) => p.value),
    unresolved: resolvedParts.filter((p) => !p.resolved).map((p) => p.value),
  };
}
