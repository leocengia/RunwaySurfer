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

// Soglie euristiche del router. RITARATE sul profilo reale della KB Runway
// (baseline Passa 7, 2026-07-29) dopo la leva E2: l'estrazione per-heading tiene
// ogni pagina entro ~4.500 char (cap 6.000 = MAX_PAGE_CHARS), quindi anche un
// follow di 3-4 pagine porta solo ~8-12k char (~2-3k token) di contesto.
//
// La difficoltà va misurata sulla DIMENSIONE del contesto, NON sul numero di
// pagine: prima `MODERATE_MAX_PAGES = 2` spingeva OGNI follow ≥3 pagine su opus
// anche con contesti minuscoli (rilevato in baseline: 4 chiamate opus con soli
// 2.4-3k token → sprecato ~$0.026 vs ~$0.015 sonnet). Ora il conteggio pagine è
// un tetto largo e a decidere è quasi sempre la soglia in caratteri.
//   - semplice  : 1 pagina (≤ MAX_PAGE_CHARS) + query breve            → haiku
//   - medio     : fino a 6 pagine focalizzate, contesto < ~18k char    → sonnet
//   - difficile : contesto grande (≥18k char) o >6 pagine di sintesi   → opus
const SIMPLE_MAX_CONTEXT_CHARS = 8_000;
const SIMPLE_MAX_QUERY_TOKENS = 40;
const MODERATE_MAX_PAGES = 6;
const MODERATE_MAX_CONTEXT_CHARS = 18_000;

/** ~4 characters per token, good enough for routing and cost estimates. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Total characters of context the request carries: pagine KB, storico della
 * conversazione e campi del form. Contare le sole pagine renderebbe INVISIBILE
 * al router tutto il pregresso di un thread — un follow-up al terzo turno
 * resterebbe sul modello più economico pur avendo il doppio del contesto.
 */
function contextChars(req: AskRequest): number {
  const pages = req.pages.reduce((n, p) => n + p.text.length, 0);
  const history = (req.history ?? []).reduce((n, t) => n + t.query.length + t.answer.length, 0);
  const form = req.form ? JSON.stringify(req.form).length : 0;
  return pages + history + form;
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
  // Una richiesta strutturata non è mai "semplice": la query libera è corta o
  // vuota, ma va prodotta una risposta a più sezioni su condizioni tariffarie.
  const simple =
    !req.form &&
    pages <= 1 &&
    chars < SIMPLE_MAX_CONTEXT_CHARS &&
    queryTokens < SIMPLE_MAX_QUERY_TOKENS;

  if (simple) {
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
