// Quanto è utilizzabile una domanda, prima di spendere una chiamata a pagamento.
//
// IL PROBLEMA REALE: oggi `"e poi?"` parte senza alcun avviso. `pageCoverage`
// (lib/off-topic.ts) scarta le parole sotto 4 lettere, quindi una domanda del
// genere non ha termini utili e la funzione ritorna 1 — copertura massima — così
// `isOffTopic` dice "no" e la risposta viene costruita SOLO sulla pagina aperta,
// qualunque essa sia. Peggio: il router la classifica `simple` e le assegna il
// modello meno capace, cioè la domanda più ambigua prende il trattamento più
// economico.
//
// Questo modulo NON blocca niente. Produce un suggerimento, perché l'agente sa
// cose che noi non sappiamo: a volte una domanda di due parole è esattamente
// quello che serve, e sbarrargli la strada sarebbe peggio di una risposta
// imprecisa.

export interface QueryAssessment {
  /** true se vale la pena suggerire di essere più specifici. */
  vague: boolean;
  /** Suggerimento pronto da mostrare, o '' se la domanda va bene. */
  hint: string;
}

/**
 * Le stesse 4 lettere di `baseTerms` in lib/off-topic.ts: sotto quella soglia una
 * parola non contribuisce al retrieval, quindi non conta come contenuto.
 */
const MIN_TERM_LENGTH = 4;

/** Parole che occupano spazio senza dire di cosa si parla. */
const FILLER = new Set([
  'come',
  'cosa',
  'quando',
  'dove',
  'perche',
  'perché',
  'quale',
  'quali',
  'posso',
  'devo',
  'fare',
  'dire',
  'sapere',
  'questo',
  'questa',
  'quello',
  'quella',
  'allora',
  'quindi',
  'grazie',
  'ciao',
  'aiuto',
  'info',
  'informazioni',
]);

function contentTerms(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= MIN_TERM_LENGTH && !FILLER.has(word));
}

/**
 * Giudica la domanda. Vaga = nessun termine di contenuto, che è esattamente il
 * caso in cui il retrieval non ha su cosa lavorare e la risposta finirebbe per
 * appoggiarsi alla pagina aperta per caso.
 */
export function assessQuery(query: string): QueryAssessment {
  const trimmed = query.trim();
  if (!trimmed) return { vague: false, hint: '' };
  const terms = contentTerms(trimmed);

  if (terms.length === 0) {
    return {
      vague: true,
      hint: 'La domanda non contiene termini su cui cercare: aggiungi l’argomento (es. il vettore, «rimborso», «cambio nome») per una risposta che non si limiti alla pagina aperta.',
    };
  }
  if (terms.length === 1 && trimmed.length < 25) {
    return {
      vague: true,
      hint: `Domanda molto generica: con il solo termine «${terms[0]}» la risposta potrebbe non essere quella che ti serve. Aggiungi il vettore o il caso specifico.`,
    };
  }
  return { vague: false, hint: '' };
}
