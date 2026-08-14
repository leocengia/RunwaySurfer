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

/**
 * Dollari per euro, usato SOLO per confrontare la spesa (che il listino esprime
 * in USD) con il budget, che è espresso in euro.
 *
 * È un tasso fisso, non un cambio in tempo reale: va bene per un tetto di spesa
 * — se il cambio si muove del 10%, il tetto effettivo si muove del 10% — e non va
 * bene per la contabilità. Aggiornabile con la env `USD_PER_EUR` senza toccare il
 * codice. Il default è volutamente basso: sottostimando il valore dell'euro il
 * guardrail scatta un po' PRIMA, non dopo.
 */
export const USD_PER_EUR = Number(process.env.USD_PER_EUR ?? 1.05);

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
