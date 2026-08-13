// POST /rank — reranker/selezione articoli. Prende una shortlist di candidati
// (SOLO metadati: titolo/slug/contesto, NON i corpi) e ritorna gli URL scelti
// dal provider, ordinati. Non-streaming (risposta JSON singola).
//
// FILOSOFIA FALLBACK: su qualunque problema (provider in mock, errore, timeout)
// l'endpoint risponde comunque 200 con `{selectedUrls: []}`; il client interpreta
// la lista vuota come "nessuna selezione utile" e ricade sullo scoring locale.
// Il rerank non è quindi mai peggio del comportamento di oggi.
import { Router, type Request, type Response } from 'express';
import { asyncRoute } from '../http.js';
import type { RankRequest, RankResponse } from '../types.js';
import { getProvider } from '../provider/index.js';
import { buildRankPrompt } from '../provider/shared.js';
import { estimateTokens, estimateCostUsd, MODELS, type ModelSpec } from '../router.js';
import { insertRequestHistory, type RequestHistoryInput } from '../db.js';
import { getSettings } from '../db.js';
import { requireAuth, type AuthContext } from '../auth.js';
import {
  canAcceptRequest,
  beginActive,
  endActive,
  recordMetric,
  noteRequestForRateLimit,
} from '../metrics.js';
import { truncate, newRequestId } from '../util.js';
import { MAX_QUERY_CHARS, MAX_RANK_CANDIDATES, RANK_MODEL } from '../config.js';

/** Il rerank è una classificazione breve: pochi id in uscita, timeout stretto. */
const RANK_TIMEOUT_MS = 3_000;
const RANK_ASSUMED_OUTPUT_TOKENS = 40;

/** Esportata per i test: normalizza e tronca il payload non fidato di /rank. */
export function sanitizeRankRequest(body: Partial<RankRequest>): RankRequest {
  const candidates = Array.isArray(body.candidates)
    ? body.candidates.slice(0, MAX_RANK_CANDIDATES).map((c) => ({
        url: truncate(c?.url, 2_000),
        text: truncate(c?.text, 180),
        context: truncate(c?.context, 260) || undefined,
        order: typeof c?.order === 'number' ? c.order : undefined,
        score: typeof c?.score === 'number' ? c.score : undefined,
      }))
    : [];
  return {
    query: truncate(body.query, MAX_QUERY_CHARS),
    candidates: candidates.filter((c) => c.url && c.text),
  };
}

/** Spec del modello di rerank (di norma haiku), risolta dall'id RANK_MODEL. */
function rankSpec(): ModelSpec {
  return Object.values(MODELS).find((m) => m.id === RANK_MODEL) ?? MODELS.haiku;
}

function persistRank(input: RequestHistoryInput): void {
  try {
    insertRequestHistory(input);
  } catch (e) {
    console.error(`[rank-history] failed to persist ${input.id}:`, e);
  }
}

export const rankRoutes = Router();

const handleRank = async (req: Request, res: Response): Promise<void> => {
  const settings = getSettings();
  const { user } = res.locals.auth as AuthContext;
  const agentId = user.external_id;
  const body = req.body as Partial<RankRequest>;
  if (!body || typeof body.query !== 'string' || !Array.isArray(body.candidates)) {
    res.status(400).json({ error: 'invalid request: expected {query, candidates}' });
    return;
  }
  const request = sanitizeRankRequest(body);
  if (!request.query || request.candidates.length === 0) {
    res.status(400).json({ error: 'invalid request: non-empty query and candidates are required' });
    return;
  }
  // Guardrail come /ask; su rifiuto il client ricade sullo scoring locale.
  if (user.status === 'disabled') {
    res.status(403).json({ error: 'user disabled' });
    return;
  }
  const capacity = canAcceptRequest(agentId, settings);
  if (!capacity.ok) {
    res.status(capacity.status).json({ error: capacity.message });
    return;
  }
  noteRequestForRateLimit(agentId);

  const provider = getProvider();
  const spec = rankSpec();
  const { system, user: userContent } = buildRankPrompt({
    query: request.query,
    candidates: request.candidates,
    model: RANK_MODEL,
  });
  const estimatedInputTokens = estimateTokens(`${system}\n${userContent}`);
  const estimatedOutputTokens = RANK_ASSUMED_OUTPUT_TOKENS;
  const estimatedCostUsd = estimateCostUsd(spec, estimatedInputTokens, estimatedOutputTokens);

  const requestId = newRequestId();
  const startedAt = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RANK_TIMEOUT_MS);
  beginActive(agentId);

  let selectedUrls: string[] = [];
  let actualInputTokens: number | null = null;
  let actualOutputTokens: number | null = null;
  let status: 'ok' | 'error' = 'ok';
  let error: string | undefined;
  try {
    const result = await provider.rankCandidates(
      { query: request.query, candidates: request.candidates, model: RANK_MODEL },
      ac.signal,
    );
    selectedUrls = result.selectedUrls;
    actualInputTokens = result.usage?.inputTokens ?? null;
    actualOutputTokens = result.usage?.outputTokens ?? null;
  } catch (e) {
    // Errore/timeout provider → selezione vuota (il client fa fallback locale).
    status = 'error';
    error = String(e);
    selectedUrls = [];
  } finally {
    clearTimeout(timer);
    endActive(agentId);
  }

  const durationMs = Date.now() - startedAt;
  recordMetric({
    id: requestId,
    at: new Date(startedAt).toISOString(),
    agentId,
    provider: provider.name,
    model: spec.id,
    pages: 0,
    links: request.candidates.length,
    inputTokens: estimatedInputTokens,
    outputTokens: estimatedOutputTokens,
    estimatedCostUsd,
    ms: durationMs,
    ok: status === 'ok',
    error,
  });
  persistRank({
    id: requestId,
    userId: user.id,
    agentId,
    teamId: user.team_id,
    query: request.query,
    provider: provider.name,
    model: spec.id,
    pagesCount: 0,
    linksCount: request.candidates.length,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    actualInputTokens,
    actualOutputTokens,
    durationMs,
    status,
    error,
    selectedLinks: selectedUrls.map((url) => ({ url })),
    sources: [],
    kind: 'rank',
  });

  const response: RankResponse = { selectedUrls, model: spec.id, provider: provider.name };
  res.json(response);
};

rankRoutes.post('/rank', requireAuth('agent'), asyncRoute(handleRank));
