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
import { MODELS, chooseModel, estimateTokens, estimateCostUsd } from './router.js';
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

function dashboardData() {
  const provider = getProvider();
  const anthropicKeyConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  return {
    service: 'RunwaySurfer proxy',
    status: 'ok',
    provider: provider.name,
    aiReady: provider.name === 'mock' || anthropicKeyConfigured,
    aiProviderConfigured: provider.name,
    anthropicKeyConfigured,
    port: PORT,
    corsOrigin: ALLOWED_ORIGIN,
    egress: provider.name === 'anthropic' ? ANTHROPIC_EGRESS : 'none in mock mode',
    extension: {
      defaultMode: 'visual',
      supportedModes: ['visual', 'follow', 'single'],
      localProxyDefault: 'http://localhost:8787',
      note: 'The extension currently reads config locally; backend-driven remote config is the next control-plane step.',
    },
    promptPolicy: {
      assumedOutputTokens: ASSUMED_OUTPUT_TOKENS,
      nestedLinksSentToPrompt: 12,
      pageContext: 'query-focused extraction in the extension before POST /ask',
    },
    models: MODELS,
    nextControlPlaneSteps: [
      'Persist per-request usage metrics for dashboard charts.',
      'Add authenticated admin settings for default mode, max links and provider.',
      'Expose /extension-config and let the extension poll it at startup.',
      'Add audit logs for model, token estimate, cost estimate and selected links.',
    ],
  };
}

app.get('/dashboard-data', (_req, res) => {
  res.json(dashboardData());
});

app.get('/dashboard', (_req, res) => {
  const data = dashboardData();
  const readiness = data.aiReady ? 'Ready' : 'Missing API key';
  res.type('html').send(`<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RunwaySurfer Dashboard</title>
  <style>
    :root {
      --ink: #0b1f3a;
      --blue: #00355f;
      --yellow: #ffcc00;
      --soft: #f5f7fa;
      --line: #d8e0ea;
      --muted: #5f6f82;
      --ok: #127c56;
      --warn: #9f6b00;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: var(--ink);
      background: var(--soft);
    }
    header {
      padding: 22px 28px;
      color: #fff;
      background: var(--ink);
      border-bottom: 4px solid var(--yellow);
    }
    h1 { margin: 0; font-size: 22px; }
    main { max-width: 1100px; margin: 0 auto; padding: 22px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .card {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 14px;
      background: #fff;
    }
    .label { color: var(--muted); font-size: 12px; font-weight: 700; text-transform: uppercase; }
    .value { margin-top: 4px; font-size: 20px; font-weight: 800; }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    code, pre {
      font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
      font-size: 12px;
    }
    pre {
      overflow: auto;
      padding: 12px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
    }
    a { color: var(--blue); font-weight: 700; }
  </style>
</head>
<body>
  <header>
    <h1>RunwaySurfer Control Dashboard</h1>
  </header>
  <main>
    <section class="grid">
      <div class="card"><div class="label">Provider</div><div class="value">${data.provider}</div></div>
      <div class="card"><div class="label">AI readiness</div><div class="value ${data.aiReady ? 'ok' : 'warn'}">${readiness}</div></div>
      <div class="card"><div class="label">CORS</div><div class="value">${data.corsOrigin}</div></div>
      <div class="card"><div class="label">Egress</div><div class="value">${data.egress}</div></div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Control-plane draft</div>
      <p>Questa pagina espone lo stato operativo del proxy. Il prossimo passo e far leggere
      all'estensione un endpoint <code>/extension-config</code> autenticato.</p>
      <p><a href="/dashboard-data">Apri JSON dashboard-data</a> · <a href="/health">Health</a> · <a href="/requirements">Requirements</a></p>
    </section>
    <pre>${JSON.stringify(data, null, 2)}</pre>
  </main>
</body>
</html>`);
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
