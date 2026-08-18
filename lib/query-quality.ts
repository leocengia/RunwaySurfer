// Quanto è utilizzabile una domanda, prima di spendere una chiamata a pagamento.
//
// IL PROBLEMA REALE: `"e poi?"` parte senza alcun avviso. `pageCoverage`
// (lib/off-topic.ts) scarta le parole sotto 4 lettere, quindi una domanda del
// genere non ha termini utili e la funzione ritorna 1 — copertura massima — così
// `isOffTopic` dice "no" e la risposta viene costruita SOLO sulla pagina aperta,
// qualunque essa sia. Peggio: il router la classifica `simple` e le assegna il
// modello meno capace, cioè la domanda più ambigua prende il trattamento più
// economico.
//
// PERCHÉ È STATA RISCRITTA (Giro 4). La prima versione contava i «termini di
// contenuto» della domanda, e sulle 27 query reali del sondaggio agenti dava il
// verdetto ROVESCIATO:
//   - `relocation` → segnalata come vaga, ma il prefiltro le trova 323 candidati
//     con 40 a punteggio pieno: è una domanda eccellente;
//   - `ndc emea` → segnalata, ed è specificissima (71 candidati, uno solo in testa);
//   - `booking refund` → NON segnalata, ed è la meno discriminante del lotto
//     (479 candidati, 11 a pari merito in testa).
// Contare le parole misura la lunghezza, non l'informatività. Il segnale giusto
// ce l'abbiamo già in locale e a costo zero: cosa produce il prefiltro.
//
// COSA NON PROVA A FARE. `tier` è una domanda che oggi finisce sul pool
// sbagliato — l'agente intende i livelli fedeltà, la KB intende l'escalation
// interna (`When to escalate to Tier 3`) — ma dall'evidenza di retrieval appare
// come una buona domanda: 49 candidati, 32 che contengono davvero «tier». È un
// disallineamento di significato, e nessuna soglia locale può distinguerlo da
// `ndc`, che ha una distribuzione identica ed è invece precisa. Non lo segnaliamo
// piuttosto che segnalarlo a caso.
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
 * Cosa il prefiltro locale sa dire di una domanda. La produce
 * `retrievalEvidence` in lib/crawl.ts, sull'indice KB reale e senza rete.
 */
export interface RetrievalEvidence {
  /** Quanti articoli hanno punteggio > 0. */
  candidates: number;
  /** Punteggio del candidato migliore. */
  topScore: number;
}

/**
 * Sotto questo punteggio nemmeno una keyword della domanda compare nel titolo
 * di un articolo: un hit sul titolo vale 5, quindi 5 è la soglia sotto la quale
 * i pochi candidati vengono solo da frammenti dell'URL. È il caso dei refusi —
 * `SAFTY` arriva a 4 — e va detto, perché l'agente non ha modo di accorgersene.
 */
const MIN_USEFUL_TOP_SCORE = 5;

/**
 * Giudica la domanda a partire da ciò che il prefiltro ha davvero trovato.
 * Nessun candidato = il retrieval non ha su cosa lavorare e la risposta finirebbe
 * per appoggiarsi alla pagina aperta per caso.
 */
export function assessQuery(query: string, evidence: RetrievalEvidence): QueryAssessment {
  if (!query.trim()) return { vague: false, hint: '' };

  if (evidence.candidates === 0) {
    return {
      vague: true,
      hint: 'Nessun articolo della KB corrisponde a questa domanda: aggiungi l’argomento (il vettore, «rimborso», «cambio nome») altrimenti la risposta si limiterà alla pagina aperta.',
    };
  }
  if (evidence.topScore < MIN_USEFUL_TOP_SCORE) {
    return {
      vague: true,
      hint: 'Nessun titolo di articolo contiene i termini di questa domanda: controlla che non ci sia un errore di battitura, o prova con un sinonimo.',
    };
  }
  return { vague: false, hint: '' };
}
