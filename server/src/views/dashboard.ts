// Dashboard HTML (renderizzata lato server). Solo presentazione: i dati
// arrivano da status.ts / db.ts, la logica delle route resta in routes/pages.ts.
import { escapeHtml, percent } from './html.js';
import { LOGO_MARK, THEME_CSS } from '../shared-assets.js';
import { MODELS } from '../router.js';
import {
  analyticsSummary,
  estimatedCostMonthToDate,
  estimatedCostToday,
  getSettings,
  listFeedback,
  listFlaggedRequests,
  listRequests,
  listTeams,
  listUsers,
  sanitizeUser,
} from '../db.js';
import { USD_PER_EUR } from '../config.js';
import { estimatedCostEurThisMonth, metrics } from '../metrics.js';
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

/**
 * `extensionConfig()` in sola lettura, appiattito in coppie chiave/valore. Serve a
 * dare una casa alla "configurazione dell'estensione": i valori derivano dai
 * guardrail, quindi qui si guardano e si modificano dal form dei settings.
 */
function extensionConfigCards(config: Record<string, unknown>): string {
  const render = (value: unknown): string => {
    if (value === true) return '<span class="pill ok-bg">true</span>';
    if (value === false) return '<span class="pill warn-bg">false</span>';
    if (Array.isArray(value)) return escapeHtml(value.join(', '));
    if (value && typeof value === 'object') {
      return Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${escapeHtml(k)}: ${render(v)}`)
        .join('<br />');
    }
    return escapeHtml(String(value ?? '—'));
  };
  return Object.entries(config)
    .map(
      ([key, value]) =>
        `<div class="kv"><div class="k">${escapeHtml(key)}</div><div class="v">${render(value)}</div></div>`,
    )
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

/** 👍/👎 come pill leggibile anche in bianco e nero, non solo come emoji. */
function ratingPill(rating: string): string {
  return rating === 'up'
    ? '<span class="pill ok-bg">👍 utile</span>'
    : '<span class="pill warn-bg">👎 non utile</span>';
}

function feedbackRows(): string {
  const rows = listFeedback({ limit: 30 });
  if (!rows.length) {
    return '<tr><td colspan="6">Nessun feedback ancora ricevuto</td></tr>';
  }
  return rows
    .map(
      (f) =>
        `<tr><td>${escapeHtml(f.created_at.slice(0, 16).replace('T', ' '))}</td><td>${escapeHtml(
          f.agent_id,
        )}</td><td>${ratingPill(f.rating)}</td><td>${escapeHtml(f.query_preview ?? '—')}</td><td>${escapeHtml(
          f.comment ?? '—',
        )}</td><td>${escapeHtml(f.model ?? '—')}</td></tr>`,
    )
    .join('');
}

function flaggedRows(): string {
  const rows = listFlaggedRequests({ limit: 30 });
  if (!rows.length) {
    return '<tr><td colspan="6">Nessuna richiesta segnalata</td></tr>';
  }
  return rows
    .map((r) => {
      const tipo =
        r.flag === 'guasto'
          ? '<span class="pill warn-bg">guasto</span>'
          : '<span class="pill warn-bg">senza fonti</span>';
      const detail = r.flag === 'guasto' ? (r.error ?? r.status) : `${r.pages_count} pagine lette`;
      return `<tr><td>${escapeHtml(r.created_at.slice(0, 16).replace('T', ' '))}</td><td>${escapeHtml(
        r.agent_id,
      )}</td><td>${tipo}</td><td>${escapeHtml(r.query_preview)}</td><td>${escapeHtml(
        r.model,
      )}</td><td>${escapeHtml(detail)}</td></tr>`;
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
  // Stessa funzione che applica il guardrail (metrics.canAcceptRequest): la card
  // deve mostrare il numero che blocca, non un totale storico che non c'entra.
  const costEurThisMonth = estimatedCostEurThisMonth();
  const costUsdThisMonth = estimatedCostMonthToDate();
  const costToday = estimatedCostToday();
  const readiness = data.aiReady ? 'Ready' : 'Missing API key';
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Runway Surfer Control Dashboard</title>
  <style>
    /* Token condivisi con sidebar e FX del tour: unica fonte in shared/theme.css. */
${THEME_CSS}
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: var(--rs-font);
      color: var(--rs-navy);
      background:
        radial-gradient(1200px 600px at 12% -10%, rgba(0, 0, 153, 0.16), transparent 60%),
        radial-gradient(900px 520px at 100% 0%, rgba(255, 204, 0, 0.12), transparent 55%),
        linear-gradient(180deg, #eef2f7, var(--rs-soft));
      background-attachment: fixed;
      min-height: 100vh;
    }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      padding: 16px 28px;
      color: #fff;
      background: var(--rs-glass-primary);
      -webkit-backdrop-filter: var(--rs-glass-blur);
      backdrop-filter: var(--rs-glass-blur);
      border-bottom: 4px solid var(--rs-yellow);
      box-shadow: var(--rs-glass-sheen);
    }

    /* --- Schede: in riga col marchio e con l'utente, non su una riga propria.
       Non più "linguette" appoggiate al bordo giallo: in mezzo all'header sarebbe
       una metafora sbagliata, quindi sono pillole. --- */
    .tabs {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
      justify-content: center;
      flex: 1 1 auto;
      min-width: 0;
    }
    .tabs button {
      border: 1px solid transparent;
      border-radius: var(--rs-r-pill);
      padding: 8px 14px;
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
      font-size: 13px;
      font-weight: 700;
      box-shadow: none;
    }
    .tabs button:hover:not([aria-selected='true']) { background: rgba(255, 255, 255, 0.2); }
    .tabs button[aria-selected='true'] {
      background: var(--rs-yellow);
      color: var(--rs-navy);
      border-color: var(--rs-yellow-line);
    }
    .tabs button:focus-visible { outline: none; box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.4); }
    [role='tabpanel'][hidden] { display: none; }
    /* L'header era a filo viewport mentre main è in colonna centrata da 1100px:
       marchio e contenuto non erano incolonnati. */
    .header-inner {
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
    }
    /* Sotto i 1000px le tre zone non stanno in riga: le schede vanno a capo
       occupando tutta la larghezza, invece di comprimersi fino a diventare
       illeggibili. */
    @media (max-width: 1000px) {
      .tabs { order: 3; flex-basis: 100%; justify-content: flex-start; }
    }
    .brand { display: flex; align-items: center; gap: 14px; min-width: 0; }
    .brand .mark {
      flex-shrink: 0;
      width: 56px;
      height: 56px;
      border-radius: 22%;
      filter: drop-shadow(0 3px 8px rgba(2, 2, 40, 0.45));
    }
    /* Wordmark col taglio Display e tracking negativo: vedi shared/theme.css. */
    h1 { margin: 0; font-family: var(--rs-font-brand); font-size: 30px; font-weight: 700; line-height: 1.12; letter-spacing: -0.015em; }
    h1 small { display: block; margin-top: 3px; font-family: var(--rs-font); font-size: 13px; font-weight: 600; opacity: 0.75; letter-spacing: 0.05em; }
    .whoami { display: flex; align-items: center; gap: 12px; font-size: 13px; }
    .whoami .role { opacity: 0.75; }
    .whoami button { width: auto; padding: 7px 12px; }
    main { max-width: 1100px; margin: 0 auto; padding: 22px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
    .card {
      position: relative;
      border: 1px solid var(--rs-glass-border);
      border-radius: var(--rs-r-md);
      padding: 14px;
      background: var(--rs-glass);
      -webkit-backdrop-filter: var(--rs-glass-blur);
      backdrop-filter: var(--rs-glass-blur);
      box-shadow: var(--rs-glass-edge), var(--rs-glass-shadow);
      transition: box-shadow var(--rs-dur) var(--rs-ease), transform var(--rs-dur) var(--rs-ease);
    }
    /* Riflesso speculare in cima a ogni lastra. */
    .card::before {
      content: '';
      position: absolute;
      inset: 0 0 auto;
      height: 42%;
      border-radius: var(--rs-r-md) var(--rs-r-md) 0 0;
      pointer-events: none;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.4), transparent);
    }
    .card > * { position: relative; }
    .label { color: var(--rs-muted); font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
    .value { margin-top: 4px; font-size: 20px; font-weight: 800; }
    .sub { margin-top: 6px; color: var(--rs-muted); font-size: 12px; }
    .ok { color: var(--rs-success); }
    .warn { color: var(--rs-warn); }
    .wide { grid-column: 1 / -1; }
    .split { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 12px; }
    /* Colonna di card impilate dentro un .split: due operazioni brevi accanto a
       un form alto, invece di mezza riga vuota. align-content:start le tiene in
       cima invece di stirarle per pareggiare l'altra colonna. */
    .stack { display: grid; gap: 12px; align-content: start; }
    .meter {
      height: 10px;
      overflow: hidden;
      border-radius: var(--rs-r-pill);
      background: #e8eef5;
      margin-top: 10px;
    }
    .meter i, .bar i {
      display: block;
      height: 100%;
      background: linear-gradient(90deg, var(--rs-yellow), var(--rs-primary));
      transition: width 400ms var(--rs-ease);
    }
    .bar-row {
      display: grid;
      grid-template-columns: 90px 1fr 42px;
      align-items: center;
      gap: 10px;
      margin: 9px 0;
      font-size: 13px;
    }
    .bar { height: 9px; overflow: hidden; border-radius: var(--rs-r-pill); background: #e8eef5; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { padding: 8px 6px; border-bottom: 1px solid var(--rs-line); text-align: left; }
    th { color: var(--rs-muted); font-size: 11px; text-transform: uppercase; }
    .pill {
      display: inline-block;
      padding: 2px 7px;
      border-radius: var(--rs-r-pill);
      font-weight: 800;
      font-size: 11px;
    }
    .ok-bg { background: var(--rs-success-soft); color: var(--rs-success); }
    .warn-bg { background: var(--rs-warn-soft); color: var(--rs-warn); }
    .muted-bg { background: #eef2f7; color: var(--rs-muted); }
    .role-bg { background: var(--rs-primary-soft); color: var(--rs-primary); }
    .panel-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .view-toggle {
      display: inline-flex;
      border: 1px solid var(--rs-glass-border);
      border-radius: var(--rs-r-sm);
      overflow: hidden;
      -webkit-backdrop-filter: var(--rs-glass-blur);
      backdrop-filter: var(--rs-glass-blur);
    }
    .view-toggle button {
      border: 0;
      border-radius: 0;
      background: var(--rs-glass-strong);
      color: var(--rs-muted);
      font-size: 12px;
      font-weight: 800;
      padding: 6px 12px;
      box-shadow: none;
    }
    .view-toggle button.active { background: var(--rs-yellow); color: var(--rs-navy); }
    .api-graphic { margin-top: 12px; }
    .api-graphic .empty { color: var(--rs-muted); font-size: 13px; }
    .kv-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
    .kv {
      border: 1px solid var(--rs-glass-border);
      border-radius: var(--rs-r-sm);
      padding: 10px 12px;
      background: var(--rs-glass-strong);
      -webkit-backdrop-filter: var(--rs-glass-blur);
      backdrop-filter: var(--rs-glass-blur);
      box-shadow: var(--rs-glass-sheen);
    }
    .kv .k { color: var(--rs-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .kv .v { margin-top: 3px; font-size: 15px; font-weight: 700; word-break: break-word; }
    .stat-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 10px; }
    .table-wrap { overflow-x: auto; }
    .status-line { margin: 0 0 10px; font-size: 12px; color: var(--rs-muted); }
    @media (max-width: 760px) { .split { grid-template-columns: 1fr; } }

    /* --- Bottoni: giallo Expedia, con stati che prima non esistevano --- */
    .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .actions-group { margin-top: 12px; }
    .actions-group:first-of-type { margin-top: 8px; }
    .actions-label { color: var(--rs-muted); font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; }
    button {
      position: relative;
      border: 1px solid var(--rs-yellow-line);
      border-radius: var(--rs-r-sm);
      padding: 8px 12px;
      background: linear-gradient(180deg, var(--rs-yellow-hi), var(--rs-yellow));
      color: var(--rs-navy);
      cursor: pointer;
      /* Nel DOM normale i controlli NON ereditano il font: senza questa riga i
         bottoni della dashboard usavano il font dell'UA, non il nostro. */
      font-family: inherit;
      font-size: 13px;
      font-weight: 800;
      box-shadow: var(--rs-glass-edge), 0 4px 14px rgba(216, 173, 0, 0.28);
      transition:
        background var(--rs-dur) var(--rs-ease),
        box-shadow var(--rs-dur) var(--rs-ease),
        transform var(--rs-dur) var(--rs-ease);
    }
    button:hover:not(:disabled) { background: linear-gradient(180deg, #ffe066, #ffd633); }
    button:active:not(:disabled) { transform: translateY(1px) scale(0.995); }
    button:focus-visible { outline: none; box-shadow: var(--rs-focus-ring), 0 4px 14px rgba(216, 173, 0, 0.28); }
    button:disabled { opacity: 0.55; cursor: progress; }
    /* Azione selezionata: resta evidente quale risposta si sta guardando. */
    button[aria-pressed='true'] {
      border-color: var(--rs-primary);
      box-shadow: var(--rs-glass-edge), 0 0 0 2px rgba(0, 0, 153, 0.28), 0 4px 14px rgba(216, 173, 0, 0.28);
    }
    button.is-loading { overflow: hidden; }
    button.is-loading::after {
      content: '';
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.75), transparent);
      background-size: 45% 100%;
      background-repeat: no-repeat;
      animation: rs-shimmer 900ms linear infinite;
    }
    @keyframes rs-shimmer {
      from { background-position: -50% 0; }
      to { background-position: 150% 0; }
    }

    input, select, textarea {
      width: 100%;
      border: 1px solid var(--rs-line);
      border-radius: var(--rs-r-sm);
      padding: 8px;
      font: inherit;
      background: var(--rs-glass-strong);
      -webkit-backdrop-filter: var(--rs-glass-blur);
      backdrop-filter: var(--rs-glass-blur);
      color: var(--rs-navy);
      transition: border-color var(--rs-dur) var(--rs-ease), box-shadow var(--rs-dur) var(--rs-ease);
    }
    input:focus, select:focus, textarea:focus {
      outline: none;
      border-color: var(--rs-primary);
      box-shadow: var(--rs-focus-ring);
    }
    textarea { min-height: 92px; }
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .form-row { display: flex; flex-direction: column; gap: 4px; }
    .filter-bar { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; align-items: end; margin: 10px 0 12px; }
    .filter-bar .form-row { font-size: 12px; }
    .response-panel { white-space: pre-wrap; max-height: 420px; }
    .api-graphic { max-height: 460px; overflow: auto; }
    code, pre { font-family: var(--rs-font-mono); font-size: 12px; }
    pre {
      overflow: auto;
      padding: 12px;
      border: 1px solid var(--rs-glass-border);
      border-radius: var(--rs-r-md);
      background: var(--rs-glass-strong);
      -webkit-backdrop-filter: var(--rs-glass-blur);
      backdrop-filter: var(--rs-glass-blur);
      box-shadow: var(--rs-glass-sheen);
    }
    a { color: var(--rs-primary); font-weight: 700; }
    details > summary { cursor: pointer; font-weight: 700; color: var(--rs-primary); }

    /* --- Provenienza della risposta mostrata nel panel --- */
    .panel-source {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-top: 10px;
      font-size: 12px;
      color: var(--rs-muted);
    }
    .panel-source code { background: rgba(0, 0, 153, 0.06); padding: 2px 6px; border-radius: 6px; }

    /* --- Skeleton di caricamento --- */
    .skeleton { display: grid; gap: 8px; }
    .skeleton i {
      display: block;
      height: 12px;
      border-radius: 6px;
      background: linear-gradient(90deg, #e8eef5, #f6f9fc, #e8eef5);
      background-size: 200% 100%;
      animation: rs-skeleton 1.1s linear infinite;
    }
    .skeleton i:nth-child(2) { width: 78%; }
    .skeleton i:nth-child(3) { width: 54%; }
    @keyframes rs-skeleton {
      from { background-position: 200% 0; }
      to { background-position: -200% 0; }
    }

    /* --- Toast: la dashboard non aveva NESSUN riscontro sulle azioni --- */
    #toast-host {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 50;
      display: flex;
      flex-direction: column;
      gap: 8px;
      align-items: flex-end;
      pointer-events: none;
    }
    .toast {
      max-width: 360px;
      padding: 10px 14px;
      border: 1px solid var(--rs-glass-border);
      border-left: 4px solid var(--rs-success);
      border-radius: var(--rs-r-sm);
      background: var(--rs-glass-strong);
      -webkit-backdrop-filter: var(--rs-glass-blur);
      backdrop-filter: var(--rs-glass-blur);
      box-shadow: var(--rs-glass-edge), 0 10px 28px rgba(0, 0, 153, 0.22);
      color: var(--rs-navy);
      font-size: 13px;
      font-weight: 700;
      animation: rs-toast-in 220ms var(--rs-ease);
    }
    .toast.err { border-left-color: var(--rs-danger); color: var(--rs-danger); }
    .toast.leaving { animation: rs-toast-out 200ms var(--rs-ease) forwards; }
    @keyframes rs-toast-in {
      from { opacity: 0; transform: translateY(8px) scale(0.98); }
      to { opacity: 1; transform: none; }
    }
    @keyframes rs-toast-out {
      to { opacity: 0; transform: translateY(6px) scale(0.98); }
    }

    /* Fallback: senza backdrop-filter o con trasparenza ridotta, superfici opache. */
    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      .card, pre, .kv, input, select, textarea, .view-toggle button, .toast { background: #fff; }
      header { background: var(--rs-primary); }
    }
    @media (prefers-reduced-transparency: reduce) {
      body { background: var(--rs-soft); }
      .card, pre, .kv, input, select, textarea, .view-toggle button, .toast {
        background: #fff;
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
      }
      .card::before { display: none; }
      header {
        background: var(--rs-primary);
        -webkit-backdrop-filter: none;
        backdrop-filter: none;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .card, button, input, select, textarea, .meter i, .bar i { transition: none !important; }
      .skeleton i, button.is-loading::after, .toast { animation: none !important; }
    }
  </style>
</head>
<body>
  <header>
    <!-- Marchio, schede e utente sulla STESSA riga: le schede erano sotto, su una
         riga propria, e con quattro voci l'intestazione occupava troppa altezza
         verticale prima di arrivare ai dati. -->
    <div class="header-inner">
      <div class="brand">
        <img class="mark" src="${LOGO_MARK}" alt="" aria-hidden="true" />
        <h1>Runway Surfer<small>Control Dashboard</small></h1>
      </div>
      <nav class="tabs" role="tablist" aria-label="Sezioni della dashboard">
        <button type="button" role="tab" id="tab-diagnostica" data-tab="diagnostica" aria-controls="panel-diagnostica" aria-selected="true">Diagnostica</button>
        <button type="button" role="tab" id="tab-feedback" data-tab="feedback" aria-controls="panel-feedback" aria-selected="false">Feedback</button>
        <button type="button" role="tab" id="tab-utenti" data-tab="utenti" aria-controls="panel-utenti" aria-selected="false">Utenti</button>
        <button type="button" role="tab" id="tab-configurazione" data-tab="configurazione" aria-controls="panel-configurazione" aria-selected="false">Configurazione</button>
      </nav>
      <div class="whoami">
        <span>${escapeHtml(auth.user.name || auth.user.external_id)} <span class="role">(${escapeHtml(auth.user.role)})</span></span>
        <button id="logout-btn" type="button">Logout</button>
      </div>
    </div>
  </header>
  <main>
  <div role="tabpanel" id="panel-diagnostica" aria-labelledby="tab-diagnostica">
    <section class="grid">
      <div class="card"><div class="label">Provider</div><div class="value">${data.provider}</div></div>
      <div class="card"><div class="label">AI readiness</div><div class="value ${data.aiReady ? 'ok' : 'warn'}">${readiness}</div></div>
      <div class="card"><div class="label">CORS</div><div class="value">${escapeHtml(data.corsOrigin)}</div></div>
      <div class="card"><div class="label">Egress</div><div class="value">${data.egress}</div></div>
      <div class="card"><div class="label">Requests</div><div class="value">${summary.totals.requests}</div></div>
      <div class="card"><div class="label">Input tokens</div><div class="value">${summary.totals.inputTokens}</div></div>
      <!-- Gli errori non erano mostrati da nessuna parte pur essendo già calcolati
           accanto ai rifiutati: un buco diagnostico, non un riempitivo. -->
      <div class="card"><div class="label">Errori</div><div class="value ${summary.totals.errors > 0 ? 'warn' : ''}">${summary.totals.errors}</div></div>
      <div class="card"><div class="label">Rejected</div><div class="value">${summary.totals.rejected}</div></div>
    </section>
    <section class="split">
      <div class="card">
        <div class="label">Total concurrency</div>
        <div class="value">${metrics.activeRequests}/${settings.max_concurrent_requests}</div>
        <div class="meter"><i style="width:${percent(metrics.activeRequests, settings.max_concurrent_requests)}%"></i></div>
        <div class="sub">Limite per agente: <strong>${settings.max_concurrent_per_agent}</strong></div>
      </div>
      <div class="card">
        <div class="label">Cost guardrail</div>
        <div class="value">€${costEurThisMonth.toFixed(2)} / €${settings.max_monthly_estimated_cost_eur.toFixed(2)}</div>
        <div class="meter"><i style="width:${percent(costEurThisMonth, settings.max_monthly_estimated_cost_eur)}%"></i></div>
        <div class="sub">Spesa stimata del <strong>mese in corso</strong> (UTC) sul budget: è lo stesso numero che blocca le richieste. Oggi: $${costToday.toFixed(4)} · mese: $${costUsdThisMonth.toFixed(4)} · cambio usato: ${USD_PER_EUR} USD/EUR.</div>
      </div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Executable API actions</div>
      <div class="actions-group">
        <div class="actions-label">Stato</div>
        <div class="actions">
          <button type="button" data-get="/health">Health</button>
          <button type="button" data-get="/metrics">Metrics</button>
          <button type="button" data-get="/extension-config">Extension config</button>
          <button type="button" data-get="/requirements">Requirements</button>
        </div>
      </div>
      <div class="actions-group">
        <div class="actions-label">Dati</div>
        <div class="actions">
          <button type="button" data-get="/analytics/summary">Analytics summary</button>
          <button type="button" data-get="/users">Users</button>
          <button type="button" data-get="/teams">Teams</button>
          <button type="button" data-get="/requests?limit=20">Requests</button>
        </div>
      </div>
    </section>
    <!-- Il pannello sta ATTACCATO ai bottoni: prima era ~800px più in basso,
         quindi cliccare un'azione non produceva nessun cambiamento visibile. -->
    <section class="card" style="margin-top:12px">
      <div class="panel-head">
        <div class="label">Response panel</div>
        <div class="view-toggle">
          <button id="view-graphic" type="button" class="active">Vista grafica</button>
          <button id="view-json" type="button">JSON grezzo</button>
        </div>
      </div>
      <div class="panel-source" id="api-source"><span>Nessuna azione eseguita.</span></div>
      <div id="api-graphic" class="api-graphic" aria-live="polite"><span class="empty">Seleziona un'azione qui sopra.</span></div>
      <pre id="api-response" class="response-panel" hidden>Seleziona un'azione qui sopra.</pre>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Control-plane draft</div>
      <p>Questa pagina espone lo stato operativo del proxy. L'accesso è protetto da login
      con sessione; l'estensione si autentica con token Bearer sugli endpoint <code>/ask</code>
      e <code>/extension-config</code>.</p>
      <p><a href="/metrics">Metrics</a> - <a href="/extension-config">Extension config</a></p>
      <p><a href="/dashboard-data">Apri JSON dashboard-data</a> · <a href="/health">Health</a> · <a href="/requirements">Requirements</a></p>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Model distribution</div>
      ${modelBars()}
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Recent requests</div>
      <!-- Filtri inline: prima erano una card separata che scriveva in un
           pannello lontano, duplicando questa stessa tabella. -->
      <form id="request-filter-form" class="filter-bar">
        <label class="form-row">Agent ID<input name="agentId" /></label>
        <label class="form-row">Status<select name="status"><option value="">any</option><option value="ok">ok</option><option value="error">error</option><option value="rejected">rejected</option></select></label>
        <label class="form-row">Model<input name="model" /></label>
        <label class="form-row">Limit<input name="limit" type="number" value="20" /></label>
        <div class="form-row"><button type="submit">Filtra</button></div>
      </form>
      <div class="table-wrap">
        <table><thead><tr><th>Time</th><th>Agent</th><th>Model</th><th>Pages</th><th>Est. in tok</th><th>Real in/out</th><th>Cost</th><th>Status</th></tr></thead><tbody id="recent-body">${recentRows()}</tbody></table>
      </div>
    </section>
  </div>

  <div role="tabpanel" id="panel-feedback" aria-labelledby="tab-feedback" hidden>
    <section class="card">
      <div class="panel-head">
        <div class="label">Feedback degli agenti</div>
        <button id="feedback-refresh" type="button">Aggiorna</button>
      </div>
      <p style="color:var(--rs-muted);font-size:12.5px;margin:8px 0 0">Arriva dal pulsante <strong>Feedback</strong> nella sidebar. I commenti sono già ripuliti dai dati cliente nel browser dell'agente, prima dell'invio.</p>
      <div class="table-wrap" style="margin-top:10px">
        <table><thead><tr><th>Quando</th><th>Agente</th><th>Giudizio</th><th>Domanda</th><th>Commento</th><th>Modello</th></tr></thead><tbody id="feedback-body">${feedbackRows()}</tbody></table>
      </div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Segnalate dal sistema</div>
      <p style="color:var(--rs-muted);font-size:12.5px;margin:8px 0 0">Due categorie: <strong>guasto</strong> (errore del provider, timeout, richiesta respinta da un guardrail) e <strong>senza fonti</strong> — il modello ha risposto senza citare alcun articolo, che è il modo in cui dice di non aver trovato la risposta. La seconda è il segnale più utile per capire quali buchi ha la Knowledge Base.</p>
      <div class="table-wrap" style="margin-top:10px">
        <table><thead><tr><th>Quando</th><th>Agente</th><th>Tipo</th><th>Domanda</th><th>Modello</th><th>Dettaglio</th></tr></thead><tbody id="flagged-body">${flaggedRows()}</tbody></table>
      </div>
    </section>
  </div>

  <div role="tabpanel" id="panel-utenti" aria-labelledby="tab-utenti" hidden>
    <section class="card">
      <div class="label">Utenti (<span id="users-count">${listUsers().length}</span>)</div>
      <div class="table-wrap">
        <table><thead><tr><th>ID</th><th>Username</th><th>Nome</th><th>Email</th><th>Ruolo</th><th>Stato</th><th>Team</th><th>Creato</th></tr></thead><tbody id="users-body">${usersRows()}</tbody></table>
      </div>
    </section>
    <section class="card" style="margin-top:12px">
      <div class="label">Team (<span id="teams-count">${listTeams().length}</span>)</div>
      <div class="table-wrap">
        <table><thead><tr><th>ID</th><th>Nome</th><th>Membri</th><th>Creato</th></tr></thead><tbody id="teams-body">${teamsRows()}</tbody></table>
      </div>
    </section>
    ${
      isAdmin
        ? // Create user a SINISTRA (è il form alto, sette campi), e le due
          // operazioni brevi impilate a destra. Prima "Create team" occupava
          // mezza riga per un campo solo, e "Reset password" stava in un .split a
          // due colonne lasciando l'altra metà vuota.
          `<section class="split">
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
        <p style="font-size:12px;color:var(--rs-muted);margin:10px 0 0">L'utente dovrà cambiare la password temporanea al primo login.
        Gli utenti creati prima dell'introduzione del login non hanno password: usa il reset qui a fianco per abilitarli.</p>
      </div>
      <div class="stack">
        <div class="card">
          <div class="label">Create team</div>
          <form id="team-form" class="form-grid">
            <label class="form-row">Name<input name="name" placeholder="T1 Support" required /></label>
            <div class="form-row"><span>&nbsp;</span><button type="submit">Create team</button></div>
          </form>
        </div>
        <div class="card">
          <div class="label">Reset user password</div>
          <form id="reset-password-form" class="form-grid">
            <label class="form-row">User ID<input name="userId" type="number" min="1" required /></label>
            <label class="form-row">New temporary password<input name="tempPassword" type="password" minlength="8" required autocomplete="new-password" /></label>
            <div class="form-row"><span>&nbsp;</span><button type="submit">Reset password</button></div>
          </form>
          <p style="font-size:12px;color:var(--rs-muted);margin:10px 0 0">Revoca tutte le sessioni attive dell'utente e forza il cambio password al prossimo login.</p>
        </div>
      </div>
    </section>`
        : `<section class="card" style="margin-top:12px">
      <div class="label">Gestione utenti</div>
      <p style="color:var(--rs-muted);font-size:13px;margin:8px 0 0">Creazione utenti, team e reset password sono riservati al ruolo <strong>admin</strong>.</p>
    </section>`
    }
  </div>

  <div role="tabpanel" id="panel-configurazione" aria-labelledby="tab-configurazione" hidden>
    ${
      isAdmin
        ? `<section class="card">
      <div class="label">Guardrail del backend</div>
      <p style="color:var(--rs-muted);font-size:13px;margin:8px 0 0">Questi valori limitano ogni richiesta e sono applicati lato server: l'estensione li riceve da <code>/extension-config</code>.</p>
      <form id="settings-form" class="form-grid" style="margin-top:12px">
        <label class="form-row">Max concurrent<input name="max_concurrent_requests" type="number" value="${settings.max_concurrent_requests}" /></label>
        <label class="form-row">Per agent<input name="max_concurrent_per_agent" type="number" value="${settings.max_concurrent_per_agent}" /></label>
        <label class="form-row">Budget mensile €<input name="max_monthly_estimated_cost_eur" type="number" step="1" min="1" value="${settings.max_monthly_estimated_cost_eur}" /></label>
        <label class="form-row">Richieste/ora per agente<input name="max_requests_per_hour_per_agent" type="number" min="1" value="${settings.max_requests_per_hour_per_agent}" /></label>
        <label class="form-row">Max pages<input name="max_request_pages" type="number" value="${settings.max_request_pages}" /></label>
        <label class="form-row">Max links<input name="max_request_links" type="number" value="${settings.max_request_links}" /></label>
        <label class="form-row">Page chars<input name="max_page_text_chars" type="number" value="${settings.max_page_text_chars}" /></label>
        <label class="form-row">Turni di storico<input name="max_history_turns" type="number" min="0" value="${settings.max_history_turns}" /></label>
        <label class="form-row">Retention days<input name="retention_days" type="number" value="${settings.retention_days}" /></label>
        <div class="form-row"><span>&nbsp;</span><button type="submit">Save settings</button></div>
      </form>
    </section>`
        : ''
    }
    <section class="card" style="margin-top:12px">
      <div class="label">Configurazione dell'estensione</div>
      <p style="color:var(--rs-muted);font-size:13px;margin:8px 0 12px">In sola lettura: è ciò che l'estensione riceve da <code>/extension-config</code>. Deriva dai guardrail qui sopra, quindi si cambia da lì.</p>
      <div class="kv-grid">${extensionConfigCards(data.extension)}</div>
    </section>
    ${
      isAdmin
        ? `<section class="card" style="margin-top:12px">
      <div class="label">Manutenzione</div>
      <p style="color:var(--rs-muted);font-size:13px;margin:8px 0 12px">Elimina dalla history le richieste più vecchie della retention (${settings.retention_days} giorni) e le sessioni scadute.</p>
      <div class="actions"><button type="button" id="prune-btn">Esegui prune</button></div>
    </section>`
        : ''
    }
    <details class="card" style="margin-top:12px">
      <summary>Stato completo (JSON)</summary>
      <pre style="margin-top:10px">${JSON.stringify(data, null, 2)}</pre>
    </details>
  </div>
  </main>
  <div id="toast-host" aria-live="polite" aria-atomic="false"></div>
  <script>
    const out = document.getElementById('api-response');
    const graphic = document.getElementById('api-graphic');
    const sourceLine = document.getElementById('api-source');
    const btnGraphic = document.getElementById('view-graphic');
    const btnJson = document.getElementById('view-json');
    const toastHost = document.getElementById('toast-host');
    let currentView = 'graphic';

    function esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }
    function pill(text, cls) { return '<span class="pill ' + cls + '">' + esc(text) + '</span>'; }
    function statusPill(s) {
      const cls = s === 'active' ? 'ok-bg' : s === 'disabled' ? 'warn-bg' : 'muted-bg';
      return pill(s, cls);
    }

    /** Riscontro visibile per ogni azione: prima non ne esisteva nessuno. */
    function toast(message, kind) {
      const el = document.createElement('div');
      el.className = 'toast' + (kind === 'err' ? ' err' : '');
      el.textContent = message;
      toastHost.appendChild(el);
      setTimeout(() => {
        el.classList.add('leaving');
        el.addEventListener('animationend', () => el.remove());
        // Con reduced-motion l'animazione non parte: rimuovi comunque.
        setTimeout(() => el.remove(), 400);
      }, 3500);
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
    function requestRow(m) {
      return '<tr><td>' + esc(String(m.created_at).slice(11, 19)) + '</td><td>' + esc(m.agent_id) + '</td><td>' + esc(m.model) +
        '</td><td>' + esc(m.pages_count) + '</td><td>' + esc(m.estimated_input_tokens) + '</td><td>' +
        (m.actual_input_tokens != null || m.actual_output_tokens != null
          ? esc((m.actual_input_tokens == null ? '—' : m.actual_input_tokens) + '/' + (m.actual_output_tokens == null ? '—' : m.actual_output_tokens))
          : '—') +
        '</td><td>$' + Number(m.estimated_cost_usd || 0).toFixed(4) + '</td><td>' +
        (m.status === 'ok' ? pill('ok', 'ok-bg') : pill(m.status, 'warn-bg')) + '</td></tr>';
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
      if (body.error) return '<div class="kv" style="border-color:#f2c8c2;background:var(--rs-danger-soft)"><div class="k">Errore</div><div class="v">' + esc(body.error) + '</div></div>';
      if (typeof body.activeRequests === 'number') return metricsView(body);
      return kvCards(body);
    }
    function renderGraphic(value) {
      if (value && typeof value === 'object' && 'status' in value && 'body' in value) {
        return renderBody(value.body);
      }
      return renderBody(value);
    }
    function applyView() {
      const g = currentView === 'graphic';
      graphic.hidden = !g;
      out.hidden = g;
      btnGraphic.classList.toggle('active', g);
      btnJson.classList.toggle('active', !g);
      btnGraphic.setAttribute('aria-pressed', String(g));
      btnJson.setAttribute('aria-pressed', String(!g));
    }
    function show(value) {
      out.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      try { graphic.innerHTML = renderGraphic(value); }
      catch (e) { graphic.innerHTML = '<span class="empty">Impossibile rendere graficamente questa risposta.</span>'; }
    }
    /** Provenienza: quale chiamata, con che esito, in quanto tempo. */
    function showSource(method, path, status, ms) {
      const cls = status == null ? 'muted-bg' : status < 300 ? 'ok-bg' : 'warn-bg';
      const label = status == null ? 'rete' : 'HTTP ' + status;
      sourceLine.innerHTML = '<span>' + esc(method) + '</span><code>' + esc(path) + '</code>' +
        pill(label, cls) + '<span>' + esc(ms) + ' ms</span>';
    }
    function showLoading(method, path) {
      sourceLine.innerHTML = '<span>' + esc(method) + '</span><code>' + esc(path) + '</code><span>in corso...</span>';
      graphic.innerHTML = '<div class="skeleton"><i></i><i></i><i></i></div>';
      out.textContent = 'Richiesta in corso...';
    }
    btnGraphic.addEventListener('click', () => { currentView = 'graphic'; applyView(); });
    btnJson.addEventListener('click', () => { currentView = 'json'; applyView(); });
    applyView();

    /**
     * Unico imbuto per bottoni e form. Rispetto a prima: gestisce l'errore
     * (una fetch fallita lasciava la pagina identica e la promise rejected),
     * mostra lo stato in-flight e blocca il doppio invio.
     */
    async function api(path, options, trigger) {
      const method = (options && options.method) || 'GET';
      if (trigger) {
        if (trigger.disabled) return null;
        trigger.disabled = true;
        trigger.classList.add('is-loading');
      }
      showLoading(method, path);
      const startedAt = Date.now();
      try {
        const res = await fetch(path, options || {});
        const type = res.headers.get('content-type') || '';
        const body = type.includes('application/json') ? await res.json() : await res.text();
        show({ status: res.status, body });
        showSource(method, path, res.status, Date.now() - startedAt);
        if (!res.ok) toast((body && body.error) || (method + ' ' + path + ' → HTTP ' + res.status), 'err');
        return res.ok ? body : null;
      } catch (error) {
        const message = 'Richiesta fallita: ' + String((error && error.message) || error);
        show({ error: message });
        showSource(method, path, null, Date.now() - startedAt);
        toast(message, 'err');
        return null;
      } finally {
        if (trigger) {
          trigger.disabled = false;
          trigger.classList.remove('is-loading');
        }
      }
    }

    const actionButtons = Array.from(document.querySelectorAll('[data-get]'));
    actionButtons.forEach((button) => {
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        // La selezione RESTA dopo la risposta: senza, nulla diceva quale delle
        // otto azioni ha prodotto ciò che si sta guardando.
        actionButtons.forEach((other) => other.setAttribute('aria-pressed', String(other === button)));
        api(button.dataset.get, {}, button);
      });
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
    function jsonBody(payload) {
      return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
    }

    /**
     * Ricarica le tabelle Utenti e Team in loco: prima una create o un reset non
     * aggiornava nulla e i dati sopra restavano stale fino a un reload manuale.
     *
     * Le due liste si ricaricano insieme perché ognuna ha bisogno dell'altra: la
     * colonna Team mostra il NOME (non l'id) e la colonna Membri è un conteggio
     * sugli utenti. Ricaricarne una sola riscriverebbe quelle celle con dati
     * peggiori di quelli renderizzati dal server.
     */
    async function refreshDirectory() {
      try {
        const [usersRes, teamsRes] = await Promise.all([fetch('/users'), fetch('/teams')]);
        if (!usersRes.ok || !teamsRes.ok) return;
        const users = (await usersRes.json()).users || [];
        const teams = (await teamsRes.json()).teams || [];
        const teamName = new Map(teams.map((t) => [t.id, t.name]));
        const members = new Map();
        for (const u of users) {
          if (u.team_id != null) members.set(u.team_id, (members.get(u.team_id) || 0) + 1);
        }

        document.getElementById('users-body').innerHTML = users.length
          ? users.map((u) =>
              '<tr><td>' + esc(u.id) + '</td><td>' + esc(u.external_id) + '</td><td>' + esc(u.name || '') +
              '</td><td>' + esc(u.email || '') + '</td><td>' + pill(u.role, 'role-bg') + '</td><td>' +
              statusPill(u.status) + '</td><td>' +
              (u.team_id == null ? '—' : esc(teamName.get(u.team_id) || ('#' + u.team_id))) +
              '</td><td>' + esc(String(u.created_at).slice(0, 10)) + '</td></tr>').join('')
          : '<tr><td colspan="8">Nessun utente creato</td></tr>';
        document.getElementById('users-count').textContent = String(users.length);

        document.getElementById('teams-body').innerHTML = teams.length
          ? teams.map((t) =>
              '<tr><td>' + esc(t.id) + '</td><td>' + esc(t.name) + '</td><td>' + (members.get(t.id) || 0) +
              '</td><td>' + esc(String(t.created_at).slice(0, 10)) + '</td></tr>').join('')
          : '<tr><td colspan="4">Nessun team creato</td></tr>';
        document.getElementById('teams-count').textContent = String(teams.length);
      } catch (e) { /* le tabelle restano come erano */ }
    }

    /**
     * Ricarica feedback e segnalazioni. Una sola chiamata per entrambe: sono la
     * stessa domanda ("cosa è andato storto?") vista da due lati, e mostrarne una
     * aggiornata accanto a una vecchia sarebbe fuorviante.
     */
    async function refreshFeedback() {
      try {
        const res = await fetch('/feedback?limit=30');
        if (!res.ok) return;
        const body = await res.json();
        const items = body.feedback || [];
        const flagged = body.flagged || [];
        const when = (v) => esc(String(v).slice(0, 16).replace('T', ' '));
        const vote = (r) => r === 'up'
          ? '<span class="pill ok-bg">👍 utile</span>'
          : '<span class="pill warn-bg">👎 non utile</span>';

        document.getElementById('feedback-body').innerHTML = items.length
          ? items.map((f) =>
              '<tr><td>' + when(f.created_at) + '</td><td>' + esc(f.agent_id) + '</td><td>' +
              vote(f.rating) + '</td><td>' + esc(f.query_preview || '—') + '</td><td>' +
              esc(f.comment || '—') + '</td><td>' + esc(f.model || '—') + '</td></tr>').join('')
          : '<tr><td colspan="6">Nessun feedback ancora ricevuto</td></tr>';

        document.getElementById('flagged-body').innerHTML = flagged.length
          ? flagged.map((r) =>
              '<tr><td>' + when(r.created_at) + '</td><td>' + esc(r.agent_id) + '</td><td>' +
              '<span class="pill warn-bg">' + (r.flag === 'guasto' ? 'guasto' : 'senza fonti') + '</span>' +
              '</td><td>' + esc(r.query_preview) + '</td><td>' + esc(r.model) + '</td><td>' +
              esc(r.flag === 'guasto' ? (r.error || r.status) : (r.pages_count + ' pagine lette')) +
              '</td></tr>').join('')
          : '<tr><td colspan="6">Nessuna richiesta segnalata</td></tr>';
      } catch (e) { /* le tabelle restano come erano */ }
    }
    document.getElementById('feedback-refresh')?.addEventListener('click', () => { void refreshFeedback(); });

    /** Submit con stato, toast, reset del form e refresh di ciò che è cambiato. */
    function wireForm(id, handler, options) {
      const form = document.getElementById(id);
      if (!form) return; // i form admin non sono renderizzati per team_lead
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const button = form.querySelector('button[type="submit"]');
        const label = button ? button.textContent : '';
        if (button) { button.disabled = true; button.classList.add('is-loading'); button.textContent = 'Attendi...'; }
        try {
          const result = await handler(formDataObject(form));
          if (result) {
            toast((options && options.success) || 'Fatto.');
            if (options && options.reset) form.reset();
            if (options && options.after) await options.after();
          }
        } finally {
          if (button) { button.disabled = false; button.classList.remove('is-loading'); button.textContent = label; }
        }
      });
    }

    document.getElementById('logout-btn').addEventListener('click', async () => {
      await fetch('/auth/logout', { method: 'POST' });
      location.href = '/login';
    });

    // --- Schede ---------------------------------------------------------------
    // La scheda attiva vive nell'hash, così è linkabile e sopravvive al reload.
    const tabButtons = Array.from(document.querySelectorAll('[role="tab"]'));
    function selectTab(name, updateHash) {
      const match = tabButtons.find((b) => b.dataset.tab === name) || tabButtons[0];
      for (const button of tabButtons) {
        const active = button === match;
        button.setAttribute('aria-selected', String(active));
        const panel = document.getElementById(button.getAttribute('aria-controls'));
        if (panel) panel.hidden = !active;
      }
      if (updateHash) history.replaceState(null, '', '#' + match.dataset.tab);
    }
    for (const button of tabButtons) {
      button.addEventListener('click', () => selectTab(button.dataset.tab, true));
    }
    window.addEventListener('hashchange', () => selectTab(location.hash.slice(1), false));
    selectTab(location.hash.slice(1), false);

    // Prune: azione admin che finora non aveva alcuna interfaccia.
    document.getElementById('prune-btn')?.addEventListener('click', async (event) => {
      const result = await api('/maintenance/prune', { method: 'POST' }, event.currentTarget);
      if (result) toast('Prune eseguito.');
    });

    wireForm('team-form', (data) => api('/teams', jsonBody(data)), {
      success: 'Team creato.', reset: true, after: refreshDirectory,
    });
    wireForm('user-form', (data) => api('/users', jsonBody(data)), {
      success: 'Utente creato.', reset: true, after: refreshDirectory,
    });
    wireForm('reset-password-form', (data) =>
      api('/users/' + Number(data.userId) + '/reset-password', jsonBody({ tempPassword: data.tempPassword })), {
      success: 'Password resettata: l’utente la cambierà al prossimo login.', reset: true, after: refreshDirectory,
    });
    wireForm('settings-form', (data) =>
      api('/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }), {
      success: 'Settings salvati.',
    });

    // I filtri riscrivono la tabella Recent requests qui sopra, non un pannello
    // altrove: è la stessa lista, non due viste dello stesso dato.
    document.getElementById('request-filter-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.target;
      const button = form.querySelector('button[type="submit"]');
      const params = new URLSearchParams(formDataObject(form));
      if (button) { button.disabled = true; button.classList.add('is-loading'); }
      try {
        const res = await fetch('/requests?' + params.toString());
        const data = await res.json();
        if (!res.ok) { toast((data && data.error) || ('HTTP ' + res.status), 'err'); return; }
        const rows = Array.isArray(data.requests) ? data.requests : [];
        document.getElementById('recent-body').innerHTML =
          rows.length ? rows.map(requestRow).join('') : '<tr><td colspan="8">Nessuna richiesta per questo filtro</td></tr>';
        toast(rows.length === 1 ? '1 richiesta trovata.' : rows.length + ' richieste trovate.');
      } catch (error) {
        toast('Filtro fallito: ' + String((error && error.message) || error), 'err');
      } finally {
        if (button) { button.disabled = false; button.classList.remove('is-loading'); }
      }
    });
  </script>
</body>
</html>`;
}
