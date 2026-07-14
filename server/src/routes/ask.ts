// POST /ask — l'endpoint principale: sanificazione dell'input, routing del
// modello, stima token/costo, guardrail e streaming SSE dell'outcome.
import { Router } from 'express';
import type { AskRequest, AskEvent, AiPlan } from '../types.js';
import { chooseModel, estimateTokens, estimateCostUsd } from '../router.js';
import {
  getProvider,
  buildSystemPrompt,
  buildUserContent,
  ANTHROPIC_EGRESS,
  ASSUMED_OUTPUT_TOKENS,
} from '../provider/index.js';
import {
  getSettings,
  insertRequestHistory,
  type RequestHistoryInput,
  type SettingsRecord,
} from '../db.js';
import { requireAuth, type AuthContext } from '../auth.js';
import { metrics, recordMetric, canAcceptRequest, beginActive, endActive } from '../metrics.js';
import { truncate, newRequestId } from '../util.js';
import { MAX_QUERY_CHARS } from '../config.js';

/** Esportata per i test: normalizza e tronca il payload non fidato di /ask. */
export function sanitizeRequest(body: Partial<AskRequest>, settings: SettingsRecord): AskRequest {
  const pages = Array.isArray(body.pages)
    ? body.pages.slice(0, settings.max_request_pages).map((page, index) => {
        const origin: 'current' | 'followed' = page?.origin === 'followed' ? 'followed' : 'current';
        return {
          url: truncate(page?.url, 2_000),
          title: truncate(page?.title, 240) || `Pagina ${index + 1}`,
          text: truncate(page?.text, settings.max_page_text_chars),
          origin,
        };
      })
    : [];
  const links = Array.isArray(body.links)
    ? body.links.slice(0, settings.max_request_links).map((link) => ({
        url: truncate(link?.url, 2_000),
        text: truncate(link?.text, 180),
        context: truncate(link?.context, 260) || undefined,
        order: typeof link?.order === 'number' ? link.order : undefined,
        reason: truncate(link?.reason, 160) || undefined,
        score: typeof link?.score === 'number' ? link.score : undefined,
        matchedKeywords: Array.isArray(link?.matchedKeywords)
          ? link.matchedKeywords.slice(0, 8).map((kw) => truncate(kw, 40))
          : undefined,
      }))
    : [];
  return {
    query: truncate(body.query, MAX_QUERY_CHARS),
    pages,
    links: links.filter((link) => link.url && link.text),
  };
}

function persistRequest(input: RequestHistoryInput): void {
  try {
    insertRequestHistory(input);
  } catch (e) {
    console.error(`[history] failed to persist request ${input.id}:`, e);
  }
}

export const askRoutes = Router();

/** Main endpoint: model routing + cost estimate + streamed outcome (SSE). */
askRoutes.post('/ask', requireAuth('agent'), async (req, res) => {
  const settings = getSettings();
  const { user } = res.locals.auth as AuthContext;
  const agentId = user.external_id;
  const body = req.body as Partial<AskRequest>;
  if (!body || typeof body.query !== 'string' || !Array.isArray(body.pages)) {
    res.status(400).json({ error: 'invalid request: expected {query, pages, links}' });
    return;
  }
  const request = sanitizeRequest(body, settings);
  if (!request.query || request.pages.length === 0) {
    res.status(400).json({ error: 'invalid request: non-empty query and pages are required' });
    return;
  }
  const rejectedBase = {
    userId: user.id,
    agentId,
    teamId: user.team_id,
    query: request.query,
    provider: getProvider().name,
    model: 'none',
    pagesCount: request.pages.length,
    linksCount: request.links.length,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: 0,
    durationMs: 0,
    status: 'rejected' as const,
    selectedLinks: request.links,
    sources: request.pages.map((p) => ({ title: p.title, url: p.url, origin: p.origin })),
  };
  if (user.status === 'disabled') {
    metrics.rejectedRequests += 1;
    persistRequest({ ...rejectedBase, id: newRequestId(), error: 'user disabled' });
    res.status(403).json({ error: 'user disabled' });
    return;
  }
  const capacity = canAcceptRequest(agentId, settings);
  if (!capacity.ok) {
    metrics.rejectedRequests += 1;
    persistRequest({ ...rejectedBase, id: newRequestId(), error: capacity.message });
    res.status(capacity.status).json({ error: capacity.message });
    return;
  }

  const provider = getProvider();
  const { spec, reason } = chooseModel(request);

  const promptText = buildSystemPrompt() + '\n' + buildUserContent({ ...request, model: spec.id });
  const estimatedInputTokens = estimateTokens(promptText);
  const estimatedOutputTokens = ASSUMED_OUTPUT_TOKENS;
  const estimatedCostUsd = estimateCostUsd(spec, estimatedInputTokens, estimatedOutputTokens);

  const plan: AiPlan = {
    model: spec.id,
    routingReason: reason,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    egress: ANTHROPIC_EGRESS,
    provider: provider.name,
  };

  // Per-request usage log (cost visibility for the CED / FinOps).
  const requestId = newRequestId();
  const startedAt = Date.now();
  // Increment the live counter and release it in the finally below, so a throw
  // during SSE setup (e.g. flushHeaders/write on an already-closed socket) can
  // never leak it and eventually trip the concurrency guardrail (429).
  beginActive(agentId);
  try {
    console.log(
      `[ask:${requestId}] agent=${agentId} provider=${provider.name} model=${spec.id} pages=${request.pages.length} ` +
        `inTok≈${estimatedInputTokens} cost≈$${estimatedCostUsd.toFixed(4)} :: "${request.query.slice(0, 60)}"`,
    );

    // SSE setup.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const send = (event: AskEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Abort the provider stream if the *client* disconnects. Use res 'close'
    // (not req 'close', which fires as soon as the already-parsed body stream ends).
    const ac = new AbortController();
    res.on('close', () => ac.abort());

    const historyBase = {
      userId: user.id,
      agentId,
      teamId: user.team_id,
      query: request.query,
      provider: provider.name,
      model: spec.id,
      pagesCount: request.pages.length,
      linksCount: request.links.length,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd,
      selectedLinks: request.links,
      sources: request.pages.map((p) => ({ title: p.title, url: p.url, origin: p.origin })),
    };
    const metricBase = {
      id: requestId,
      at: new Date(startedAt).toISOString(),
      agentId,
      provider: provider.name,
      model: spec.id,
      pages: request.pages.length,
      links: request.links.length,
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      estimatedCostUsd,
    };

    send({ type: 'plan', plan });
    try {
      await provider.streamOutcome(
        { ...request, model: spec.id },
        (text) => send({ type: 'delta', text }),
        ac.signal,
      );
      if (ac.signal.aborted) {
        // Client disconnected mid-stream: the mock provider resolves normally
        // on abort (unlike the real one, which throws), so without this branch
        // the request would be logged as a successful completion it never was.
        const message = 'client disconnected';
        recordMetric({ ...metricBase, ms: Date.now() - startedAt, ok: false, error: message });
        persistRequest({
          ...historyBase,
          id: requestId,
          durationMs: Date.now() - startedAt,
          status: 'error',
          error: message,
        });
      } else {
        send({ type: 'done' });
        recordMetric({ ...metricBase, ms: Date.now() - startedAt, ok: true });
        persistRequest({
          ...historyBase,
          id: requestId,
          durationMs: Date.now() - startedAt,
          status: 'ok',
        });
      }
    } catch (e) {
      const message = String(e);
      send({ type: 'error', message });
      recordMetric({ ...metricBase, ms: Date.now() - startedAt, ok: false, error: message });
      persistRequest({
        ...historyBase,
        id: requestId,
        durationMs: Date.now() - startedAt,
        status: 'error',
        error: message,
      });
    }
  } finally {
    endActive(agentId);
    try {
      res.end();
    } catch {
      /* socket already closed */
    }
  }
});
