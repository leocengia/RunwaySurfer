// Configurazione da variabili d'ambiente e costanti globali del backend.
// Centralizzata qui così i moduli route non leggono process.env in ordine sparso.

export const PORT = Number(process.env.PORT ?? 8787);

/**
 * Origin CORS ammessa. Il default '*' va bene per la demo; in produzione va
 * ristretta all'origin dell'estensione (vedi .env.example).
 */
export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';

/** Limite difensivo sulla lunghezza della query accettata da /ask. */
export const MAX_QUERY_CHARS = 1_000;

/** Quante richieste recenti tenere nelle metriche live in memoria. */
export const RECENT_REQUEST_LIMIT = 25;
