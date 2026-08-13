// Guardrail di spesa e rate limiting.
//
// Il guardrail di spesa era rotto in due modi insieme: applicava un contatore in
// memoria azzerato a ogni riavvio, mentre la dashboard mostrava il totale di
// sempre da SQLite. Due numeri diversi, nessuno dei due "oggi": con un provider
// a pagamento si blocca tutti per sempre o non scatta mai. Questi test fissano
// la fonte unica (`estimatedCostToday`) e il confine di giornata.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  estimatedCostToday,
  getSettings,
  initDb,
  insertRequestHistory,
  startOfTodayIso,
  updateSettings,
  type RequestHistoryInput,
} from '../src/db.js';
import {
  canAcceptRequest,
  metrics,
  noteRequestForRateLimit,
  requestsInWindow,
  resetRateLimiter,
} from '../src/metrics.js';

const AGENT = 'agente@example.com';
const HOUR_MS = 60 * 60 * 1000;

let seq = 0;
function request(costUsd: number, overrides: Partial<RequestHistoryInput> = {}): void {
  seq += 1;
  insertRequestHistory({
    id: `req-${seq}`,
    userId: null,
    agentId: AGENT,
    teamId: null,
    query: 'domanda',
    provider: 'mock',
    model: 'claude-haiku-4-5',
    pagesCount: 1,
    linksCount: 0,
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    estimatedCostUsd: costUsd,
    durationMs: 10,
    status: 'ok',
    selectedLinks: [],
    sources: [],
    ...overrides,
  });
}

beforeEach(() => {
  initDb();
  resetRateLimiter();
  metrics.activeRequests = 0;
  metrics.activeByAgent = {};
  updateSettings({
    max_concurrent_requests: 30,
    max_concurrent_per_agent: 2,
    max_daily_estimated_cost_usd: 50,
    max_requests_per_hour_per_agent: 30,
  });
});

describe('estimatedCostToday', () => {
  it('somma le richieste di oggi', () => {
    const before = estimatedCostToday();
    request(0.05);
    request(0.03);
    expect(estimatedCostToday() - before).toBeCloseTo(0.08, 6);
  });

  it('NON conta i giorni precedenti', () => {
    request(1.5);
    // Guardato da domani, tutto ciò che è stato inserito ora è "ieri". È il
    // confine che rende il tetto giornaliero e non cumulativo: senza, dopo
    // qualche settimana il budget di un giorno bloccherebbe tutti per sempre.
    const tomorrow = new Date(Date.now() + 24 * HOUR_MS);
    expect(estimatedCostToday(tomorrow)).toBe(0);
  });

  it('una richiesta respinta non muove il numero', () => {
    // Le richieste `rejected` hanno costo 0 e non devono contribuire al tetto:
    // altrimenti il primo 429 renderebbe più probabile il successivo.
    // (Il DB è condiviso fra i test di questo file: si misura la differenza.)
    const before = estimatedCostToday();
    request(0, { status: 'rejected', error: 'backend busy' });
    expect(estimatedCostToday()).toBeCloseTo(before, 6);
  });

  it('il confine di giornata è mezzanotte UTC', () => {
    const iso = startOfTodayIso(new Date('2026-08-12T15:30:00.000Z'));
    expect(iso).toBe('2026-08-12T00:00:00.000Z');
  });
});

describe('canAcceptRequest · tetto di spesa', () => {
  it('accetta sotto soglia', () => {
    request(1);
    expect(canAcceptRequest(AGENT, getSettings())).toEqual({ ok: true });
  });

  it('respinge con 429 quando la spesa di oggi ha raggiunto il tetto', () => {
    updateSettings({ max_daily_estimated_cost_usd: 0.1 });
    request(0.15);
    const verdict = canAcceptRequest(AGENT, getSettings());
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.status).toBe(429);
    expect(!verdict.ok && verdict.message).toMatch(/today/);
  });

  it('il blocco SOPRAVVIVE al riavvio del processo', () => {
    // Simula il riavvio: le metriche in memoria si azzerano, SQLite no. Prima il
    // guardrail leggeva solo il contatore in RAM, quindi un riavvio sbloccava
    // tutto e il tetto giornaliero era aggirabile con un restart.
    updateSettings({ max_daily_estimated_cost_usd: 0.1 });
    request(0.15);
    metrics.totalEstimatedCostUsd = 0;
    expect(canAcceptRequest(AGENT, getSettings()).ok).toBe(false);
  });

  it('non si basa sul contatore in memoria', () => {
    // Contatore gonfio ma nessuna richiesta a DB: non deve bloccare nessuno.
    metrics.totalEstimatedCostUsd = 9999;
    expect(canAcceptRequest(AGENT, getSettings())).toEqual({ ok: true });
  });
});

describe('canAcceptRequest · rate limiting per agente', () => {
  it('conta solo le richieste registrate', () => {
    expect(requestsInWindow(AGENT)).toBe(0);
    noteRequestForRateLimit(AGENT);
    noteRequestForRateLimit(AGENT);
    expect(requestsInWindow(AGENT)).toBe(2);
  });

  it('scatta al raggiungimento del tetto', () => {
    updateSettings({ max_requests_per_hour_per_agent: 2 });
    noteRequestForRateLimit(AGENT);
    expect(canAcceptRequest(AGENT, getSettings()).ok).toBe(true);
    noteRequestForRateLimit(AGENT);
    const verdict = canAcceptRequest(AGENT, getSettings());
    expect(verdict.ok).toBe(false);
    expect(!verdict.ok && verdict.status).toBe(429);
    expect(!verdict.ok && verdict.message).toMatch(/rate limit/i);
  });

  it('non punisce gli altri agenti', () => {
    updateSettings({ max_requests_per_hour_per_agent: 1 });
    noteRequestForRateLimit(AGENT);
    expect(canAcceptRequest(AGENT, getSettings()).ok).toBe(false);
    expect(canAcceptRequest('altro@example.com', getSettings()).ok).toBe(true);
  });

  it('si rilascia quando la finestra scorre', () => {
    updateSettings({ max_requests_per_hour_per_agent: 1 });
    const now = Date.now();
    noteRequestForRateLimit(AGENT, now);
    expect(canAcceptRequest(AGENT, getSettings()).ok).toBe(false);
    // Un'ora e un minuto dopo la finestra è vuota. `requestsInWindow` con un
    // istante futuro pota la finestra: è il modo di far scorrere il tempo senza
    // aspettarlo davvero.
    expect(requestsInWindow(AGENT, now + HOUR_MS + 60_000)).toBe(0);
    expect(canAcceptRequest(AGENT, getSettings()).ok).toBe(true);
  });

  it('la finestra tiene solo gli istanti recenti', () => {
    const now = Date.now();
    noteRequestForRateLimit(AGENT, now - 2 * HOUR_MS);
    noteRequestForRateLimit(AGENT, now);
    expect(requestsInWindow(AGENT, now)).toBe(1);
  });
});

describe('canAcceptRequest · concorrenza (regressione)', () => {
  it('respinge oltre il limite globale', () => {
    updateSettings({ max_concurrent_requests: 1 });
    metrics.activeRequests = 1;
    const verdict = canAcceptRequest(AGENT, getSettings());
    expect(!verdict.ok && verdict.message).toMatch(/backend busy/);
  });

  it('respinge oltre il limite per agente', () => {
    updateSettings({ max_concurrent_per_agent: 1 });
    metrics.activeByAgent[AGENT] = 1;
    const verdict = canAcceptRequest(AGENT, getSettings());
    expect(!verdict.ok && verdict.message).toMatch(/agent busy/);
  });
});
