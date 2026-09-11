// Riconoscere una domanda su cui il retrieval non ha niente su cui lavorare.
//
// Il caso che ha motivato il modulo: `"e poi?"` partiva senza avvisi.
// `pageCoverage` scarta le parole sotto 4 lettere, quindi non trova termini utili
// e ritorna 1 (copertura massima) → `isOffTopic` dice no → la risposta si
// costruisce SOLO sulla pagina aperta, qualunque sia. E il router la classifica
// `simple`, assegnandole il modello meno capace.
//
// Il valore qui è nei FALSI POSITIVI: un avviso su una domanda buona insegna
// all'agente a ignorare gli avvisi. Per questo la maggior parte dei casi gira
// sull'INDICE KB REALE (nessuna rete): la versione precedente di questo modulo
// contava le parole della domanda e sulle query vere del sondaggio dava il
// verdetto rovesciato — segnalava `relocation`, che di candidati ne ha 323.
import { describe, expect, it } from 'vitest';
import { assessQuery, type RetrievalEvidence } from '../lib/query-quality';
import { retrievalEvidence } from '../lib/crawl';

/** Il giudizio su una domanda vera, con l'evidenza dell'indice KB bundle-ato. */
function judge(query: string) {
  return assessQuery(query, retrievalEvidence([], query));
}

describe('assessQuery · segnala (sull’indice KB reale)', () => {
  it('una domanda di sole parole vuote: nessun candidato', () => {
    const { vague, hint } = judge('e poi?');
    expect(vague).toBe(true);
    expect(hint).toMatch(/argomento/i);
  });

  it('una domanda fatta solo di riempitivi', () => {
    expect(judge('come posso fare questo?').vague).toBe(true);
  });

  it('la punteggiatura da sola', () => {
    expect(judge('???').vague).toBe(true);
  });

  it('un refuso: nessun TITOLO contiene i termini', () => {
    // `SAFTY` (per SAFETY) è uno dei due refusi reali del sondaggio. Arriva a
    // punteggio massimo 4: sotto un singolo hit sul titolo, che vale 5.
    const { vague, hint } = judge('SAFTY');
    expect(vague).toBe(true);
    expect(hint).toMatch(/battitura|sinonimo/i);
  });
});

describe('assessQuery · NON segnala (sull’indice KB reale)', () => {
  it('una domanda normale sulle policy', () => {
    expect(judge('si può cambiare il nome sul biglietto dopo il check-in?').vague).toBe(false);
  });

  it('`relocation` da sola: 323 candidati, non è vaga', () => {
    // Il caso che ha smascherato l'euristica precedente, che la segnalava.
    expect(judge('relocation').vague).toBe(false);
  });

  it('`ndc emea`: due acronimi sono specificissimi', () => {
    expect(judge('ndc emea').vague).toBe(false);
  });

  it('una domanda con acronimo e vettore', () => {
    expect(judge('ASC lufthansa policy').vague).toBe(false);
  });

  it('una stringa vuota non è "vaga": non c’è niente da suggerire', () => {
    // Il pulsante di ricerca è già disabilitato in quel caso.
    expect(judge('   ')).toEqual({ vague: false, hint: '' });
  });
});

describe('assessQuery · i tre segnali, in isolamento', () => {
  // Adimensionali di proposito (niente soglia sul punteggio, che con l'IDF
  // della Fase 3 non ha più una scala fissa — vedi il commento su assessQuery
  // in lib/query-quality.ts). `over` sovrascrive solo il segnale sotto esame.
  const ev = (over: Partial<RetrievalEvidence>): RetrievalEvidence => ({
    hasTerms: true,
    candidates: 3,
    topScore: 10,
    titleHits: 1,
    ...over,
  });

  it('nessun termine utilizzabile: vaga a prescindere dal resto', () => {
    expect(
      assessQuery('qualcosa', ev({ hasTerms: false, candidates: 5, titleHits: 2 })).vague,
    ).toBe(true);
  });

  it('termini validi ma zero candidati: vaga (refuso o sinonimo)', () => {
    expect(assessQuery('qualcosa', ev({ candidates: 0, titleHits: 0 })).vague).toBe(true);
  });

  it('candidati ma nessun hit sul titolo: vaga (solo frammenti di URL/contesto)', () => {
    expect(assessQuery('qualcosa', ev({ candidates: 17, titleHits: 0 })).vague).toBe(true);
  });

  it('termini + candidati + almeno un hit sul titolo: non è vaga', () => {
    expect(assessQuery('qualcosa', ev({})).vague).toBe(false);
  });
});
