// Metriche live in memoria (si azzerano al riavvio — lo storico persistente è
// nella tabella `requests` di SQLite) + guardrail di concorrenza/costo.
import { estimatedCostMonthToDate, type SettingsRecord } from './db.js';
import { RECENT_REQUEST_LIMIT, USD_PER_EUR } from './config.js';

/** Finestra del rate limiting per agente. */
const RATE_WINDOW_MS = 60 * 60 * 1000;

/**
 * Istanti (epoch ms) delle richieste accettate, per agente. Finestra scorrevole
 * in memoria: al riavvio si perde, ed è accettabile — il tetto per ora serve a
 * fermare un ciclo impazzito, mentre il tetto di spesa (quello che protegge il
 * budget) vive su SQLite proprio per sopravvivere ai riavvii.
 */
const requestTimes = new Map<string, number[]>();

/** Registra una richiesta accettata nella finestra dell'agente. */
export function noteRequestForRateLimit(agentId: string, now = Date.now()): void {
  const times = requestTimes.get(agentId) ?? [];
  times.push(now);
  requestTimes.set(agentId, prune(times, now));
}

function prune(times: number[], now: number): number[] {
  const cutoff = now - RATE_WINDOW_MS;
  // Gli istanti sono in ordine crescente: basta tagliare la testa.
  let i = 0;
  while (i < times.length && times[i] < cutoff) i += 1;
  return i > 0 ? times.slice(i) : times;
}

/** Quante richieste ha fatto l'agente nell'ultima ora. Esportata per i test. */
export function requestsInWindow(agentId: string, now = Date.now()): number {
  const times = prune(requestTimes.get(agentId) ?? [], now);
  requestTimes.set(agentId, times);
  return times.length;
}

/** Azzera le finestre. Serve ai test, che non devono influenzarsi a vicenda. */
export function resetRateLimiter(): void {
  requestTimes.clear();
}

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
  /**
   * Cumulato DALL'ULTIMO AVVIO: è una metrica live e nulla più. Il guardrail di
   * spesa usa estimatedCostMonthToDate() da SQLite — vedi canAcceptRequest. Non
   * rimetterlo a fare da tetto: si azzera a ogni riavvio.
   */
  totalEstimatedCostUsd: 0,
  byModel: {} as Record<string, number>,
  byAgent: {} as Record<string, { requests: number; failures: number; estimatedCostUsd: number }>,
  activeByAgent: {} as Record<string, number>,
  rejectedRequests: 0,
  recent: [] as RequestMetric[],
};

/**
 * Mark a request as in-flight. Pair with endActive() in a try/finally so the
 * live counter is always balanced — otherwise a throw during /ask setup would
 * leak it and eventually trip the concurrency guardrail (429 for everyone).
 */
export function beginActive(agentId: string): void {
  metrics.activeRequests += 1;
  metrics.activeByAgent[agentId] = (metrics.activeByAgent[agentId] ?? 0) + 1;
}

/** Release an in-flight request. Idempotent-safe (never goes below 0). */
export function endActive(agentId: string): void {
  metrics.activeRequests = Math.max(0, metrics.activeRequests - 1);
  metrics.activeByAgent[agentId] = Math.max(0, (metrics.activeByAgent[agentId] ?? 0) - 1);
}

export function recordMetric(metric: RequestMetric): void {
  metrics.totalRequests += 1;
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
  const perHour = requestsInWindow(agentId);
  if (perHour >= settings.max_requests_per_hour_per_agent) {
    return {
      ok: false,
      status: 429,
      message: `rate limit reached: max ${settings.max_requests_per_hour_per_agent} requests per hour per agent (riprova più tardi)`,
    };
  }
  // Il tetto di spesa si legge da SQLite, non dal contatore in memoria: così
  // copre davvero il mese in corso e sopravvive ai riavvii del servizio.
  // La spesa è in USD (listino del modello), il budget in euro: si converte qui.
  if (estimatedCostEurThisMonth() >= settings.max_monthly_estimated_cost_eur) {
    return {
      ok: false,
      status: 429,
      message: `estimated cost guardrail reached: €${settings.max_monthly_estimated_cost_eur.toFixed(2)} this month`,
    };
  }
  return { ok: true };
}

/**
 * Spesa stimata del mese in corso convertita in euro — la grandezza che il
 * guardrail confronta col budget e che la dashboard mostra. Esportata perché i
 * due DEVONO usare la stessa: prima divergevano e nessuno se ne accorgeva.
 */
export function estimatedCostEurThisMonth(now = new Date()): number {
  return estimatedCostMonthToDate(now) / USD_PER_EUR;
}
