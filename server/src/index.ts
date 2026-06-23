// RunwaySurfer on-premise proxy backend.
//
// Pipeline for POST /ask:
//   1. route the request to a model by difficulty (router.ts);
//   2. estimate input/output tokens and cost;
//   3. emit the "would-be AI request" (AiPlan) so the CED sees model, cost and
//      the egress endpoint even while the AI call is mocked;
//   4. stream the operational outcome (mock or real provider) as SSE.
//
// The AI provider is selected by AI_PROVIDER (default 'mock'); the API key lives
// here on the server, never in the extension.
import express from 'express';
import cors from 'cors';
import type { AskRequest, AskEvent, AiPlan } from './types.js';
import { chooseModel, estimateTokens, estimateCostUsd } from './router.js';
import {
  getProvider,
  buildSystemPrompt,
  buildUserContent,
  ANTHROPIC_EGRESS,
  ASSUMED_OUTPUT_TOKENS,
} from './provider/index.js';

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';

const app = express();
app.use(cors({ origin: ALLOWED_ORIGIN }));
app.use(express.json({ limit: '4mb' }));

/** Liveness probe. */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', provider: getProvider().name });
});

/**
 * Server & network requirements — surfaced for the CED so they can plan the
 * on-prem deployment without reading the code.
 */
app.get('/requirements', (_req, res) => {
  res.json({
    backend: {
      runtime: 'Node.js 20+ (single stateless process)',
      cpu: '1 vCPU sufficiente per il prototipo (I/O bound)',
      ram: '256–512 MB',
      disk: 'minimo (nessuna persistenza; log opzionali)',
      scaling: 'orizzontale, stateless — replicabile dietro load balancer',
    },
    network: {
      inbound: `porta ${PORT} (HTTP); esporre via reverse proxy con TLS`,
      outbound_egress: `HTTPS verso ${ANTHROPIC_EGRESS} (solo con provider reale)`,
      cors: `Access-Control-Allow-Origin = ${ALLOWED_ORIGIN}`,
    },
    secrets: {
      anthropic_api_key:
        'ANTHROPIC_API_KEY via env/secret manager sul server; MAI nell\'estensione',
      rotation: 'ruotabile senza redeploy dell\'estensione',
    },
    provider: getProvider().name,
    note: 'Con AI_PROVIDER=mock non esce traffico verso Internet: ideale per la demo.',
  });
});

/** Main endpoint: model routing + cost estimate + streamed outcome (SSE). */
app.post('/ask', async (req, res) => {
  const body = req.body as Partial<AskRequest>;
  if (!body || typeof body.query !== 'string' || !Array.isArray(body.pages)) {
    res.status(400).json({ error: 'invalid request: expected {query, pages, links}' });
    return;
  }
  const request: AskRequest = {
    query: body.query,
    pages: body.pages,
    links: Array.isArray(body.links) ? body.links : [],
  };

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
  console.log(
    `[ask] provider=${provider.name} model=${spec.id} pages=${request.pages.length} ` +
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

  send({ type: 'plan', plan });
  try {
    await provider.streamOutcome(
      { ...request, model: spec.id },
      (text) => send({ type: 'delta', text }),
      ac.signal,
    );
    send({ type: 'done' });
  } catch (e) {
    send({ type: 'error', message: String(e) });
  }
  res.end();
});

app.listen(PORT, () => {
  console.log(
    `RunwaySurfer proxy on :${PORT} — provider=${getProvider().name}, CORS=${ALLOWED_ORIGIN}`,
  );
});
