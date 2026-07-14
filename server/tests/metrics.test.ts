// Ciclo del contatore richieste attive: beginActive/endActive devono bilanciarsi
// e recordMetric NON deve più toccare il contatore (altrimenti doppio decremento
// / leak → 429 per tutti). Vedi fix Bug 4.
import { beforeEach, describe, expect, it } from 'vitest';
import { metrics, beginActive, endActive, recordMetric } from '../src/metrics.js';

function baseMetric(agentId: string) {
  return {
    id: 'r1',
    at: new Date(0).toISOString(),
    agentId,
    provider: 'mock',
    model: 'm',
    pages: 1,
    links: 0,
    inputTokens: 10,
    outputTokens: 5,
    estimatedCostUsd: 0,
    ms: 1,
    ok: true,
  };
}

describe('contatore richieste attive', () => {
  beforeEach(() => {
    metrics.activeRequests = 0;
    metrics.activeByAgent = {};
  });

  it('beginActive/endActive si bilanciano', () => {
    beginActive('a');
    beginActive('a');
    expect(metrics.activeRequests).toBe(2);
    expect(metrics.activeByAgent['a']).toBe(2);
    endActive('a');
    endActive('a');
    expect(metrics.activeRequests).toBe(0);
    expect(metrics.activeByAgent['a']).toBe(0);
  });

  it('endActive non scende mai sotto zero', () => {
    endActive('a');
    expect(metrics.activeRequests).toBe(0);
    expect(metrics.activeByAgent['a']).toBe(0);
  });

  it('recordMetric NON decrementa il contatore attivo (solo endActive lo fa)', () => {
    beginActive('a');
    recordMetric(baseMetric('a'));
    // Ancora attivo: solo endActive rilascia il conteggio.
    expect(metrics.activeRequests).toBe(1);
    expect(metrics.activeByAgent['a']).toBe(1);
    endActive('a');
    expect(metrics.activeRequests).toBe(0);
  });
});
