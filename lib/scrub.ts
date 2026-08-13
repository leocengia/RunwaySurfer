// Redazione dei dati cliente PRIMA che il testo lasci il browser.
//
// Il punto di applicazione è deliberato: qui, nel content script, non lato
// server. Ciò che non parte non può essere loggato, messo in cache da un proxy
// né finire in un prompt — e la tabella di audit del backend è già
// privacy-minimised proprio per la stessa ragione.
//
// COSA NON scrubbiamo: il testo degli articoli KB. È contenuto aziendale già
// visibile all'agente, e passarlo al setaccio significherebbe corrompere la
// fonte su cui la risposta si basa (un codice tariffario di 6 caratteri
// verrebbe scambiato per un PNR).
//
// Regola guida: per rispondere su una policy tariffaria il modello non ha
// bisogno di sapere CHI è il cliente. Nome del passeggero e indirizzo non sono
// riconoscibili con una regex e restano fuori portata: questo modulo copre gli
// identificatori strutturati, che sono anche i più dannosi da propagare.

export interface ScrubResult {
  /** Il testo con i segnaposto al posto dei dati riconosciuti. */
  text: string;
  /**
   * Un'etichetta per OGNI sostituzione fatta, in ordine di apparizione.
   * `redacted.length` è il conteggio da mostrare all'agente; l'insieme dei
   * valori distinti dice di che tipo di dati si trattava.
   */
  redacted: string[];
}

/** Etichette usate come segnaposto. Nessuna contiene cifre: vedi idempotenza. */
export type ScrubLabel = 'EMAIL' | 'CARD' | 'TKT' | 'PNR' | 'TEL';

/**
 * Somma di controllo di Luhn: distingue un numero di carta da una qualunque
 * sequenza lunga di cifre (un ID di prenotazione, un numero d'ordine). Senza
 * questo filtro qualsiasi numero di 13-19 cifre finirebbe etichettato `[CARD]`.
 */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Solo le cifre, per valutare lunghezza e Luhn ignorando spazi e trattini. */
function digitsOf(s: string): string {
  return s.replace(/\D/g, '');
}

/**
 * Un token di 6 caratteri è un PNR solo se mescola lettere e cifre. Servono
 * entrambe le condizioni:
 *  - una parola di sole lettere maiuscole non è un codice di prenotazione
 *    (l'agente scrive in stampatello, o la KB nomina un vettore);
 *  - un numero di 6 cifre è una data, un importo, un contatore.
 * Escluso anche il numero di volo (due lettere + sole cifre, es. LH1234): serve
 * alla domanda e non identifica nessuno.
 */
function looksLikePnr(token: string): boolean {
  if (!/^[A-Z0-9]{6}$/.test(token)) return false;
  if (!/[A-Z]/.test(token) || !/\d/.test(token)) return false;
  if (/^[A-Z]{2}\d{4}$/.test(token)) return false; // numero di volo
  return true;
}

interface Rule {
  label: ScrubLabel;
  re: RegExp;
  /** Filtro aggiuntivo: se ritorna false il match resta com'è. */
  accept?: (match: string) => boolean;
}

// L'ORDINE CONTA. Le regole più specifiche vanno prima, altrimenti una più
// larga mangia il match e l'etichetta risulta sbagliata: `[TEL]` su un numero
// di biglietto sarebbe fuorviante per chi legge l'avviso in sidebar.
const RULES: Rule[] = [
  { label: 'EMAIL', re: /[\w.+-]+@[\w-]+\.[\w.-]*[\w]/g },
  // Carte: 13-19 cifre con separatori ammessi, ma solo se passano Luhn.
  {
    label: 'CARD',
    re: /\b(?:\d[ -]?){12,18}\d\b/g,
    accept: (m) => {
      const d = digitsOf(m);
      return d.length >= 13 && d.length <= 19 && luhnValid(d);
    },
  },
  // Biglietto aereo: 13 cifre (3 di vettore + 10). Dopo CARD, così una carta a
  // 13 cifre valida a Luhn non viene etichettata come biglietto.
  { label: 'TKT', re: /\b\d{13}\b/g },
  {
    label: 'PNR',
    re: /\b[A-Z0-9]{6}\b/g,
    accept: looksLikePnr,
  },
  // Telefoni: prefisso internazionale, oppure 9-12 cifre con separatori
  // "telefonici". Sta per ultima perché è la più incline ai falsi positivi.
  {
    label: 'TEL',
    re: /(?:\+\d[\d ().-]{7,}\d)|(?:\b\d{3}[ .-]\d{3}[ .-]\d{3,4}\b)|(?:\b3\d{9}\b)/g,
    accept: (m) => {
      const d = digitsOf(m);
      return d.length >= 9 && d.length <= 15;
    },
  },
];

/**
 * Redige i dati cliente riconoscibili. Idempotente: i segnaposto non contengono
 * cifre, quindi nessuna regola li ri-cattura e riapplicare la funzione non
 * cambia il risultato.
 */
export function scrubPii(text: string): ScrubResult {
  const redacted: string[] = [];
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.re, (match) => {
      if (rule.accept && !rule.accept(match)) return match;
      redacted.push(rule.label);
      return `[${rule.label}]`;
    });
  }
  return { text: out, redacted };
}

/**
 * Avviso da mostrare all'agente, o stringa vuota se non c'era nulla da togliere.
 *
 * La redazione silenziosa sarebbe peggio del problema: l'agente non capirebbe
 * perché la risposta ignora un dettaglio che ha scritto, e lo riscriverebbe.
 */
export function redactionNotice(redacted: string[]): string {
  if (!redacted.length) return '';
  const kinds = [...new Set(redacted)].map(labelInItalian).join(', ');
  const what = redacted.length === 1 ? 'un dato' : `${redacted.length} dati`;
  return `Ho rimosso ${what} del cliente prima di inviare la domanda (${kinds}): per le policy non servono.`;
}

function labelInItalian(label: string): string {
  switch (label) {
    case 'EMAIL':
      return 'email';
    case 'CARD':
      return 'numero di carta';
    case 'TKT':
      return 'numero di biglietto';
    case 'PNR':
      return 'codice di prenotazione';
    case 'TEL':
      return 'telefono';
    default:
      return label.toLowerCase();
  }
}
