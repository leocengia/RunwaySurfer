// Shared data contracts between the extension and the backend proxy.
// Designed for the nested-KB / multi-page case from day one: the backend always
// receives an array of pages and the list of nested links discovered on the
// current page, so AUG's multi-level crawl reuses the same shapes.

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
}

/** Payload the sidebar/background sends to the backend `POST /ask`. */
export interface AskRequest {
  query: string;
  pages: KbPage[];
  links: KbLink[];
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
 */
export type AskEvent =
  | { type: 'plan'; plan: AiPlan }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

/**
 * The operational outcome is streamed as markdown with these four sections.
 * Kept as a documented convention (rendered by the sidebar) rather than a rigid
 * schema, so the streaming UX stays simple.
 */
export const OUTCOME_SECTIONS = [
  'Procedura',
  'Eccezioni',
  'Risposta suggerita al cliente',
  'Fonti',
] as const;
