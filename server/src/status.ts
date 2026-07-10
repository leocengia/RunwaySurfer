// Snapshot di stato del proxy: la config pubblicata all'estensione e il
// payload completo della dashboard (usato da /dashboard-data e dalla pagina HTML).
import { MODELS } from './router.js';
import { getProvider, ANTHROPIC_EGRESS, ASSUMED_OUTPUT_TOKENS } from './provider/index.js';
import { analyticsSummary, getSettings } from './db.js';
import { metrics } from './metrics.js';
import { PORT, ALLOWED_ORIGIN } from './config.js';

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

export function dashboardData() {
  const provider = getProvider();
  const anthropicKeyConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
  const settings = getSettings();
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
