// Metriche live in memoria (si azzerano al riavvio — lo storico persistente è
// nella tabella `requests` di SQLite) + guardrail di concorrenza/costo.
import type { SettingsRecord } from './db.js';
import { RECENT_REQUEST_LIMIT } from './config.js';

export interface RequestMetric {
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

export const metrics = {
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

export function recordMetric(metric: RequestMetric): void {
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

export function canAcceptRequest(
  agentId: string,
  settings: SettingsRecord,
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
