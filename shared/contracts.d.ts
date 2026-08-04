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

/** Payload the sidebar/background sends to the backend `POST /ask`. */
export interface AskRequest {
  query: string;
  pages: KbPage[];
  links: KbLink[];
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
