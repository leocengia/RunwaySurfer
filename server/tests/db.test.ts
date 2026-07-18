import { beforeAll, describe, expect, it } from 'vitest';
import {
  createTeam,
  createUser,
  deleteExpiredSessions,
  getSessionWithUser,
  getSettings,
  getUserByExternalId,
  initDb,
  insertRequestHistory,
  insertSession,
  listRequests,
  pruneOldRequests,
  sanitizeUser,
  setUserPassword,
  updateSettings,
  type RequestHistoryInput,
} from '../src/db.js';

beforeAll(() => {
  initDb();
});

function historyInput(overrides: Partial<RequestHistoryInput> = {}): RequestHistoryInput {
  return {
    id: `req-${Math.random().toString(36).slice(2)}`,
    userId: null,
    agentId: 'agente-1',
    teamId: null,
    query: 'come cambio indirizzo di consegna?',
    provider: 'mock',
    model: 'claude-haiku-4-5',
    pagesCount: 1,
    linksCount: 0,
    estimatedInputTokens: 100,
    estimatedOutputTokens: 500,
    estimatedCostUsd: 0.001,
    durationMs: 10,
    status: 'ok',
    selectedLinks: [],
    sources: [],
    ...overrides,
  };
}

describe('utenti', () => {
  it('crea e rilegge un utente; sanitizeUser rimuove il password_hash', () => {
    const user = createUser({ externalId: 'mario@example.com', name: 'Mario', role: 'agent' });
    const found = getUserByExternalId('mario@example.com');
    expect(found?.id).toBe(user.id);
    const safe = sanitizeUser(user) as Record<string, unknown>;
    expect('password_hash' in safe).toBe(false);
  });

  it('setUserPassword aggiorna hash e flag di cambio obbligatorio', () => {
    const user = createUser({ externalId: 'anna@example.com' });
    const updated = setUserPassword(user.id, 'scrypt$fake', true);
    expect(updated?.password_hash).toBe('scrypt$fake');
    expect(updated?.must_change_password).toBe(1);
    expect(setUserPassword(999999, 'x', false)).toBeNull();
  });
});

describe('settings', () => {
  it('espone i default e applica solo patch numeriche di chiavi note', () => {
    const before = getSettings();
    expect(before.retention_days).toBeGreaterThan(0);
    const after = updateSettings({
      max_request_pages: 7,
      // @ts-expect-error chiave non ammessa: deve essere ignorata
      chiave_ignota: 42,
      max_request_links: Number.NaN,
    });
    expect(after.max_request_pages).toBe(7);
    expect(after.max_request_links).toBe(before.max_request_links);
    expect('chiave_ignota' in after).toBe(false);
  });
});

describe('storico richieste', () => {
  it('inserisce e filtra per agente/status con limit', () => {
    insertRequestHistory(historyInput({ agentId: 'filtro-a', status: 'ok' }));
    insertRequestHistory(historyInput({ agentId: 'filtro-a', status: 'error', error: 'boom' }));
    insertRequestHistory(historyInput({ agentId: 'filtro-b', status: 'ok' }));
    const perAgente = listRequests({ agentId: 'filtro-a' });
    expect(perAgente).toHaveLength(2);
    const errori = listRequests({ agentId: 'filtro-a', status: 'error' });
    expect(errori).toHaveLength(1);
    expect(errori[0].error).toBe('boom');
  });

  it('persiste i token reali quando forniti e li lascia null altrimenti', () => {
    insertRequestHistory(
      historyInput({
        id: 'req-actual',
        agentId: 'actual-test',
        actualInputTokens: 1234,
        actualOutputTokens: 567,
      }),
    );
    insertRequestHistory(historyInput({ id: 'req-solo-stima', agentId: 'stima-test' }));
    const [conReali] = listRequests({ agentId: 'actual-test' });
    expect(conReali.actual_input_tokens).toBe(1234);
    expect(conReali.actual_output_tokens).toBe(567);
    // Senza usage dal provider (es. mock) le colonne reali restano NULL: si vede
    // subito stima-vs-reale senza confonderle.
    const [soloStima] = listRequests({ agentId: 'stima-test' });
    expect(soloStima.actual_input_tokens).toBeNull();
    expect(soloStima.actual_output_tokens).toBeNull();
  });

  it('salva hash e preview della query, non il testo completo oltre il limite', () => {
    const query = 'q '.repeat(400);
    insertRequestHistory(historyInput({ id: 'req-preview', query }));
    const [row] = listRequests({ limit: 1 });
    expect(row.query_hash).toHaveLength(64);
    expect(row.query_preview.length).toBeLessThanOrEqual(240);
  });

  it('pruneOldRequests elimina solo le righe oltre la retention', async () => {
    insertRequestHistory(historyInput({ agentId: 'prune-test' }));
    expect(pruneOldRequests(365)).toBe(0);
    // Il cutoff è "adesso - retention": con retention 0 serve che l'insert
    // sia strettamente nel passato.
    await new Promise((resolve) => setTimeout(resolve, 10));
    const deleted = pruneOldRequests(0);
    expect(deleted).toBeGreaterThan(0);
    expect(listRequests({ agentId: 'prune-test' })).toHaveLength(0);
  });
});

describe('sessioni', () => {
  it('deleteExpiredSessions rimuove solo le sessioni scadute', () => {
    const user = createUser({ externalId: `sess-${Date.now()}@example.com` });
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    insertSession('hash-scaduta', user.id, 'bearer', past);
    insertSession('hash-valida', user.id, 'bearer', future);
    expect(deleteExpiredSessions()).toBeGreaterThanOrEqual(1);
    expect(getSessionWithUser('hash-scaduta')).toBeNull();
    expect(getSessionWithUser('hash-valida')?.user.id).toBe(user.id);
  });
});

describe('team', () => {
  it('crea un team con nome trimmato', () => {
    const team = createTeam('  T1 Support  ');
    expect(team.name).toBe('T1 Support');
  });
});
