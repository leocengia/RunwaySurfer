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

describe('assessQuery · la soglia, in isolamento', () => {
  const ev = (candidates: number, topScore: number): RetrievalEvidence => ({
    candidates,
    topScore,
  });

  it('zero candidati vince su qualunque punteggio', () => {
    expect(assessQuery('qualcosa', ev(0, 0)).vague).toBe(true);
  });

  it('un singolo hit sul titolo (5) basta a non essere segnalata', () => {
    expect(assessQuery('qualcosa', ev(3, 5)).vague).toBe(false);
  });

  it('sotto 5 si segnala: i candidati vengono solo da frammenti di URL', () => {
    expect(assessQuery('qualcosa', ev(17, 4)).vague).toBe(true);
  });
});
