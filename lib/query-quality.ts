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
  /**
   * La query produce almeno un termine/acronimo utilizzabile per la ricerca
   * (`planQuery` non torna `null`). Falso per "e poi?", "???": pura
   * punteggiatura o riempitivi, zero parole di contenuto.
   */
  hasTerms: boolean;
  /** Quanti articoli hanno punteggio > 0. */
  candidates: number;
  /** Punteggio del candidato migliore. */
  topScore: number;
  /**
   * Quanti candidati hanno almeno un hit (diretto o per espansione) nel
   * TITOLO — non nello slug, non nel contesto, non solo per concetto.
   */
  titleHits: number;
}

/**
 * Giudica la domanda a partire da ciò che il prefiltro ha davvero trovato, con
 * tre segnali ADIMENSIONALI invece di una soglia sul punteggio.
 *
 * PERCHÉ NON PIÙ UNA SOGLIA SUL PUNTEGGIO. La versione precedente diceva
 * «sotto 5 è vaga», perché un hit sul titolo valeva 5. Da quando lo scoring
 * pesa i match per IDF (Fase 3 del tuning) quel 5 non significa più niente: un
 * hit sul titolo vale fra 1,75 e 10 a seconda di quanto il termine sia raro
 * nella KB, e la soglia fissa avrebbe segnalato domande buone o lasciato
 * passare domande vuote a seconda del termine, non della qualità della
 * domanda. I tre segnali sotto sono fatti concreti sul retrieval — c'è un
 * termine? c'è un candidato? il termine sta nel titolo? — indipendenti dalla
 * scala dei punteggi, quindi non si scordano a ogni intervento sullo scorer.
 */
export function assessQuery(query: string, evidence: RetrievalEvidence): QueryAssessment {
  if (!query.trim()) return { vague: false, hint: '' };

  if (!evidence.hasTerms) {
    return {
      vague: true,
      hint: 'Aggiungi l’argomento della domanda (il vettore, «rimborso», «cambio nome»): senza almeno una parola di contenuto la risposta si limiterà alla pagina aperta.',
    };
  }
  if (evidence.candidates === 0) {
    return {
      vague: true,
      hint: 'Nessun articolo della KB corrisponde a questa domanda: controlla che non ci sia un errore di battitura, o prova con un sinonimo.',
    };
  }
  if (evidence.titleHits === 0) {
    return {
      vague: true,
      hint: 'Nessun titolo di articolo contiene i termini di questa domanda: i pochi candidati vengono solo da frammenti dell’URL o dal contesto — prova a essere più specifico.',
    };
  }
  return { vague: false, hint: '' };
}
