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
import {
  analyticsSummary,
  createTeam,
  createUser,
  deleteExpiredSessions,
  getRequest,
  getSettings,
  getUserByExternalId,
  insertRequestHistory,
  listRequests,
  listTeams,
  listUsers,
  pruneOldRequests,
  sanitizeUser,
  setUserPassword,
  updateSettings,
  updateUser,
  type RequestHistoryInput,
  type SettingsRecord,
} from './db.js';
import {
  bootstrapAdmin,
  clearLoginFailures,
  clearSessionCookie,
  createSession,
  hashPassword,
  isLoginBlocked,
  publicUser,
  recordLoginFailure,
  requireAuth,
  requirePage,
  revokeAllUserSessions,
  revokeSession,
  sessionCookie,
  validateNewPassword,
  verifyAgainstDummy,
  verifyPassword,
  extractToken,
  authenticate,
  type AuthContext,
} from './auth.js';

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? '*';
const MAX_QUERY_CHARS = 1_000;
const RECENT_REQUEST_LIMIT = 25;

interface RequestMetric {
  id: string;
  at: string;
  agentId: string;
  provider: string;
  model: string;
  pages: number;
  links: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  ms: number;
  ok: boolean;
  error?: string;
}

const metrics = {
  startedAt: new Date().toISOString(),
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  activeRequests: 0,
  totalEstimatedInputTokens: 0,
  totalEstimatedOutputTokens: 0,
  totalEstimatedCostUsd: 0,
  byModel: {} as Record<string, number>,
  byAgent: {} as Record<string, { requests: number; failures: number; estimatedCostUsd: number }>,
  activeByAgent: {} as Record<string, number>,
  rejectedRequests: 0,
  recent: [] as RequestMetric[],
};

const app = express();
// The Authorization header makes extension requests non-simple, so the cors
// middleware must whitelist it and answer the resulting OPTIONS preflights.
// Bearer auth needs no credentials:true, so origin '*' stays legal; dashboard
// cookies are same-origin and never go through CORS.
app.use(cors({ origin: ALLOWED_ORIGIN, allowedHeaders: ['Content-Type', 'Authorization'] }));
app.use(express.json({ limit: '4mb' }));

/** Liveness probe. */
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', provider: getProvider().name });
});

function truncate(text: unknown, max: number): string {
  return typeof text === 'string' ? text.trim().slice(0, max) : '';
}

// ---------------------------------------------------------------------------
// Auth endpoints. Identity now comes exclusively from a verified session
// (cookie for the dashboard, bearer token for the extension); the old
// trust-based x-agent-id / x-user-email headers are gone.

app.post('/auth/login', async (req, res) => {
  const body = req.body as Record<string, unknown>;
  const username = truncate(body.username, 120);
  const password = typeof body.password === 'string' ? body.password : '';
  const client = body.client === 'extension' ? 'extension' : 'dashboard';
  if (!username || !password) {
    res.status(400).json({ error: 'username e password sono obbligatori' });
    return;
  }
  if (isLoginBlocked(req, username)) {
    res.status(429).json({ error: 'troppi tentativi falliti, riprova tra qualche minuto' });
    return;
  }
  const user = getUserByExternalId(username);
  if (!user) {
    // Flat timing: hash anyway so the response time does not reveal whether
    // the account exists.
    await verifyAgainstDummy(password);
    recordLoginFailure(req, username);
    res.status(401).json({ error: 'credenziali non valide' });
    return;
  }
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    recordLoginFailure(req, username);
    res.status(401).json({ error: 'credenziali non valide' });
    return;
  }
  if (user.status === 'disabled') {
    res.status(403).json({ error: 'utente disabilitato' });
    return;
  }
  clearLoginFailures(req, username);
  deleteExpiredSessions();
  const session = createSession(user.id, client === 'extension' ? 'bearer' : 'cookie');
  const payload = { user: publicUser(user), mustChangePassword: !!user.must_change_password };
  if (client === 'extension') {
    res.json({ ...payload, token: session.token, expiresAt: session.expiresAt });
  } else {
    const maxAge = Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000);
    res.setHeader('Set-Cookie', sessionCookie(session.token, maxAge));
    res.json(payload);
  }
});

app.post('/auth/logout', (req, res) => {
  const presented = extractToken(req);
  if (presented) revokeSession(presented.token);
  if (presented?.via === 'cookie') res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

app.get('/auth/me', (req, res) => {
  const auth = authenticate(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.json({ user: publicUser(auth.user) });
});

app.post('/auth/change-password', async (req, res) => {
  const auth = authenticate(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!(await verifyPassword(currentPassword, auth.user.password_hash))) {
    res.status(401).json({ error: 'password attuale non corretta' });
    return;
  }
  const invalid = validateNewPassword(newPassword);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const updated = setUserPassword(auth.user.id, await hashPassword(newPassword), false);
  // Every other session dies with the old password; the presenting one survives.
  revokeAllUserSessions(auth.user.id, extractToken(req)?.token);
  res.json({ ok: true, user: publicUser(updated ?? auth.user) });
});

function runtimeSettings(): SettingsRecord {
  return getSettings();
}

function sanitizeRequest(body: Partial<AskRequest>, settings = runtimeSettings()): AskRequest {
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

function recordMetric(metric: RequestMetric): void {
  metrics.totalRequests += 1;
  metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
  metrics.activeByAgent[metric.agentId] = Math.max(
    0,
    (metrics.activeByAgent[metric.agentId] ?? 0) - 1,
  );
  if (metric.ok) metrics.successfulRequests += 1;
  else metrics.failedRequests += 1;
  metrics.totalEstimatedInputTokens += metric.inputTokens;
  metrics.totalEstimatedOutputTokens += metric.outputTokens;
  metrics.totalEstimatedCostUsd += metric.estimatedCostUsd;
  metrics.byModel[metric.model] = (metrics.byModel[metric.model] ?? 0) + 1;
  const agent = (metrics.byAgent[metric.agentId] ??= {
    requests: 0,
    failures: 0,
    estimatedCostUsd: 0,
  });
  agent.requests += 1;
  if (!metric.ok) agent.failures += 1;
  agent.estimatedCostUsd += metric.estimatedCostUsd;
  metrics.recent.unshift(metric);
  metrics.recent.splice(RECENT_REQUEST_LIMIT);
}

function persistRequest(input: RequestHistoryInput): void {
  try {
    insertRequestHistory(input);
  } catch (e) {
    console.error(`[history] failed to persist request ${input.id}:`, e);
  }
}

function canAcceptRequest(
  agentId: string,
  settings = runtimeSettings(),
): { ok: true } | { ok: false; status: number; message: string } {
  if (metrics.activeRequests >= settings.max_concurrent_requests) {
    return {
      ok: false,
      status: 429,
      message: `backend busy: max ${settings.max_concurrent_requests} concurrent requests`,
    };
  }
  const activeForAgent = metrics.activeByAgent[agentId] ?? 0;
  if (activeForAgent >= settings.max_concurrent_per_agent) {
    return {
      ok: false,
      status: 429,
      message: `agent busy: max ${settings.max_concurrent_per_agent} concurrent requests per agent`,
    };
  }
  if (metrics.totalEstimatedCostUsd >= settings.max_daily_estimated_cost_usd) {
    return {
      ok: false,
      status: 429,
      message: `estimated cost guardrail reached: $${settings.max_daily_estimated_cost_usd.toFixed(2)}`,
    };
  }
  return { ok: true };
}

function extensionConfig() {
  const settings = runtimeSettings();
  return {
    version: 1,
    defaultMode: 'visual',
    maxFollowLinks: 3,
    maxPromptLinks: settings.max_request_links,
    maxPagesPerAsk: settings.max_request_pages,
    maxPageTextChars: settings.max_page_text_chars,
    maxConcurrentRequests: settings.max_concurrent_requests,
    maxConcurrentPerAgent: settings.max_concurrent_per_agent,
    maxDailyEstimatedCostUsd: settings.max_daily_estimated_cost_usd,
    provider: getProvider().name,
    features: {
      visualTour: true,
      backgroundFollow: true,
      sidebarResize: true,
      dashboard: true,
    },
  };
}

/**
 * Server & network requirements — surfaced for the CED so they can plan the
 * on-prem deployment without reading the code.
 */
app.get('/requirements', requireAuth('team_lead'), (_req, res) => {
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
      anthropic_api_key: "ANTHROPIC_API_KEY via env/secret manager sul server; MAI nell'estensione",
      rotation: "ruotabile senza redeploy dell'estensione",
    },
    provider: getProvider().name,
    note: 'Con AI_PROVIDER=mock non esce traffico verso Internet: ideale per la demo.',
  });
});

function dashboardData() {
  const provider = getProvider();
  const anthropicKeyConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  const settings = runtimeSettings();
  const history = analyticsSummary();
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
      ...extensionConfig(),
      supportedModes: ['visual', 'follow', 'single'],
      localProxyDefault: 'http://localhost:8787',
      note: 'The extension can be wired to poll /extension-config at startup.',
    },
    promptPolicy: {
      assumedOutputTokens: ASSUMED_OUTPUT_TOKENS,
      nestedLinksSentToPrompt: settings.max_request_links,
      maxPagesPerAsk: settings.max_request_pages,
      maxPageTextChars: settings.max_page_text_chars,
      pageContext: 'query-focused extraction in the extension before POST /ask',
    },
    concurrency: {
      maxConcurrentRequests: settings.max_concurrent_requests,
      maxConcurrentPerAgent: settings.max_concurrent_per_agent,
      activeRequests: metrics.activeRequests,
      activeByAgent: metrics.activeByAgent,
      rejectedRequests: metrics.rejectedRequests,
      maxDailyEstimatedCostUsd: settings.max_daily_estimated_cost_usd,
    },
    settings,
    metrics,
    history,
    models: MODELS,
    nextControlPlaneSteps: [
      'Persist per-request usage metrics in SQLite/Postgres for dashboard charts.',
      'Let the extension poll /extension-config at startup.',
      'Add audit logs for model, token estimate, cost estimate and selected links.',
    ],
  };
}

app.get('/dashboard-data', requireAuth('team_lead'), (_req, res) => {
  res.json(dashboardData());
});

app.get('/metrics', requireAuth('team_lead'), (_req, res) => {
  res.json(metrics);
});

app.get('/extension-config', requireAuth('agent'), (_req, res) => {
  res.json(extensionConfig());
});

app.get('/users', requireAuth('team_lead'), (_req, res) => {
  res.json({ users: listUsers().map(sanitizeUser) });
});

app.post('/users', requireAuth('admin'), async (req, res) => {
  try {
    const body = req.body as Record<string, unknown>;
    const externalId = truncate(body.externalId ?? body.external_id, 120);
    if (!externalId) {
      res.status(400).json({ error: 'externalId is required' });
      return;
    }
    const tempPassword = typeof body.tempPassword === 'string' ? body.tempPassword : '';
    const invalid = validateNewPassword(tempPassword);
    if (invalid) {
      res.status(400).json({ error: `tempPassword: ${invalid}` });
      return;
    }
    const user = createUser({
      externalId,
      email: truncate(body.email, 240) || null,
      name: truncate(body.name, 240) || null,
      role: body.role === 'admin' || body.role === 'team_lead' ? body.role : 'agent',
      status: body.status === 'pending' || body.status === 'disabled' ? body.status : 'active',
      teamId: typeof body.teamId === 'number' ? body.teamId : null,
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
    });
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

// Recovery path for locked-out or pre-auth users: new temporary password,
// forced change, all existing sessions revoked.
app.post('/users/:id/reset-password', requireAuth('admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid user id' });
    return;
  }
  const tempPassword = (req.body as Record<string, unknown>)?.tempPassword;
  const invalid = validateNewPassword(tempPassword);
  if (invalid) {
    res.status(400).json({ error: `tempPassword: ${invalid}` });
    return;
  }
  const user = setUserPassword(id, await hashPassword(tempPassword as string), true);
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  revokeAllUserSessions(id);
  res.json({ user: sanitizeUser(user) });
});

app.patch('/users/:id', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid user id' });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const user = updateUser(id, {
    email: typeof body.email === 'string' ? truncate(body.email, 240) : undefined,
    name: typeof body.name === 'string' ? truncate(body.name, 240) : undefined,
    role:
      body.role === 'admin' || body.role === 'team_lead' || body.role === 'agent'
        ? body.role
        : undefined,
    status:
      body.status === 'pending' || body.status === 'active' || body.status === 'disabled'
        ? body.status
        : undefined,
    team_id:
      typeof body.teamId === 'number' ? body.teamId : body.teamId === null ? null : undefined,
  });
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  if (user.status === 'disabled') revokeAllUserSessions(id);
  res.json({ user: sanitizeUser(user) });
});

app.get('/teams', requireAuth('team_lead'), (_req, res) => {
  res.json({ teams: listTeams() });
});

app.post('/teams', requireAuth('admin'), (req, res) => {
  try {
    const name = truncate((req.body as Record<string, unknown>).name, 160);
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    res.status(201).json({ team: createTeam(name) });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

app.get('/requests', requireAuth('team_lead'), (req, res) => {
  res.json({
    requests: listRequests({
      agentId: typeof req.query.agentId === 'string' ? req.query.agentId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      model: typeof req.query.model === 'string' ? req.query.model : undefined,
      teamId: typeof req.query.teamId === 'string' ? Number(req.query.teamId) : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
    }),
  });
});

app.get('/requests/:id', requireAuth('team_lead'), (req, res) => {
  const request = getRequest(req.params.id);
  if (!request) {
    res.status(404).json({ error: 'request not found' });
    return;
  }
  res.json({ request });
});

app.get('/analytics/summary', requireAuth('team_lead'), (_req, res) => {
  res.json(analyticsSummary());
});

app.get('/settings', requireAuth('team_lead'), (_req, res) => {
  res.json({ settings: runtimeSettings() });
});

app.patch('/settings', requireAuth('admin'), (req, res) => {
  res.json({ settings: updateSettings(req.body as Partial<SettingsRecord>) });
});

app.post('/maintenance/prune', requireAuth('admin'), (_req, res) => {
  res.json({ deleted: pruneOldRequests() });
});

function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function percent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

function modelBars(): string {
  const summary = analyticsSummary();
  const byModel = summary.byModel as Array<{ model: string; requests: number }>;
  const total = byModel.reduce((sum, row) => sum + row.requests, 0);
  const rows = byModel.length
    ? byModel
    : Object.values(MODELS).map((model) => ({ model: model.id, requests: 0 }));
  return rows
    .map((row) => {
      const width = total ? Math.round((row.requests / total) * 100) : 0;
      return `<div class="bar-row"><span>${escapeHtml(row.model)}</span><div class="bar"><i style="width:${width}%"></i></div><strong>${row.requests}</strong></div>`;
    })
    .join('');
}

function activeAgentsRows(): string {
  const rows = Object.entries(metrics.activeByAgent)
    .filter(([, active]) => active > 0)
    .sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<tr><td colspan="3">Nessun agente attivo</td></tr>';
  return rows
    .map(([agentId, active]) => {
      const stats = metrics.byAgent[agentId];
      return `<tr><td>${escapeHtml(agentId)}</td><td>${active}</td><td>$${(stats?.estimatedCostUsd ?? 0).toFixed(4)}</td></tr>`;
    })
    .join('');
}

function recentRows(): string {
  const rows = listRequests({ limit: 10 });
  if (!rows.length) return '<tr><td colspan="7">Nessuna richiesta ancora registrata</td></tr>';
  return rows
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.created_at.slice(11, 19))}</td><td>${escapeHtml(m.agent_id)}</td><td>${escapeHtml(
          m.model,
        )}</td><td>${m.pages_count}</td><td>${m.estimated_input_tokens}</td><td>$${m.estimated_cost_usd.toFixed(
          4,
        )}</td><td>${m.status === 'ok' ? '<span class="pill ok-bg">ok</span>' : '<span class="pill warn-bg">' + escapeHtml(m.status) + '</span>'}</td></tr>`,
    )
    .join('');
}

// Shared minimal style for the standalone auth pages (login / change password).
const AUTH_PAGE_STYLE = `
    :root { --ink: #0b1f3a; --yellow: #ffcc00; --soft: #f5f7fa; --line: #d8e0ea; --muted: #5f6f82; --err: #a4262c; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--ink); background: var(--soft); display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .auth-card { width: 340px; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 24px; border-top: 4px solid var(--yellow); }
    h1 { margin: 0 0 4px; font-size: 20px; }
    p.sub { margin: 0 0 16px; color: var(--muted); font-size: 13px; }
    label { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin: 12px 0 4px; }
    input { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 9px; font: inherit; }
    button { width: 100%; margin-top: 18px; border: 1px solid #d8ad00; border-radius: 6px; padding: 10px; background: var(--yellow); color: var(--ink); cursor: pointer; font-weight: 800; font-size: 14px; }
    .error { display: none; margin-top: 12px; padding: 9px; border-radius: 6px; background: #fdecea; color: var(--err); font-size: 13px; }
`;

function authPage(options: {
  title: string;
  subtitle: string;
  formHtml: string;
  script: string;
}): string {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.title)} — RunwaySurfer</title>
  <style>${AUTH_PAGE_STYLE}</style>
</head>
<body>
  <div class="auth-card">
    <h1>${escapeHtml(options.title)}</h1>
    <p class="sub">${escapeHtml(options.subtitle)}</p>
    ${options.formHtml}
    <div class="error" id="error"></div>
  </div>
  <script>
    const errorBox = document.getElementById('error');
    function showError(message) { errorBox.textContent = message; errorBox.style.display = 'block'; }
    ${options.script}
  </script>
</body>
</html>`;
}

app.get('/login', (req, res) => {
  // Already authenticated? Straight to the right page.
  const auth = authenticate(req);
  if (auth) {
    res.redirect(auth.user.must_change_password ? '/change-password' : '/dashboard');
    return;
  }
  res.type('html').send(
    authPage({
      title: 'RunwaySurfer Dashboard',
      subtitle: 'Accedi con le credenziali fornite dal tuo amministratore.',
      formHtml: `
    <form id="login-form">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required autofocus />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Accedi</button>
    </form>`,
      script: `
    document.getElementById('login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.style.display = 'none';
      const body = Object.fromEntries(new FormData(event.target).entries());
      body.client = 'dashboard';
      try {
        const res = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) { showError(data.error || ('Errore ' + res.status)); return; }
        location.href = data.mustChangePassword ? '/change-password' : '/dashboard';
      } catch (e) { showError(String(e)); }
    });`,
    }),
  );
});

app.get('/change-password', (req, res) => {
  const auth = authenticate(req);
  if (!auth) {
    res.redirect('/login');
    return;
  }
  res.type('html').send(
    authPage({
      title: 'Cambio password',
      subtitle: auth.user.must_change_password
        ? 'Devi impostare una nuova password prima di continuare.'
        : 'Imposta una nuova password per il tuo account.',
      formHtml: `
    <form id="change-form">
      <label for="currentPassword">Password attuale</label>
      <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required autofocus />
      <label for="newPassword">Nuova password (min 8 caratteri)</label>
      <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
      <label for="confirmPassword">Conferma nuova password</label>
      <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
      <button type="submit">Cambia password</button>
    </form>`,
      script: `
    document.getElementById('change-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.style.display = 'none';
      const body = Object.fromEntries(new FormData(event.target).entries());
      if (body.newPassword !== body.confirmPassword) { showError('Le nuove password non coincidono.'); return; }
      try {
        const res = await fetch('/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: body.currentPassword, newPassword: body.newPassword }) });
        const data = await res.json();
        if (!res.ok) { showError(data.error || ('Errore ' + res.status)); return; }
        location.href = '/dashboard';
      } catch (e) { showError(String(e)); }
    });`,
    }),
  );
});

app.get('/dashboard', requirePage('team_lead'), (_req, res) => {
  const auth = res.locals.auth as AuthContext;
  const isAdmin = auth.user.role === 'admin';
  const data = dashboardData();
  const settings = runtimeSettings();
  const summary = analyticsSummary() as {
    totals: {
      requests: number;
      ok: number;
      errors: number;
      rejected: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
    };
  };
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
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }
    h1 { margin: 0; font-size: 22px; }
    .whoami { display: flex; align-items: center; gap: 12px; font-size: 13px; }
    .whoami .role { opacity: 0.75; }
    .whoami button { width: auto; padding: 7px 12px; }
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
    .wide { grid-column: 1 / -1; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    .meter {
      height: 10px;
      overflow: hidden;
      border-radius: 999px;
      background: #e8eef5;
      margin-top: 10px;
    }
    .meter i, .bar i {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--yellow), #0a5aa3);
    }
    .bar-row {
      display: grid;
      grid-template-columns: 90px 1fr 42px;
      align-items: center;
      gap: 10px;
      margin: 9px 0;
      font-size: 13px;
    }
    .bar {
      height: 9px;
      overflow: hidden;
      border-radius: 999px;
      background: #e8eef5;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
    }
    th, td {
      padding: 8px 6px;
      border-bottom: 1px solid var(--line);
      text-align: left;
    }
    th {
      color: var(--muted);
      font-size: 11px;
      text-transform: uppercase;
    }
    .pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: 999px;
      font-weight: 800;
      font-size: 11px;
    }
    .ok-bg { background: #dff7eb; color: var(--ok); }
    .warn-bg { background: #fff3cf; color: var(--warn); }
    @media (max-width: 760px) { .split { grid-template-columns: 1fr; } }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button {
      border: 1px solid #d8ad00;
      border-radius: 6px;
      padding: 8px 10px;
      background: var(--yellow);
      color: var(--ink);
      cursor: pointer;
      font-weight: 800;
    }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px;
      font: inherit;
    }
    textarea { min-height: 92px; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .form-row { display: flex; flex-direction: column; gap: 4px; }
    .response-panel { white-space: pre-wrap; max-height: 420px; }
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
    <div class="whoami">
      <span>${escapeHtml(auth.user.name || auth.user.external_id)} <span class="role">(${escapeHtml(auth.user.role)})</span></span>
      <button id="logout-btn" type="button">Logout</button>
    </div>
  </header>
  <main>
    <section class="grid">
      <div class="card"><div class="label">Provider</div><div class="value">${data.provider}</div></div>
      <div class="card"><div class="label">AI readiness</div><div class="value ${data.aiReady ? 'ok' : 'warn'}">${readiness}</div></div>
      <div class="card"><div class="label">CORS</div><div class="value">${data.corsOrigin}</div></div>
      <div class="card"><div class="label">Egress</div><div class="value">${data.egress}</div></div>
      <div class="card"><div class="label">Requests</div><div class="value">${summary.totals.requests}</div></div>
      <div class="card"><div class="label">Active</div><div class="value">${metrics.activeRequests}</div></div>
      <div class="card"><div class="label">Est. cost</div><div class="value">$${summary.totals.estimatedCostUsd.toFixed(4)}</div></div>
      <div class="card"><div class="label">Input tokens</div><div class="value">${summary.totals.inputTokens}</div></div>
      <div class="card"><div class="label">Rejected</div><div class="value">${summary.totals.rejected}</div></div>
    </section>
    <section class="grid" style="margin-top:12px">
      <div class="card">
        <div class="label">Total concurrency</div>
        <div class="value">${metrics.activeRequests}/${settings.max_concurrent_requests}</div>
        <div class="meter"><i style="width:${percent(metrics.activeRequests, settings.max_concurrent_requests)}%"></i></div>
      </div>
      <div class="card">
        <div class="label">Cost guardrail</div>
        <div class="value">$${summary.totals.estimatedCostUsd.toFixed(4)} / $${settings.max_daily_estimated_cost_usd.toFixed(2)}</div>
        <div class="meter"><i style="width:${percent(summary.totals.estimatedCostUsd, settings.max_daily_estimated_cost_usd)}%"></i></div>
      </div>
      <div class="card">
        <div class="label">Per-agent limit</div>
        <div class="value">${settings.max_concurrent_per_agent}</div>
        <div class="meter"><i style="width:${percent(settings.max_concurrent_per_agent, Math.max(settings.max_concurrent_per_agent, 4))}%"></i></div>
      </div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Control-plane draft</div>
      <p>Questa pagina espone lo stato operativo del proxy. L'accesso è protetto da login
      con sessione; l'estensione si autentica con token Bearer sugli endpoint <code>/ask</code>
      e <code>/extension-config</code>.</p>
      <p><a href="/metrics">Metrics</a> - <a href="/extension-config">Extension config</a></p>
      <p><a href="/dashboard-data">Apri JSON dashboard-data</a> · <a href="/health">Health</a> · <a href="/requirements">Requirements</a></p>
    </section>
    <section class="split">
      <div class="card">
        <div class="label">Model distribution</div>
        ${modelBars()}
      </div>
      <div class="card">
        <div class="label">Active agents</div>
        <table><thead><tr><th>Agent</th><th>Active</th><th>Cost</th></tr></thead><tbody>${activeAgentsRows()}</tbody></table>
      </div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Recent requests</div>
      <table><thead><tr><th>Time</th><th>Agent</th><th>Model</th><th>Pages</th><th>Input tok</th><th>Cost</th><th>Status</th></tr></thead><tbody>${recentRows()}</tbody></table>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Executable API actions</div>
      <div class="actions">
        <button data-get="/health">Health</button>
        <button data-get="/metrics">Metrics</button>
        <button data-get="/extension-config">Extension config</button>
        <button data-get="/requirements">Requirements</button>
        <button data-get="/analytics/summary">Analytics summary</button>
        <button data-get="/users">Users</button>
        <button data-get="/teams">Teams</button>
        <button data-get="/requests?limit=20">Requests</button>
      </div>
    </section>
    ${
      isAdmin
        ? `<section class="split">
      <div class="card">
        <div class="label">Create team</div>
        <form id="team-form" class="form-grid">
          <label class="form-row">Name<input name="name" placeholder="T1 Support" required /></label>
          <div class="form-row"><span>&nbsp;</span><button type="submit">Create team</button></div>
        </form>
      </div>
      <div class="card">
        <div class="label">Create user</div>
        <form id="user-form" class="form-grid">
          <label class="form-row">Username (external ID)<input name="externalId" placeholder="agent@example.com" required /></label>
          <label class="form-row">Temporary password<input name="tempPassword" type="password" minlength="8" required autocomplete="new-password" /></label>
          <label class="form-row">Email<input name="email" placeholder="agent@example.com" /></label>
          <label class="form-row">Name<input name="name" placeholder="Agent name" /></label>
          <label class="form-row">Role<select name="role"><option value="agent">agent</option><option value="team_lead">team_lead</option><option value="admin">admin</option></select></label>
          <label class="form-row">Status<select name="status"><option value="active">active</option><option value="pending">pending</option><option value="disabled">disabled</option></select></label>
          <label class="form-row">Team ID<input name="teamId" type="number" min="1" /></label>
          <div class="form-row"><span>&nbsp;</span><button type="submit">Create user</button></div>
        </form>
        <p style="font-size:12px;color:var(--muted);margin:10px 0 0">L'utente dovrà cambiare la password temporanea al primo login.
        Gli utenti creati prima dell'introduzione del login non hanno password: usa il reset qui sotto per abilitarli.</p>
      </div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Reset user password</div>
      <form id="reset-password-form" class="form-grid">
        <label class="form-row">User ID<input name="userId" type="number" min="1" required /></label>
        <label class="form-row">New temporary password<input name="tempPassword" type="password" minlength="8" required autocomplete="new-password" /></label>
        <div class="form-row"><span>&nbsp;</span><button type="submit">Reset password</button></div>
      </form>
      <p style="font-size:12px;color:var(--muted);margin:10px 0 0">Revoca tutte le sessioni attive dell'utente e forza il cambio password al prossimo login.</p>
    </section>`
        : ''
    }
    <section class="split">
      ${
        isAdmin
          ? `<div class="card">
        <div class="label">Settings</div>
        <form id="settings-form" class="form-grid">
          <label class="form-row">Max concurrent<input name="max_concurrent_requests" type="number" value="${settings.max_concurrent_requests}" /></label>
          <label class="form-row">Per agent<input name="max_concurrent_per_agent" type="number" value="${settings.max_concurrent_per_agent}" /></label>
          <label class="form-row">Daily cost USD<input name="max_daily_estimated_cost_usd" type="number" step="0.01" value="${settings.max_daily_estimated_cost_usd}" /></label>
          <label class="form-row">Max pages<input name="max_request_pages" type="number" value="${settings.max_request_pages}" /></label>
          <label class="form-row">Max links<input name="max_request_links" type="number" value="${settings.max_request_links}" /></label>
          <label class="form-row">Page chars<input name="max_page_text_chars" type="number" value="${settings.max_page_text_chars}" /></label>
          <label class="form-row">Retention days<input name="retention_days" type="number" value="${settings.retention_days}" /></label>
          <div class="form-row"><span>&nbsp;</span><button type="submit">Save settings</button></div>
        </form>
      </div>`
          : ''
      }
      <div class="card">
        <div class="label">Request filters</div>
        <form id="request-filter-form" class="form-grid">
          <label class="form-row">Agent ID<input name="agentId" /></label>
          <label class="form-row">Status<select name="status"><option value="">any</option><option value="ok">ok</option><option value="error">error</option><option value="rejected">rejected</option></select></label>
          <label class="form-row">Model<input name="model" /></label>
          <label class="form-row">Limit<input name="limit" type="number" value="20" /></label>
          <div class="form-row"><span>&nbsp;</span><button type="submit">Load requests</button></div>
        </form>
      </div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Demo ask request</div>
      <form id="ask-form" class="form-grid">
        <label class="form-row">Query<input name="query" value="come funziona questa pagina?" /></label>
        <label class="form-row wide">Page text<textarea name="pageText">Pagina demo della Knowledge Base con procedura, eccezioni e fonti.</textarea></label>
        <div class="form-row"><span>&nbsp;</span><button type="submit">POST /ask</button></div>
      </form>
      <p style="font-size:12px;color:var(--muted);margin:10px 0 0">La richiesta viene attribuita all'utente loggato (${escapeHtml(auth.user.external_id)}).</p>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Response panel</div>
      <pre id="api-response" class="response-panel">Seleziona un'azione dalla dashboard.</pre>
    </section>
    <pre>${JSON.stringify(data, null, 2)}</pre>
  </main>
  <script>
    const out = document.getElementById('api-response');
    function show(value) { out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
    async function api(path, options = {}) {
      const res = await fetch(path, options);
      const type = res.headers.get('content-type') || '';
      const body = type.includes('application/json') ? await res.json() : await res.text();
      show({ status: res.status, body });
      return body;
    }
    document.querySelectorAll('[data-get]').forEach((button) => {
      button.addEventListener('click', () => api(button.dataset.get));
    });
    function formDataObject(form) {
      const raw = Object.fromEntries(new FormData(form).entries());
      for (const [key, value] of Object.entries(raw)) {
        if (value === '') delete raw[key];
        else if (['teamId', 'limit'].includes(key) || key.startsWith('max_') || key === 'retention_days') {
          raw[key] = Number(value);
        }
      }
      return raw;
    }
    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST' });
      location.href = '/login';
    });
    // Admin-only forms are not rendered for team_lead, hence the null guards.
    document.getElementById('team-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      api('/teams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formDataObject(event.target)) });
    });
    document.getElementById('user-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      api('/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formDataObject(event.target)) });
    });
    document.getElementById('reset-password-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = formDataObject(event.target);
      api('/users/' + Number(data.userId) + '/reset-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tempPassword: data.tempPassword }) });
    });
    document.getElementById('settings-form')?.addEventListener('submit', (event) => {
      event.preventDefault();
      api('/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(formDataObject(event.target)) });
    });
    document.getElementById('request-filter-form').addEventListener('submit', (event) => {
      event.preventDefault();
      const params = new URLSearchParams(formDataObject(event.target));
      api('/requests?' + params.toString());
    });
    // Identity comes from the session cookie: the request is attributed to the
    // logged-in user, no spoofable header.
    document.getElementById('ask-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = formDataObject(event.target);
      const res = await fetch('/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: data.query,
          pages: [{ url: 'dashboard://demo', title: 'Dashboard demo page', text: data.pageText, origin: 'current' }],
          links: [],
        }),
      });
      const reader = res.body?.getReader();
      if (!reader) { show({ status: res.status, body: await res.text() }); return; }
      const decoder = new TextDecoder();
      let text = '';
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value, { stream: true });
        show(text);
      }
    });
  </script>
</body>
</html>`);
});

/** Main endpoint: model routing + cost estimate + streamed outcome (SSE). */
app.post('/ask', requireAuth('agent'), async (req, res) => {
  const settings = runtimeSettings();
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
  const rejectedRequestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (user.status === 'disabled') {
    metrics.rejectedRequests += 1;
    persistRequest({
      id: rejectedRequestId,
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
      status: 'rejected',
      error: 'user disabled',
      selectedLinks: request.links,
      sources: request.pages.map((p) => ({ title: p.title, url: p.url, origin: p.origin })),
    });
    res.status(403).json({ error: 'user disabled' });
    return;
  }
  const capacity = canAcceptRequest(agentId, settings);
  if (!capacity.ok) {
    metrics.rejectedRequests += 1;
    persistRequest({
      id: rejectedRequestId,
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
      status: 'rejected',
      error: capacity.message,
      selectedLinks: request.links,
      sources: request.pages.map((p) => ({ title: p.title, url: p.url, origin: p.origin })),
    });
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
  const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const startedAt = Date.now();
  metrics.activeRequests += 1;
  metrics.activeByAgent[agentId] = (metrics.activeByAgent[agentId] ?? 0) + 1;
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

  send({ type: 'plan', plan });
  try {
    await provider.streamOutcome(
      { ...request, model: spec.id },
      (text) => send({ type: 'delta', text }),
      ac.signal,
    );
    send({ type: 'done' });
    recordMetric({
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
      ms: Date.now() - startedAt,
      ok: true,
    });
    persistRequest({
      id: requestId,
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
      durationMs: Date.now() - startedAt,
      status: 'ok',
      selectedLinks: request.links,
      sources: request.pages.map((p) => ({ title: p.title, url: p.url, origin: p.origin })),
    });
  } catch (e) {
    const message = String(e);
    send({ type: 'error', message });
    recordMetric({
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
      ms: Date.now() - startedAt,
      ok: false,
      error: message,
    });
    persistRequest({
      id: requestId,
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
      durationMs: Date.now() - startedAt,
      status: 'error',
      error: message,
      selectedLinks: request.links,
      sources: request.pages.map((p) => ({ title: p.title, url: p.url, origin: p.origin })),
    });
  }
  res.end();
});

await bootstrapAdmin();

app.listen(PORT, () => {
  console.log(
    `RunwaySurfer proxy on :${PORT} — provider=${getProvider().name}, CORS=${ALLOWED_ORIGIN}`,
  );
});
