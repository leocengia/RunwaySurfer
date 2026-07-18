// Dashboard HTML (renderizzata lato server). Solo presentazione: i dati
// arrivano da status.ts / db.ts, la logica delle route resta in routes/pages.ts.
import { escapeHtml, percent } from './html.js';
import { MODELS } from '../router.js';
import {
  analyticsSummary,
  getSettings,
  listRequests,
  listTeams,
  listUsers,
  sanitizeUser,
} from '../db.js';
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

function statusPill(status: string): string {
  const cls = status === 'active' ? 'ok-bg' : status === 'disabled' ? 'warn-bg' : 'muted-bg';
  return `<span class="pill ${cls}">${escapeHtml(status)}</span>`;
}

function rolePill(role: string): string {
  return `<span class="pill role-bg">${escapeHtml(role)}</span>`;
}

function usersRows(): string {
  const teams = new Map(listTeams().map((t) => [t.id, t.name]));
  const users = listUsers().map(sanitizeUser);
  if (!users.length) return '<tr><td colspan="8">Nessun utente creato</td></tr>';
  return users
    .map((u) => {
      const team = u.team_id != null ? escapeHtml(teams.get(u.team_id) ?? `#${u.team_id}`) : '—';
      return `<tr><td>${u.id}</td><td>${escapeHtml(u.external_id)}</td><td>${escapeHtml(
        u.name ?? '',
      )}</td><td>${escapeHtml(u.email ?? '')}</td><td>${rolePill(u.role)}</td><td>${statusPill(
        u.status,
      )}</td><td>${team}</td><td>${escapeHtml(u.created_at.slice(0, 10))}</td></tr>`;
    })
    .join('');
}

function teamsRows(): string {
  const counts = new Map<number, number>();
  for (const u of listUsers()) {
    if (u.team_id != null) counts.set(u.team_id, (counts.get(u.team_id) ?? 0) + 1);
  }
  const teams = listTeams();
  if (!teams.length) return '<tr><td colspan="4">Nessun team creato</td></tr>';
  return teams
    .map(
      (t) =>
        `<tr><td>${t.id}</td><td>${escapeHtml(t.name)}</td><td>${counts.get(t.id) ?? 0}</td><td>${escapeHtml(
          t.created_at.slice(0, 10),
        )}</td></tr>`,
    )
    .join('');
}

function recentRows(): string {
  const rows = listRequests({ limit: 10 });
  if (!rows.length) return '<tr><td colspan="8">Nessuna richiesta ancora registrata</td></tr>';
  return rows
    .map((m) => {
      // Token reali dal provider quando presenti (colonne actual_*, popolate solo
      // dal provider reale): mostrati accanto alla stima come "in/out", "—" se null.
      const real =
        m.actual_input_tokens != null || m.actual_output_tokens != null
          ? `${m.actual_input_tokens ?? '—'}/${m.actual_output_tokens ?? '—'}`
          : '—';
      return `<tr><td>${escapeHtml(m.created_at.slice(11, 19))}</td><td>${escapeHtml(m.agent_id)}</td><td>${escapeHtml(
        m.model,
      )}</td><td>${m.pages_count}</td><td>${m.estimated_input_tokens}</td><td>${real}</td><td>$${m.estimated_cost_usd.toFixed(
        4,
      )}</td><td>${m.status === 'ok' ? '<span class="pill ok-bg">ok</span>' : '<span class="pill warn-bg">' + escapeHtml(m.status) + '</span>'}</td></tr>`;
    })
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
      /* Liquid-glass tokens (palette invariata). */
      --glass: rgba(255, 255, 255, 0.68);
      --glass-strong: rgba(255, 255, 255, 0.86);
      --glass-navy: rgba(11, 31, 58, 0.82);
      --glass-border: rgba(255, 255, 255, 0.55);
      --glass-blur: blur(16px) saturate(160%);
      --glass-shadow: 0 8px 30px rgba(11, 31, 58, 0.14);
      --glass-sheen: inset 0 1px 0 rgba(255, 255, 255, 0.6);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(1200px 600px at 12% -10%, rgba(10, 90, 163, 0.16), transparent 60%),
        radial-gradient(900px 520px at 100% 0%, rgba(255, 204, 0, 0.12), transparent 55%),
        linear-gradient(180deg, #eef2f7, var(--soft));
      background-attachment: fixed;
      min-height: 100vh;
    }
    header {
      padding: 22px 28px;
      color: #fff;
      background: var(--glass-navy);
      -webkit-backdrop-filter: var(--glass-blur);
      backdrop-filter: var(--glass-blur);
      border-bottom: 4px solid var(--yellow);
      box-shadow: var(--glass-sheen);
      position: sticky;
      top: 0;
      z-index: 5;
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
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      padding: 14px;
      background: var(--glass);
      -webkit-backdrop-filter: var(--glass-blur);
      backdrop-filter: var(--glass-blur);
      box-shadow: var(--glass-sheen), var(--glass-shadow);
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
    .muted-bg { background: #eef2f7; color: var(--muted); }
    .role-bg { background: #e6effa; color: var(--blue); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .view-toggle { display: inline-flex; border: 1px solid var(--glass-border); border-radius: 10px; overflow: hidden; -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
    .view-toggle button {
      border: 0;
      border-radius: 0;
      background: var(--glass-strong);
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      padding: 6px 12px;
    }
    .view-toggle button.active { background: var(--yellow); color: var(--ink); }
    .api-graphic { margin-top: 12px; }
    .api-graphic .empty { color: var(--muted); font-size: 13px; }
    .kv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
    .kv { border: 1px solid var(--glass-border); border-radius: 10px; padding: 10px 12px; background: var(--glass-strong); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); box-shadow: var(--glass-sheen); }
    .kv .k { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .kv .v { margin-top: 3px; font-size: 15px; font-weight: 700; word-break: break-word; }
    .stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
    .table-wrap { overflow-x: auto; }
    .status-line { margin: 0 0 10px; font-size: 12px; color: var(--muted); }
    @media (max-width: 760px) { .split { grid-template-columns: 1fr; } }
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
    button {
      border: 1px solid #d8ad00;
      border-radius: 10px;
      padding: 8px 10px;
      background: linear-gradient(180deg, #ffd84d, var(--yellow));
      color: var(--ink);
      cursor: pointer;
      font-weight: 800;
      box-shadow: var(--glass-sheen), 0 4px 14px rgba(216, 173, 0, 0.28);
    }
    button:hover { background: linear-gradient(180deg, #ffe066, #ffd633); }
    input, select, textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 8px;
      font: inherit;
      background: var(--glass-strong);
      -webkit-backdrop-filter: var(--glass-blur);
      backdrop-filter: var(--glass-blur);
      color: var(--ink);
    }
    input:focus, select:focus, textarea:focus {
      border-color: #0a5aa3;
      outline: 2px solid rgba(10, 90, 163, 0.18);
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
      border: 1px solid var(--glass-border);
      border-radius: 12px;
      background: var(--glass-strong);
      -webkit-backdrop-filter: var(--glass-blur);
      backdrop-filter: var(--glass-blur);
      box-shadow: var(--glass-sheen);
    }
    a { color: var(--blue); font-weight: 700; }
    /* Fallback: senza backdrop-filter o con trasparenza ridotta, superfici opache. */
    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      .card, pre, .kv, input, select, textarea, .view-toggle button { background: #fff; }
      header { background: var(--ink); }
    }
    @media (prefers-reduced-transparency: reduce) {
      body { background: var(--soft); }
      .card, pre, .kv, input, select, textarea, .view-toggle button {
        background: #fff;
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
      }
      header {
        background: var(--ink);
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
      }
    }
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
      <table><thead><tr><th>Time</th><th>Agent</th><th>Model</th><th>Pages</th><th>Est. in tok</th><th>Real in/out</th><th>Cost</th><th>Status</th></tr></thead><tbody>${recentRows()}</tbody></table>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Utenti (${listUsers().length})</div>
      <div class="table-wrap">
        <table><thead><tr><th>ID</th><th>Username</th><th>Nome</th><th>Email</th><th>Ruolo</th><th>Stato</th><th>Team</th><th>Creato</th></tr></thead><tbody>${usersRows()}</tbody></table>
      </div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Team (${listTeams().length})</div>
      <div class="table-wrap">
        <table><thead><tr><th>ID</th><th>Nome</th><th>Membri</th><th>Creato</th></tr></thead><tbody>${teamsRows()}</tbody></table>
      </div>
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
      <div class="panel-head">
        <div class="label">Response panel</div>
        <div class="view-toggle">
          <button id="view-graphic" type="button" class="active">Vista grafica</button>
          <button id="view-json" type="button">JSON grezzo</button>
        </div>
      </div>
      <div id="api-graphic" class="api-graphic"><span class="empty">Seleziona un'azione dalla dashboard.</span></div>
      <pre id="api-response" class="response-panel" hidden>Seleziona un'azione dalla dashboard.</pre>
    </section>
    <pre>${JSON.stringify(data, null, 2)}</pre>
  </main>
  <script>
    const out = document.getElementById('api-response');
    const graphic = document.getElementById('api-graphic');
    const btnGraphic = document.getElementById('view-graphic');
    const btnJson = document.getElementById('view-json');
    let currentView = 'graphic';

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function pill(text, cls) { return '<span class="pill ' + cls + '">' + esc(text) + '</span>'; }
    function statusPill(s) {
      const cls = s === 'active' ? 'ok-bg' : s === 'disabled' ? 'warn-bg' : 'muted-bg';
      return pill(s, cls);
    }
    function fmtVal(v) {
      if (v === true) return pill('true', 'ok-bg');
      if (v === false) return pill('false', 'warn-bg');
      if (v === 'ok' || v === 'ready' || v === 'Ready') return pill(v, 'ok-bg');
      if (v == null || v === '') return '—';
      return esc(v);
    }
    function table(headers, rows) {
      return '<div class="table-wrap"><table><thead><tr>' + headers.map((h) => '<th>' + esc(h) + '</th>').join('') +
        '</tr></thead><tbody>' + (rows.length ? rows.join('') : '<tr><td colspan="' + headers.length + '">Nessun dato</td></tr>') +
        '</tbody></table></div>';
    }
    function kvCards(obj) {
      return '<div class="kv-grid">' + Object.entries(obj).map(([k, v]) => {
        const inner = v && typeof v === 'object' ? renderAny(v) : fmtVal(v);
        return '<div class="kv"><div class="k">' + esc(k) + '</div><div class="v">' + inner + '</div></div>';
      }).join('') + '</div>';
    }
    function statTiles(pairs) {
      return '<div class="stat-tiles">' + pairs.map(([k, v]) =>
        '<div class="card"><div class="label">' + esc(k) + '</div><div class="value">' + fmtVal(v) + '</div></div>').join('') + '</div>';
    }
    function usersTable(users) {
      return table(['ID', 'Username', 'Nome', 'Email', 'Ruolo', 'Stato', 'Team', 'Creato'], users.map((u) =>
        '<tr><td>' + esc(u.id) + '</td><td>' + esc(u.external_id) + '</td><td>' + esc(u.name || '') + '</td><td>' +
        esc(u.email || '') + '</td><td>' + pill(u.role, 'role-bg') + '</td><td>' + statusPill(u.status) + '</td><td>' +
        (u.team_id == null ? '—' : esc(u.team_id)) + '</td><td>' + esc(String(u.created_at).slice(0, 10)) + '</td></tr>'));
    }
    function teamsTable(teams) {
      return table(['ID', 'Nome', 'Creato'], teams.map((t) =>
        '<tr><td>' + esc(t.id) + '</td><td>' + esc(t.name) + '</td><td>' + esc(String(t.created_at).slice(0, 10)) + '</td></tr>'));
    }
    function requestsTable(reqs) {
      return table(['Time', 'Agent', 'Model', 'Pages', 'Input tok', 'Cost', 'Status'], reqs.map((m) =>
        '<tr><td>' + esc(String(m.created_at).slice(11, 19)) + '</td><td>' + esc(m.agent_id) + '</td><td>' + esc(m.model) +
        '</td><td>' + esc(m.pages_count) + '</td><td>' + esc(m.estimated_input_tokens) + '</td><td>$' +
        Number(m.estimated_cost_usd || 0).toFixed(4) + '</td><td>' +
        (m.status === 'ok' ? pill('ok', 'ok-bg') : pill(m.status, 'warn-bg')) + '</td></tr>'));
    }
    function modelBars(rows) {
      const total = rows.reduce((s, r) => s + (r.requests || 0), 0);
      return rows.map((r) => {
        const w = total ? Math.round((r.requests / total) * 100) : 0;
        return '<div class="bar-row"><span>' + esc(r.model) + '</span><div class="bar"><i style="width:' + w +
          '%"></i></div><strong>' + esc(r.requests) + '</strong></div>';
      }).join('');
    }
    function analyticsView(body) {
      const t = body.totals || {};
      const tiles = statTiles([['Requests', t.requests], ['OK', t.ok], ['Errors', t.errors], ['Rejected', t.rejected],
        ['Input tokens', t.inputTokens], ['Output tokens', t.outputTokens], ['Est. cost', '$' + Number(t.estimatedCostUsd || 0).toFixed(4)]]);
      const model = Array.isArray(body.byModel) ? body.byModel : [];
      return tiles + (model.length ? '<div class="label" style="margin-top:14px">Distribuzione modelli</div>' + modelBars(model) : '');
    }
    function metricsView(body) {
      const scalars = Object.entries(body).filter(([, v]) => !v || typeof v !== 'object');
      const nested = Object.entries(body).filter(([, v]) => v && typeof v === 'object');
      let html = scalars.length ? statTiles(scalars) : '';
      for (const [k, v] of nested) html += '<div class="label" style="margin-top:14px">' + esc(k) + '</div>' + renderAny(v);
      return html || '<span class="empty">Nessun dato</span>';
    }
    function renderAny(v) {
      if (Array.isArray(v)) {
        if (!v.length) return '<span class="empty">Vuoto</span>';
        if (v[0] && typeof v[0] === 'object') {
          const cols = Object.keys(v[0]);
          return table(cols, v.map((row) => '<tr>' + cols.map((c) => '<td>' + fmtVal(row[c]) + '</td>').join('') + '</tr>'));
        }
        return esc(v.join(', '));
      }
      if (v && typeof v === 'object') return kvCards(v);
      return fmtVal(v);
    }
    // Pick the graphical renderer from the response shape, so both GET list
    // endpoints and POST single-item results get a tailored view.
    function renderBody(body) {
      if (body == null) return '<span class="empty">Nessun contenuto</span>';
      if (typeof body === 'string') return '<pre class="response-panel">' + esc(body) + '</pre>';
      if (Array.isArray(body.users)) return usersTable(body.users);
      if (Array.isArray(body.teams)) return teamsTable(body.teams);
      if (Array.isArray(body.requests)) return requestsTable(body.requests);
      if (body.totals && body.byModel) return analyticsView(body);
      if (body.user) return kvCards(body.user);
      if (body.team) return kvCards(body.team);
      if (body.settings) return kvCards(body.settings);
      if (body.error) return '<div class="kv" style="border-color:#f2c8c2;background:#fdeeec"><div class="k">Errore</div><div class="v">' + esc(body.error) + '</div></div>';
      if (typeof body.activeRequests === 'number') return metricsView(body);
      return kvCards(body);
    }
    function renderGraphic(value) {
      if (value && typeof value === 'object' && 'status' in value && 'body' in value) {
        const cls = value.status < 300 ? 'ok-bg' : 'warn-bg';
        return '<p class="status-line">HTTP ' + pill(value.status, cls) + '</p>' + renderBody(value.body);
      }
      return renderBody(value);
    }
    function applyView() {
      const g = currentView === 'graphic';
      graphic.hidden = !g;
      out.hidden = g;
      btnGraphic.classList.toggle('active', g);
      btnJson.classList.toggle('active', !g);
    }
    function show(value) {
      out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      try { graphic.innerHTML = renderGraphic(value); }
      catch (e) { graphic.innerHTML = '<span class="empty">Impossibile rendere graficamente questa risposta.</span>'; }
    }
    btnGraphic.addEventListener('click', () => { currentView = 'graphic'; applyView(); });
    btnJson.addEventListener('click', () => { currentView = 'json'; applyView(); });
    applyView();

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
