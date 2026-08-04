// Configurazione da variabili d'ambiente e costanti globali del backend.
// Centralizzata qui così i moduli route non leggono process.env in ordine sparso.
import { MODELS } from './router.js';

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

/**
 * Tetto difensivo ai candidati accettati da /rank. La shortlist client è ~30;
 * 40 lascia margine senza far esplodere il prompt del reranker.
 */
export const MAX_RANK_CANDIDATES = 40;

/**
 * Modello del reranker: SEMPRE il più economico (haiku). La selezione è una
 * classificazione di metadati, non una sintesi → non passa da chooseModel.
 * Override via env RANK_MODEL solo per esperimenti.
 */
export const RANK_MODEL = process.env.RANK_MODEL ?? MODELS.haiku.id;
