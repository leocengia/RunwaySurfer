// Dashboard HTML (renderizzata lato server). Solo presentazione: i dati
// arrivano da status.ts / db.ts, la logica delle route resta in routes/pages.ts.
import { escapeHtml, percent } from './html.js';
import { MODELS } from '../router.js';
import { analyticsSummary, getSettings, listRequests } from '../db.js';
import { metrics } from '../metrics.js';
import { dashboardData } from '../status.js';
import type { AuthContext } from '../auth.js';

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

export function renderDashboard(auth: AuthContext): string {
  const isAdmin = auth.user.role === 'admin';
  const data = dashboardData();
  const settings = getSettings();
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
  return `<!doctype html>
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
      <div class="card"><div class="label">CORS</div><div class="value">${escapeHtml(data.corsOrigin)}</div></div>
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
</html>`;
}
