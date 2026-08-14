// Feedback degli agenti e segnalazioni automatiche.
//
// Il conteggio delle fonti citate esiste perché il dato NON era ricavabile:
// `requests.sources_json` contiene le pagine FORNITE al modello, non quelle che ha
// citato, e il server non conserva il testo della risposta. Da qui il conteggio al
// volo e la colonna `cited_sources`, che è ciò su cui poggia il flag «senza fonti».
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { countCitedSources } from '../src/outcome-audit.js';
import {
  createUser,
  initDb,
  insertFeedback,
  insertRequestHistory,
  listFeedback,
  listFlaggedRequests,
  type RequestHistoryInput,
} from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const app = createApp();
const A = 'https://kb.example.com/s/article/Rimborso';
const B = 'https://kb.example.com/s/article/Cambio-nome';

let seq = 0;
function persist(overrides: Partial<RequestHistoryInput> = {}): string {
  seq += 1;
  const id = `req-fb-${seq}`;
  insertRequestHistory({
    id,
    userId: null,
    agentId: 'agente@test',
    teamId: null,
    query: 'domanda',
    provider: 'mock',
    model: 'claude-haiku-4-5',
    pagesCount: 2,
    linksCount: 0,
    estimatedInputTokens: 100,
    estimatedOutputTokens: 50,
    estimatedCostUsd: 0.01,
    durationMs: 10,
    status: 'ok',
    selectedLinks: [],
    sources: [],
    ...overrides,
  });
  return id;
}

describe('countCitedSources', () => {
  it('conta le fonti citate nella sezione dedicata', () => {
    const answer = `## Procedura\npassi\n## Fonti\n- Rimborso: ${A}\n- Cambio nome: ${B}`;
    expect(countCitedSources(answer)).toBe(2);
  });

  it('ritorna 0 quando il modello non cita nulla — è il «non l’ho trovato»', () => {
    const answer = "## Procedura\nL'informazione non è presente nelle pagine fornite.\n## Fonti\n";
    expect(countCitedSources(answer)).toBe(0);
  });

  it('ritorna 0 se manca del tutto la sezione Fonti', () => {
    expect(countCitedSources('## Procedura\nqualcosa')).toBe(0);
  });

  it('NON conta gli URL fuori dalla sezione Fonti', () => {
    // Un URL citato dentro la procedura non è una fonte dichiarata.
    expect(countCitedSources(`## Procedura\nvedi ${A}\n## Fonti\n`)).toBe(0);
  });

  it('si ferma alla sezione successiva', () => {
    const answer = `## Fonti\n- ${A}\n## Note\n- altro: ${B}`;
    expect(countCitedSources(answer)).toBe(1);
  });

  it('deduplica: lo stesso articolo due volte è una fonte', () => {
    expect(countCitedSources(`## Fonti\n- Titolo: ${A}\n- Ancora: ${A}`)).toBe(1);
  });

  it('ripulisce la punteggiatura finale', () => {
    expect(countCitedSources(`## Fonti\n- Titolo: ${A}.`)).toBe(1);
  });

  it('tollera una risposta vuota', () => {
    expect(countCitedSources('')).toBe(0);
  });
});

describe('listFlaggedRequests', () => {
  beforeEach(() => {
    initDb();
  });

  it('segnala una risposta riuscita SENZA fonti citate', () => {
    const id = persist({ status: 'ok', citedSources: 0 });
    const flagged = listFlaggedRequests({ limit: 100 });
    const found = flagged.find((r) => r.id === id);
    expect(found?.flag).toBe('nofonti');
  });

  it('NON segnala una risposta che ha citato le fonti', () => {
    const id = persist({ status: 'ok', citedSources: 2 });
    expect(listFlaggedRequests({ limit: 100 }).some((r) => r.id === id)).toBe(false);
  });

  it('segnala errori e richieste respinte come guasto', () => {
    const errored = persist({ status: 'error', error: 'provider giù' });
    const rejected = persist({ status: 'rejected', error: 'rate limit' });
    const flagged = listFlaggedRequests({ limit: 100 });
    expect(flagged.find((r) => r.id === errored)?.flag).toBe('guasto');
    expect(flagged.find((r) => r.id === rejected)?.flag).toBe('guasto');
  });

  it('NON segnala le righe storiche con cited_sources NULL', () => {
    // Le richieste archiviate prima che la colonna esistesse non sono
    // segnalazioni: NULL significa "non misurato", non "zero fonti".
    const id = persist({ status: 'ok', citedSources: null });
    expect(listFlaggedRequests({ limit: 100 }).some((r) => r.id === id)).toBe(false);
  });

  it('ignora le chiamate di rerank', () => {
    const id = persist({ kind: 'rank', status: 'ok', citedSources: 0 });
    expect(listFlaggedRequests({ limit: 100 }).some((r) => r.id === id)).toBe(false);
  });
});

describe('POST /feedback', () => {
  let agentToken = '';

  beforeEach(async () => {
    initDb();
    if (agentToken) return;
    createUser({
      externalId: 'fb-agente@test',
      role: 'agent',
      status: 'active',
      passwordHash: await hashPassword('password-agente'),
    });
    createUser({
      externalId: 'fb-lead@test',
      role: 'team_lead',
      status: 'active',
      passwordHash: await hashPassword('password-lead'),
    });
    const login = async (username: string, password: string) => {
      const res = await request(app)
        .post('/auth/login')
        .send({ username, password, client: 'extension' })
        .expect(200);
      return res.body.token as string;
    };
    agentToken = await login('fb-agente@test', 'password-agente');
  });

  it('registra un giudizio con commento', async () => {
    const requestId = persist();
    await request(app)
      .post('/feedback')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ rating: 'down', requestId, comment: 'la procedura non è quella del vettore' })
      .expect(201);
    const stored = listFeedback({ limit: 10 }).find((f) => f.request_id === requestId);
    expect(stored?.rating).toBe('down');
    expect(stored?.comment).toContain('non è quella del vettore');
  });

  it('accetta una segnalazione generica, senza richiesta collegata', async () => {
    // "La sidebar non si apre" non ha una risposta a cui agganciarsi.
    await request(app)
      .post('/feedback')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ rating: 'down', comment: 'la sidebar non si apre' })
      .expect(201);
    expect(listFeedback({ limit: 10 })[0].request_id).toBeNull();
  });

  it('rifiuta un giudizio inventato', async () => {
    await request(app)
      .post('/feedback')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ rating: 'meh' })
      .expect(400);
  });

  it('richiede autenticazione', async () => {
    await request(app).post('/feedback').send({ rating: 'up' }).expect(401);
  });

  it('tronca un commento chilometrico invece di rifiutarlo', async () => {
    // Rifiutare farebbe perdere il feedback; troncare lo conserva.
    await request(app)
      .post('/feedback')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ rating: 'up', comment: 'x'.repeat(5_000) })
      .expect(201);
    expect(listFeedback({ limit: 10 })[0].comment?.length).toBeLessThanOrEqual(600);
  });
});

describe('GET /feedback', () => {
  it('è riservato ai team_lead', async () => {
    await request(app).get('/feedback').expect(401);
  });

  it('restituisce feedback e segnalazioni insieme', async () => {
    initDb();
    insertFeedback({
      id: 'fb-lettura',
      userId: null,
      agentId: 'agente@test',
      rating: 'up',
      comment: 'preciso',
    });
    persist({ status: 'ok', citedSources: 0 });
    const res = await request(app)
      .post('/auth/login')
      .send({ username: 'fb-lead@test', password: 'password-lead', client: 'extension' });
    const token = res.body.token as string;
    const body = (
      await request(app).get('/feedback').set('Authorization', `Bearer ${token}`).expect(200)
    ).body;
    expect(Array.isArray(body.feedback)).toBe(true);
    expect(Array.isArray(body.flagged)).toBe(true);
    expect(body.feedback.some((f: { id: string }) => f.id === 'fb-lettura')).toBe(true);
    expect(body.flagged.length).toBeGreaterThan(0);
  });
});
