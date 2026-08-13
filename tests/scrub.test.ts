// Redazione dei dati cliente prima dell'invio. Sono test su logica pura, ma la
// posta in gioco è doppia: un falso NEGATIVO manda un dato del cliente al
// modello, un falso POSITIVO cancella un pezzo della domanda e l'agente riceve
// una risposta che non c'entra. La seconda metà di questi test riguarda proprio
// i falsi positivi.
import { describe, expect, it } from 'vitest';
import { luhnValid, redactionNotice, scrubPii } from '../lib/scrub';

describe('scrubPii · riconosce', () => {
  it('le email', () => {
    const { text, redacted } = scrubPii('scrivi a mario.rossi@example.com per conferma');
    expect(text).toBe('scrivi a [EMAIL] per conferma');
    expect(redacted).toEqual(['EMAIL']);
  });

  it('i codici di prenotazione (lettere + cifre)', () => {
    const { text, redacted } = scrubPii('il cliente con PNR 3XKZ9P vuole cambiare volo');
    expect(text).toBe('il cliente con PNR [PNR] vuole cambiare volo');
    expect(redacted).toEqual(['PNR']);
  });

  it('i numeri di biglietto a 13 cifre', () => {
    const { text, redacted } = scrubPii('biglietto 0742416182934 emesso ieri');
    expect(text).toBe('biglietto [TKT] emesso ieri');
    expect(redacted).toEqual(['TKT']);
  });

  it('le carte di credito (solo se passano Luhn)', () => {
    // 4111 1111 1111 1111 è il numero di test che valida a Luhn.
    const { text, redacted } = scrubPii('ha pagato con 4111 1111 1111 1111');
    expect(text).toBe('ha pagato con [CARD]');
    expect(redacted).toEqual(['CARD']);
  });

  it('i telefoni con prefisso internazionale', () => {
    const { redacted } = scrubPii('richiamalo al +39 348 1234567');
    expect(redacted).toEqual(['TEL']);
  });

  it('più dati nella stessa frase, elencandoli tutti', () => {
    const { text, redacted } = scrubPii('PNR 3XKZ9P, mail a@b.it, biglietto 0742416182934');
    expect(text).not.toMatch(/3XKZ9P|a@b\.it|0742416182934/);
    // L'ordine segue le regole (email prima), non la posizione nel testo.
    expect([...redacted].sort()).toEqual(['EMAIL', 'PNR', 'TKT']);
    expect(redacted).toHaveLength(3);
  });
});

describe('scrubPii · NON tocca', () => {
  it('una parola di sei lettere maiuscole', () => {
    // Il caso che ha guidato il progetto: senza la richiesta di almeno una cifra,
    // qualunque parola in stampatello diventerebbe un PNR.
    const { text, redacted } = scrubPii('vedi REGOLE e RIMBOR sul cambio');
    expect(text).toBe('vedi REGOLE e RIMBOR sul cambio');
    expect(redacted).toEqual([]);
  });

  it('un numero di volo, che serve alla domanda', () => {
    const { text, redacted } = scrubPii('il volo LH1234 è stato cancellato');
    expect(text).toBe('il volo LH1234 è stato cancellato');
    expect(redacted).toEqual([]);
  });

  it('i codici aeroportuali e le date', () => {
    const { redacted } = scrubPii('MXP-CDG del 15/03/2026, partenza 202603');
    expect(redacted).toEqual([]);
  });

  it('una sequenza lunga di cifre che non è una carta', () => {
    // 16 cifre che NON passano Luhn: è un identificativo, non una carta. Senza il
    // controllo, qualunque numero d'ordine diventerebbe [CARD].
    expect(luhnValid('1234567812345678')).toBe(false);
    const { redacted } = scrubPii('ordine 1234567812345678');
    expect(redacted).toEqual([]);
  });

  it('una domanda normale sulle policy', () => {
    const q = 'si può cambiare il nome sul biglietto dopo il check-in?';
    expect(scrubPii(q)).toEqual({ text: q, redacted: [] });
  });
});

describe('scrubPii · proprietà', () => {
  it('è idempotente: i segnaposto non vengono ri-catturati', () => {
    const once = scrubPii('PNR 3XKZ9P mail a@b.it tel +39 348 1234567');
    const twice = scrubPii(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.redacted).toEqual([]);
  });

  it('lascia intatta una stringa vuota', () => {
    expect(scrubPii('')).toEqual({ text: '', redacted: [] });
  });
});

describe('redactionNotice', () => {
  it('tace se non c’è stato nulla da rimuovere', () => {
    expect(redactionNotice([])).toBe('');
  });

  it('al singolare non dice "1 dati"', () => {
    expect(redactionNotice(['PNR'])).toContain('un dato');
  });

  it('conta le occorrenze e nomina i tipi una volta sola', () => {
    const notice = redactionNotice(['PNR', 'PNR', 'EMAIL']);
    expect(notice).toContain('3 dati');
    expect(notice).toContain('codice di prenotazione');
    expect(notice).toContain('email');
    // "codice di prenotazione" compare una volta, non due.
    expect(notice.match(/codice di prenotazione/g)).toHaveLength(1);
  });
});
