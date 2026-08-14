// Riconoscere una domanda su cui il retrieval non ha niente su cui lavorare.
//
// Il caso che ha motivato il modulo: `"e poi?"` oggi parte senza avvisi.
// `pageCoverage` scarta le parole sotto 4 lettere, quindi non trova termini utili
// e ritorna 1 (copertura massima) → `isOffTopic` dice no → la risposta si
// costruisce SOLO sulla pagina aperta, qualunque sia. E il router la classifica
// `simple`, assegnandole il modello meno capace.
//
// Il valore qui è nei FALSI POSITIVI: un avviso su una domanda buona insegna
// all'agente a ignorare gli avvisi.
import { describe, expect, it } from 'vitest';
import { assessQuery } from '../lib/query-quality';

describe('assessQuery · segnala', () => {
  it('una domanda di sole parole vuote', () => {
    const { vague, hint } = assessQuery('e poi?');
    expect(vague).toBe(true);
    expect(hint).toMatch(/argomento/i);
  });

  it('una domanda fatta solo di riempitivi', () => {
    expect(assessQuery('come posso fare questo?').vague).toBe(true);
  });

  it('un singolo termine buttato lì', () => {
    const { vague, hint } = assessQuery('rimborso');
    expect(vague).toBe(true);
    // Il suggerimento cita il termine trovato: generico non aiuta a correggere.
    expect(hint).toContain('rimborso');
  });

  it('la punteggiatura da sola', () => {
    expect(assessQuery('???').vague).toBe(true);
  });
});

describe('assessQuery · NON segnala', () => {
  it('una domanda normale sulle policy', () => {
    expect(assessQuery('si può cambiare il nome sul biglietto dopo il check-in?').vague).toBe(
      false,
    );
  });

  it('due termini di contenuto bastano', () => {
    expect(assessQuery('rimborso Lufthansa').vague).toBe(false);
  });

  it('un termine solo ma in una frase articolata', () => {
    // La lunghezza dice che l'agente ha scritto un contesto, anche se i termini
    // lunghi sono pochi: sbarrargli la strada qui sarebbe rumore.
    expect(assessQuery('il cliente non ha ancora accettato la riprotezione').vague).toBe(false);
  });

  it('una stringa vuota non è "vaga": non c’è niente da suggerire', () => {
    // Il pulsante di ricerca è già disabilitato in quel caso.
    expect(assessQuery('   ')).toEqual({ vague: false, hint: '' });
  });

  it('un codice di volo conta come termine di contenuto', () => {
    expect(assessQuery('cancellato LH1234 cosa faccio').vague).toBe(false);
  });
});
