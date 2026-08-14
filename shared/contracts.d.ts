// Contratti dati condivisi tra estensione (lib/) e backend (server/src/).
// UNICA fonte di verità: lib/outcome.ts e server/src/types.ts ri-esportano da
// qui, così le due copie non possono più divergere.
//
// È un file di sole dichiarazioni (.d.ts): non produce output JS, quindi non
// altera il layout di build di nessuno dei due package.

/** A KB page whose text was read from the authenticated DOM / same-origin fetch. */
export interface KbPage {
  url: string;
  title: string;
  /** Main textual content, already trimmed to a token budget. */
  text: string;
  /** How this page entered the context: the page the agent is on, or a followed link. */
  origin: 'current' | 'followed';
}

/** An internal (same-origin) link discovered on the current page. */
export interface KbLink {
  url: string;
  text: string;
  /** Nearby text/heading captured from the page, used only for relevance scoring. */
  context?: string;
  /** DOM order, used as a deterministic tie-breaker. */
  order?: number;
  /** Human-readable reason for why this link was selected. */
  reason?: string;
  /** Local relevance score used before any AI call. */
  score?: number;
  /** Query keywords that matched this link/context. */
  matchedKeywords?: string[];
}

/**
 * Un turno già concluso della conversazione, rimandato al modello per i
 * follow-up. Lo storico vive nel CLIENT: il backend resta stateless, e la tabella
 * di audit è volutamente privacy-minimised (solo hash della query, nessuna
 * risposta), quindi non potrebbe farne da sorgente.
 */
export interface AskTurn {
  query: string;
  answer: string;
}

/**
 * Richiesta operativa strutturata al posto del prompt libero: l'agente compila
 * campi invece di descrivere il caso in prosa. `sections` sono le sezioni che
 * vuole nella risposta (le fonti vengono sempre aggiunte a parte).
 */
export interface ScheduleChangeRequest {
  kind: 'schedule-change';
  requestType: 'Schedule Change' | 'Name Correction';
  /** Codice vettore come lo scrive l'agente (LH, W8, ...), normalizzato maiuscolo. */
  airline: string;
  /** Coppia di città in un unico campo: "MIL-PAR" oppure "Milano-Parigi". */
  cityPair: string;
  flightType: 'Online' | 'Codeshare';
  /** Data di partenza originale, ISO `YYYY-MM-DD`. */
  originalDate: string;
  /** Sezioni richieste nella risposta, dall'elenco in shared/sections.json. */
  sections: string[];
}

/** Payload the sidebar/background sends to the backend `POST /ask`. */
export interface AskRequest {
  query: string;
  pages: KbPage[];
  links: KbLink[];
  /** Turni precedenti della conversazione, dal più vecchio al più recente. */
  history?: AskTurn[];
  /** Presente quando l'agente ha compilato il form invece del prompt libero. */
  form?: ScheduleChangeRequest;
}

/**
 * Payload the sidebar sends to `POST /rank`: a wide shortlist of candidate
 * articles (metadata only — title/slug/context, NOT bodies) for the reranker to
 * order by relevance to `query`, before the client reads the winners.
 */
export interface RankRequest {
  query: string;
  candidates: KbLink[];
}

/**
 * Backend response for `POST /rank`: the article URLs the reranker chose, ordered
 * best-first (a subset of the request's candidate URLs). An EMPTY list means "no
 * usable selection" — the client falls back to local scoring, so a failed/mocked
 * rank is never worse than today.
 */
export interface RankResponse {
  selectedUrls: string[];
  reason?: string;
  model?: string;
  provider?: 'mock' | 'anthropic';
}

/**
 * "Would-be AI request" — surfaced so the CED can see exactly what the backend
 * would send to the AI provider, even while the call is mocked. Makes the
 * cost model and the network egress explicit.
 */
export interface AiPlan {
  /**
   * Id della richiesta lato server. Serve a legare un feedback dell'agente alla
   * riga di audit corrispondente: senza, «questa risposta è sbagliata» non è
   * ricollegabile a nulla (la tabella `requests` è privacy-minimised e non
   * conserva il testo della risposta).
   */
  requestId: string;
  /** Model chosen by the difficulty router. */
  model: string;
  /** Why the router picked this model (heuristic explanation). */
  routingReason: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  /** The network endpoint the backend would contact for the real call. */
  egress: string;
  /** Whether this response came from the mock or a real provider. */
  provider: 'mock' | 'anthropic';
  /**
   * Turni di storico effettivamente rimandati al modello, DOPO il taglio a
   * `max_history_turns`. È il numero vero, non quello che il client ha inviato:
   * serve alla sidebar per dire quali turni sono ancora contesto e quali no.
   */
  historyTurnsUsed?: number;
  /**
   * Parti della coppia di città che il backend NON ha riconosciuto (Schedule
   * Change). Prima `parseCityPair` le calcolava e nessuno le leggeva:
   * «Vattelapesca-Parigi» diventava «(Vattelapesca-PAR)» e l'agente non sapeva
   * che metà itinerario non era stata interpretata.
   */
  itineraryUnresolved?: string[];
}

/**
 * Server-Sent Events emitted by `POST /ask`.
 *  - `plan`  : the AiPlan (sent once, first) — the would-be AI request.
 *  - `delta` : an incremental chunk of the outcome text (markdown).
 *  - `done`  : stream finished.
 *  - `error` : something went wrong.
 *  - `auth-required` : synthesized client-side on a 401 (never sent by the
 *    server) — the stored token is invalid/expired and the agent must log in.
 */
export type AskEvent =
  | { type: 'plan'; plan: AiPlan }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string }
  | { type: 'auth-required' };
