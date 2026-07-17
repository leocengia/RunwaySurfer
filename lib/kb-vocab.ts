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

import { normalize } from './text';

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
  escalate: ['escalate', 'escalation', 'complaint', 'escalation', 'reclamo', 'lamentela'],
  compensation: ['compensation', 'compensate', 'voucher', 'compenso', 'indennizzo', 'buono'],
  relocation: ['relocation', 'rebooking', 'rerouting', 'riprotezione', 'ricollocazione'],

  // --- Prodotti -------------------------------------------------------------
  flight: ['flight', 'flights', 'airline', 'airfare', 'volo', 'voli', 'aereo', 'compagnia'],
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
  package: ['package', 'bundle', 'pacchetto', 'combinato'],
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
};

/** Concetti i cui alias (EN o IT) compaiono nella query normalizzata. */
export function conceptsInQuery(query: string): string[] {
  const hay = normalize(query).replace(/[^a-z0-9]+/g, ' ');
  return Object.entries(INTENT_ALIASES)
    .filter(([, aliases]) => aliases.some((a) => hay.includes(normalize(a))))
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
  for (const concept of conceptsInQuery(query)) {
    for (const term of [concept, ...INTENT_ALIASES[concept]]) {
      const t = normalize(term).replace(/[^a-z0-9]/g, '');
      if (t.length > 3 && !have.has(t)) extra.add(t);
    }
  }
  return Array.from(extra);
}
