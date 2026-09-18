// Vocabolario di dominio della KB Runway (aviazione/travel), derivato dai 135
// topic della sitemap Salesforce (docs/MAPPA-KB.md, Passa 8). Sostituisce il
// vecchio INTENT_ALIASES generico da e-commerce: qui i concetti sono quelli
// reali del knowledge base — prodotti (flight/lodging/car…), azioni
// (refund/cancel/change…), attori (brand/partner). Ogni concetto elenca alias
// EN **e** IT: gli alias italiani abilitano il match cross-lingua sullo scorer
// (query IT dell'agente vs contenuto/slug EN della KB — vedi E3).
//
// I valori vanno tenuti in minuscolo e senza accenti (confrontati dopo
// normalize()). Concetto = chiave inglese (compare nelle reason dello scoring).
// PRIMO alias di ogni concetto = termine EN canonico (usato per l'espansione
// cross-lingua della query, vedi expandQueryTerms).

import { aliasMatchesTokens, normalize, unique } from './text';

export const INTENT_ALIASES: Record<string, string[]> = {
  // --- Azioni sul viaggio ---------------------------------------------------
  refund: ['refund', 'reimbursement', 'rimborso', 'rimborsare', 'rimborsi', 'credito'],
  cancel: [
    'cancel',
    'cancellation',
    'cancelled',
    'annulla',
    'annullare',
    'annullamento',
    'cancellare',
  ],
  change: [
    'change',
    'changed',
    'modify',
    'reschedule',
    'rebook',
    'cambio',
    'cambiare',
    'modifica',
    'modificare',
  ],
  book: [
    'book',
    'booking',
    'reservation',
    'reserve',
    'purchase',
    'prenota',
    'prenotare',
    'prenotazione',
    'acquisto',
  ],
  billing: [
    'billing',
    'payment',
    'invoice',
    'charge',
    'pagamento',
    'fattura',
    'addebito',
    'pagare',
  ],
  authorization: [
    'authorization',
    'authorisation',
    'preauth',
    'hold',
    'autorizzazione',
    'preautorizzazione',
  ],
  refundtax: ['tax', 'taxes', 'fee', 'fees', 'tassa', 'tasse', 'imposta', 'commissione'],
  escalate: [
    'escalate',
    'escalation',
    'complaint',
    'complaints',
    'reclamo',
    'reclami',
    'lamentela',
    'lamentele',
  ],
  compensation: [
    'compensation',
    'compensate',
    'voucher',
    'compenso',
    'compensazione',
    'compensazioni',
    'indennizzo',
    'indennizzi',
    'buono',
    'buoni',
  ],
  relocation: [
    'relocation',
    'rebooking',
    'rerouting',
    'riprotezione',
    'riprotezioni',
    'riproteggere',
    'ricollocazione',
  ],
  // D6 del tuning: «trasferire a relocation», «quali sono tutti motivi di
  // relocation» — la risposta è sempre l'articolo su A CHI passare il caso
  // (When to transfer or escalate to Reservation Services), non un articolo
  // SUL tema relocation. Concetto separato da `relocation` perché la domanda
  // può nominare l'uno senza l'altro (vedi anche CONCEPT_KB_TERMS sotto, dove
  // il ponte relocation→handoff è invece unidirezionale).
  handoff: [
    'transfer',
    'transfers',
    'escalate',
    'escalation',
    'trasferire',
    'trasferimento',
    'inoltrare',
    // NON "passare"/"girare": verbi italiani troppo generici (passare il
    // tempo, girare a destra…) — esattamente il tipo di falso positivo
    // corretto altrove in questo stesso giro di tuning (D2, alias ancorati).
  ],

  // --- Prodotti -------------------------------------------------------------
  flight: [
    'flight',
    'flights',
    'airline',
    'airfare',
    'volo',
    'voli',
    'aereo',
    'compagnia',
    'compagnie',
  ],
  schedule: [
    'schedule',
    'scheduling',
    'timetable',
    'delay',
    'delayed',
    'orario',
    'orari',
    'ritardo',
  ],
  baggage: ['baggage', 'luggage', 'bag', 'bags', 'bagaglio', 'bagagli', 'valigia'],
  lodging: ['lodging', 'hotel', 'hotels', 'accommodation', 'alloggio', 'albergo', 'sistemazione'],
  car: ['car', 'rental', 'vehicle', 'auto', 'noleggio', 'macchina', 'veicolo'],
  package: ['package', 'packages', 'bundle', 'pacchetto', 'pacchetti', 'combinato'],
  cruise: ['cruise', 'cruises', 'crociera', 'crociere'],
  insurance: ['insurance', 'coverage', 'assicurazione', 'copertura'],
  activity: ['activity', 'activities', 'excursion', 'tour', 'attivita', 'escursione'],

  // --- Attori / canali ------------------------------------------------------
  checkin: ['checkin', 'check-in', 'boarding', 'imbarco', 'accettazione'],
  seat: ['seat', 'seats', 'seating', 'posto', 'posti', 'assegnazione'],
  document: [
    'document',
    'documents',
    'passport',
    'visa',
    'documento',
    'documenti',
    'passaporto',
    'visto',
  ],

  // --- Forme che gli agenti hanno davvero scritto nel sondaggio -------------
  // `conceptsInQuery` verifica `query.includes(alias)`: l'alias deve stare
  // DENTRO la query, quindi ogni flessione va elencata. `policies` è la forma
  // con 109 label contro le 57 di `policy`, e `policy` compare in 6 delle 27
  // query reali: senza questa coppia «ASC lufthansa policy» valeva zero.
  policy: ['policies', 'policy', 'politica', 'politiche', 'regola', 'regole', 'normativa'],
  contact: ['contact', 'contacts', 'contatto', 'contatti', 'recapito', 'recapiti', 'telefono'],
  reason: ['reason', 'reasons', 'motivo', 'motivi', 'causale', 'causali'],
  segment: ['segment', 'segments', 'segmento', 'segmenti', 'tratta', 'tratte'],
  scenario: ['scenarios', 'scenario', 'casistica', 'casistiche', 'situazione', 'situazioni'],
};

/**
 * Acronimi che compaiono LETTERALMENTE come parola nei titoli della KB, con il
 * numero di label che li contengono (verificato sull'indice, non stimato).
 *
 * `wordsOf` scarta i token ≤3 caratteri, quindi oggi questi sono invisibili al
 * retrieval. Non basta però abbassare la soglia: `matchedKeywords` fa
 * **substring non ancorato**, e `asc` matcherebbe *Mada**gasc**ar*, *TASC* e
 * *ma**sc**otas* — tre falsi positivi reali dell'indice. Perciò questi termini
 * vanno confrontati con **confine di parola** (vedi `matchedKeywords`), ed è
 * l'unica ragione per cui esistono due meccanismi invece di uno.
 *
 * `pos` è volutamente fuori: 27 label lo contengono come parola ma 173 come
 * sottostringa (*position*, *purpose*, *exposed*), ed è troppo generico per
 * portare informazione da solo.
 */
export const KB_ACRONYMS = new Set([
  'adm', // 44 label
  'amer', // 19
  'apac', // 56
  'asc', // 40 — airline schedule change
  'bex', // 56
  'emea', // 40
  'eps', // 33
  'gdpr', // 1
  'gds', // 81
  'hcom', // 19 — hotels.com
  'iar', // 6
  'irrop', // 4
  'lh', // 2 — Lufthansa
  'lx', // 2 — Swiss
  'ndc', // 19
  'pls', // 1
  'rbc', // 56
  'ticf', // 2
  'vrbo', // 30
]);

/**
 * Acronimi il cui SIGNIFICATO compare nei titoli mentre l'acronimo da solo non
 * basta: si espandono nelle parole che la KB usa davvero. `ASC` è in entrambi
 * gli elenchi — compare letteralmente in 40 label, ma la sua espansione ne
 * raggiunge altre 21 che scrivono «airline schedule change» per esteso.
 */
export const ACRONYM_EXPANSIONS: Record<string, string[]> = {
  asc: ['airline', 'schedule', 'change'],
  lhg: ['lufthansa', 'group'],
  hcom: ['hotels'],
  irrop: ['irregular', 'operations'],
  ndc: ['newdistributioncapability'],
  pls: ['partner', 'lodging'],
};

/**
 * Codici vettore IATA → nome della compagnia. Doppio scopo: il nome entra fra
 * le keyword (Lufthansa compare in 6 label, Emirates in 2), e soprattutto la
 * sua INIZIALE alimenta la disambiguazione degli intervalli alfabetici in
 * lib/kb-ranges.ts — `TK` → *Turkish* → `T`. Serve anche quando il nome non
 * compare in alcuna label: *Turkish* è in 0 titoli, ma l'articolo che risponde
 * è `Global airline schedule change policies S Z`, e senza la `T` non c'è modo
 * di saperlo.
 */
export const CARRIER_NAMES: Record<string, string> = {
  aa: 'american',
  af: 'airfrance',
  az: 'ita',
  b6: 'jetblue', // 2 lettere+cifra: non collide con nessuna parola comune
  ba: 'britishairways',
  dl: 'delta',
  ek: 'emirates',
  kl: 'klm',
  lh: 'lufthansa',
  lx: 'swiss',
  os: 'austrian',
  qr: 'qatar',
  sn: 'brussels',
  tk: 'turkish',
  ua: 'united',
  ws: 'westjet',
  // NON aggiunti qui: `am` (Aeromexico) e `as` (Alaska) sono anche parole
  // inglesi comunissime ("I **am**", "**as** soon as") e `ac` è un'abbreviazione
  // diffusa (aria condizionata) — come chiave qui diventerebbero token bare che
  // `acronymsInQuery` riconosce in QUALUNQUE query che li contenga per caso,
  // alimentando sia `nameInitials` sia (via lib/kb-carriers.ts)
  // DEDICATED_CARRIER_BOOST. Questi tre vettori restano riconoscibili solo per
  // NOME (lib/kb-carriers.ts, CARRIER_RECOGNITION_ALIASES), mai per codice nudo.
};

/**
 * Come la KB TITOLA un concetto, quando usa parole che non sono suoi sinonimi.
 *
 * Serve un meccanismo separato dagli alias perché la direzione è una sola. In
 * questa KB la riprotezione di un volo cancellato dal vettore è documentata
 * sotto «airline schedule change policies»: una query su `riprotezione` deve
 * quindi cercare anche `schedule` e `change`. Metterli fra gli alias di
 * `relocation` avrebbe invece fatto scattare il concetto *relocation* su
 * qualunque domanda contenente «change» — parola comunissima — inquinando tutto
 * il resto. Qui l'espansione va solo query → titoli.
 */
export const CONCEPT_KB_TERMS: Record<string, string[]> = {
  // "riprotezione"/"relocation" copre DUE famiglie di articoli reali: quelli
  // sulla policy di schedule change (schedule/change/rebook, come prima) e
  // quello su A CHI passare il caso — «When to transfer or escalate to
  // Reservation Services» — da cui transfer/escalate/reservation/services.
  // Verificato che nessuno dei quattro è generico nella KB (13-42 label su
  // 2964): non diluisce le query che intendevano la prima famiglia.
  relocation: ['schedule', 'change', 'rebook', 'transfer', 'escalate', 'reservation', 'services'],
  handoff: ['transfer', 'escalate', 'reservation', 'services'],
  scenario: ['policies'],
};

/**
 * Concetti i cui alias (EN o IT) compaiono nella query, a livello di TOKEN
 * (vedi `aliasMatchesTokens`) — non di sottostringa: «devo **cer**car**e** la
 * policy di emirates» non deve più attivare il concetto `car`.
 */
export function conceptsInQuery(query: string): string[] {
  const tokens = normalize(query)
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  return Object.entries(INTENT_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => aliasMatchesTokens(a, tokens)))
    .map(([concept]) => concept);
}

/**
 * Espansione cross-lingua della query (E3): per ogni concetto colpito dalla
 * query (anche via alias italiano), aggiunge i termini del concetto — inclusa
 * la chiave EN e gli alias EN — così lo scorer e il retrieval "vedono" i
 * termini inglesi presenti nel contenuto/slug della KB. Iniettare un alias che
 * non compare nel testo EN è innocuo (non matcha), il guadagno è il ponte
 * IT→EN. Restituisce solo i termini NUOVI (len>3), da unire alle keyword base.
 */
export function expandQueryTerms(query: string, existing: string[] = []): string[] {
  const have = new Set(existing.map((w) => normalize(w)));
  const extra = new Set<string>();
  const add = (term: string): void => {
    const t = normalize(term).replace(/[^a-z0-9]/g, '');
    if (t.length > 3 && !have.has(t)) extra.add(t);
  };
  for (const concept of conceptsInQuery(query)) {
    for (const term of [concept, ...INTENT_ALIASES[concept]]) add(term);
    for (const term of CONCEPT_KB_TERMS[concept] ?? []) add(term);
  }
  // A2 · gli acronimi che la KB scrive per esteso, e i nomi dei vettori dietro
  // i codici IATA. Un termine iniettato che non compare in alcun titolo è
  // innocuo (non matcha); il guadagno è il ponte acronimo→parole.
  for (const acronym of acronymsInQuery(query)) {
    for (const word of ACRONYM_EXPANSIONS[acronym] ?? []) add(word);
    const carrier = CARRIER_NAMES[acronym];
    if (carrier) add(carrier);
  }
  return Array.from(extra);
}

/**
 * Le espansioni attribuibili a UN SOLO termine della domanda.
 *
 * Differisce da `expandQueryTerms`, che restituisce l'unione delle espansioni di
 * tutta la query: per lo scoring per keyword quell'unione va benissimo, ma per
 * misurare la COPERTURA di una pagina serve sapere quale espansione appartiene a
 * quale parola. Senza questa distinzione una pagina intitolata «Refund
 * **policy**» risultava coprire la domanda «regole franchigia baggage
 * allowance», perché il credito guadagnato da `regole`→`policies` veniva
 * accreditato ai termini sui bagagli, che nella pagina non c'erano.
 */
export function expandTerm(term: string): string[] {
  const token = normalize(term).replace(/[^a-z0-9]/g, '');
  if (!token) return [];
  const out = new Set<string>();
  const add = (raw: string): void => {
    const t = normalize(raw).replace(/[^a-z0-9]/g, '');
    if (t.length > 3 && t !== token) out.add(t);
  };
  for (const [concept, aliases] of Object.entries(INTENT_ALIASES)) {
    // `token` è già UN SOLO termine della query: lo stesso confronto per token
    // di `conceptsInQuery`, con un haystack di un elemento solo. Corregge anche
    // qui il falso positivo `car` ⊂ `cercare` (prima: `token.includes(alias)`,
    // sottostringa a caso).
    if (!aliases.some((a) => aliasMatchesTokens(a, [token]))) continue;
    for (const t of [concept, ...aliases]) add(t);
    for (const t of CONCEPT_KB_TERMS[concept] ?? []) add(t);
  }
  for (const t of ACRONYM_EXPANSIONS[token] ?? []) add(t);
  const carrier = CARRIER_NAMES[token];
  if (carrier) add(carrier);
  return Array.from(out);
}

/**
 * Token della query che sono acronimi noti alla KB o codici vettore. Vengono
 * estratti a parte da `wordsOf` perché sono ≤3 caratteri e quello li scarta, e
 * vanno confrontati con confine di parola (vedi `KB_ACRONYMS`).
 */
export function acronymsInQuery(query: string): string[] {
  const tokens = normalize(query).split(/[^a-z0-9]+/);
  return unique(
    tokens.filter(
      (t) => t && (KB_ACRONYMS.has(t) || t in ACRONYM_EXPANSIONS || t in CARRIER_NAMES),
    ),
  );
}

/**
 * Gli acronimi della query che vanno cercati LETTERALMENTE nei titoli, cioè
 * quelli che la KB scrive davvero (`KB_ACRONYMS`). `lhg` o `tk` non finiscono
 * qui: nessun titolo li contiene, servono solo per l'espansione.
 */
export function anchoredTermsInQuery(query: string): string[] {
  return acronymsInQuery(query).filter((t) => KB_ACRONYMS.has(t));
}

/**
 * Tutti i termini del vocabolario, in una sola collezione. Serve a
 * lib/kb-ranges.ts per riconoscere quali parole della query NON sono
 * vocabolario, e quindi sono probabilmente nomi propri (un vettore, un
 * autonoleggio) la cui iniziale seleziona l'intervallo alfabetico giusto.
 */
export const VOCAB_TERMS: Set<string> = new Set(
  Object.entries(INTENT_ALIASES).flatMap(([concept, aliases]) =>
    [concept, ...aliases].map((t) => normalize(t).replace(/[^a-z0-9]/g, '')),
  ),
);
