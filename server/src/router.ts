// Model routing by task difficulty — the core of the cost-containment strategy.
// Cheap/fast model for simple lookups, mid model for moderate tasks, the most
// capable for hard multi-page synthesis. The router only decides; the provider
// executes (or, in the demo, mocks) the call.
//
// JUN/demo: heuristic classification (no extra round-trip, which would add
// latency). AUG can swap this for a model-based classifier behind the same API.
import type { AskRequest } from './types.js';

export interface ModelSpec {
  id: string;
  /** USD per 1M tokens. */
  inputPerMTok: number;
  outputPerMTok: number;
}

// Prezzi USD per milione di token dal listino Claude
// (https://platform.claude.com/docs/en/pricing) — verificati il 2026-07-09.
// Vanno ricontrollati quando Anthropic pubblica nuovi modelli o tariffe.
export const MODELS = {
  haiku: { id: 'claude-haiku-4-5', inputPerMTok: 1, outputPerMTok: 5 },
  sonnet: { id: 'claude-sonnet-4-6', inputPerMTok: 3, outputPerMTok: 15 },
  opus: { id: 'claude-opus-4-8', inputPerMTok: 5, outputPerMTok: 25 },
} satisfies Record<string, ModelSpec>;

export interface RoutingDecision {
  spec: ModelSpec;
  reason: string;
}

// Soglie euristiche del router. Tarate sulla demo (pagine Wikipedia da
// ~2-6k caratteri): un task è "semplice" se sta in una pagina corta con una
// query breve, "medio" fino a due pagine di contesto contenuto, altrimenti
// richiede sintesi multi-pagina.
const SIMPLE_MAX_CONTEXT_CHARS = 6_000;
const SIMPLE_MAX_QUERY_TOKENS = 40;
const MODERATE_MAX_PAGES = 2;
const MODERATE_MAX_CONTEXT_CHARS = 16_000;

/** ~4 characters per token, good enough for routing and cost estimates. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Total characters of KB context the request carries. */
function contextChars(req: AskRequest): number {
  return req.pages.reduce((n, p) => n + p.text.length, 0);
}

/**
 * Heuristic difficulty → model.
 *  - simple: single current page + short query  → Haiku
 *  - moderate: some context / a couple of pages  → Sonnet
 *  - hard: multi-page synthesis / large context  → Opus
 */
export function chooseModel(req: AskRequest): RoutingDecision {
  const pages = req.pages.length;
  const chars = contextChars(req);
  const queryTokens = estimateTokens(req.query);

  if (pages <= 1 && chars < SIMPLE_MAX_CONTEXT_CHARS && queryTokens < SIMPLE_MAX_QUERY_TOKENS) {
    return {
      spec: MODELS.haiku,
      reason: `task semplice (1 pagina, ~${Math.round(chars / 4)} token contesto) → modello economico/veloce`,
    };
  }
  if (pages <= MODERATE_MAX_PAGES && chars < MODERATE_MAX_CONTEXT_CHARS) {
    return {
      spec: MODELS.sonnet,
      reason: `task medio (${pages} pagine, ~${Math.round(chars / 4)} token contesto) → modello bilanciato`,
    };
  }
  return {
    spec: MODELS.opus,
    reason: `task difficile (${pages} pagine, ~${Math.round(chars / 4)} token contesto, sintesi multi-pagina) → modello più capace`,
  };
}

/** Estimate USD cost for a given model and token counts. */
export function estimateCostUsd(
  spec: ModelSpec,
  inputTokens: number,
  outputTokens: number,
): number {
  return (
    (inputTokens / 1_000_000) * spec.inputPerMTok + (outputTokens / 1_000_000) * spec.outputPerMTok
  );
}
