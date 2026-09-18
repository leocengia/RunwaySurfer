// Snapshot di stato del proxy: la config pubblicata all'estensione e il
// payload completo della dashboard (usato da /dashboard-data e dalla pagina HTML).
import { getProvider, egressFor, ASSUMED_OUTPUT_TOKENS } from './provider/index.js';
import {
  analyticsSummary,
  estimatedCostMonthToDate,
  estimatedCostToday,
  getSettings,
  DB_PATH,
} from './db.js';
import { RELEASE } from './release.js';
import { estimatedCostEurThisMonth, metrics } from './metrics.js';
import {
  PORT,
  ALLOWED_ORIGIN,
  MODEL_REGISTRY,
  USD_PER_EUR,
  PUBLIC_SCHEME,
  SERVER,
  TLS_ENABLED,
} from './config.js';
import { assessCertificate, getActiveTlsMaterial } from './tls.js';

/**
 * Stato del certificato servito, per la dashboard.
 *
 * Il failure mode di questa funzionalità è un rinnovo automatico che si è
 * fermato in silenzio: il servizio funziona per settimane e poi si spegne per
 * tutti insieme il giorno della scadenza. La dashboard è l'unico posto dove
 * qualcuno guarda, quindi il conto dei giorni va lì.
 */
function tlsStatus() {
  const material = getActiveTlsMaterial();
  if (!TLS_ENABLED || !material) {
    return { enabled: false as const };
  }
  const health = assessCertificate(material, new Date(), SERVER.tls?.expiryWarnDays ?? 21);
  return {
    enabled: true as const,
    subject: material.subject,
    subjectAltName: material.subjectAltName ?? null,
    validFrom: material.validFrom.toISOString(),
    validTo: material.validTo.toISOString(),
    fingerprint256: material.fingerprint256,
    daysToExpiry: health.daysToExpiry,
    state: health.state,
  };
}

export function extensionConfig() {
  const settings = getSettings();
  return {
    version: 1,
    defaultMode: 'visual',
    maxFollowLinks: 3,
    maxPromptLinks: settings.max_request_links,
    maxPagesPerAsk: settings.max_request_pages,
    maxPageTextChars: settings.max_page_text_chars,
    maxConcurrentRequests: settings.max_concurrent_requests,
    maxConcurrentPerAgent: settings.max_concurrent_per_agent,
    maxMonthlyEstimatedCostEur: settings.max_monthly_estimated_cost_eur,
    provider: getProvider().name,
    features: {
      visualTour: true,
      backgroundFollow: true,
      sidebarResize: true,
      dashboard: true,
    },
  };
}

export function dashboardData() {
  const provider = getProvider();
  const anthropicKeyConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  const openrouterKeyConfigured = Boolean(process.env.OPENROUTER_API_KEY);
  const settings = getSettings();
  const history = analyticsSummary();
  return {
    service: 'Runway Surfer proxy',
    status: 'ok',
    // Identità della build. Autenticato, quindi qui ci va tutto: è la risposta a
    // «quale versione sta girando?» dopo un aggiornamento.
    build: {
      version: RELEASE.version,
      commit: RELEASE.shortCommit,
      fullCommit: RELEASE.commit,
      release: RELEASE.id,
      builtAt: RELEASE.builtAt,
      schemaVersion: RELEASE.schemaVersion,
      node: RELEASE.nodeVersion,
      dbPath: DB_PATH,
      startedAt: RELEASE.startedAt,
      uptimeSeconds: Math.round(process.uptime()),
    },
    provider: provider.name,
    aiReady:
      provider.name === 'mock' ||
      (provider.name === 'anthropic' && anthropicKeyConfigured) ||
      (provider.name === 'openrouter' && openrouterKeyConfigured),
    aiProviderConfigured: provider.name,
    anthropicKeyConfigured,
    openrouterKeyConfigured,
    port: PORT,
    scheme: PUBLIC_SCHEME,
    tls: tlsStatus(),
    corsOrigin: ALLOWED_ORIGIN,
    egress: egressFor(provider.name),
    extension: {
      ...extensionConfig(),
      supportedModes: ['visual', 'follow', 'single'],
      localProxyDefault: `${PUBLIC_SCHEME}://localhost:${PORT}`,
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
      maxRequestsPerHourPerAgent: settings.max_requests_per_hour_per_agent,
      activeRequests: metrics.activeRequests,
      activeByAgent: metrics.activeByAgent,
      rejectedRequests: metrics.rejectedRequests,
      maxMonthlyEstimatedCostEur: settings.max_monthly_estimated_cost_eur,
      // Il valore APPLICATO dal guardrail: da SQLite, quindi sopravvive ai
      // riavvii. `metrics.totalEstimatedCostUsd` è invece solo il cumulato
      // dall'ultimo avvio del processo, utile come metrica live e nient'altro.
      estimatedCostEurThisMonth: estimatedCostEurThisMonth(),
      estimatedCostUsdThisMonth: estimatedCostMonthToDate(),
      estimatedCostTodayUsd: estimatedCostToday(),
      usdPerEur: USD_PER_EUR,
    },
    settings,
    metrics,
    history,
    modelRegistry: MODEL_REGISTRY,
    nextControlPlaneSteps: [
      'Persist per-request usage metrics in SQLite/Postgres for dashboard charts.',
      'Let the extension poll /extension-config at startup.',
      'Add audit logs for model, token estimate, cost estimate and selected links.',
    ],
  };
}
