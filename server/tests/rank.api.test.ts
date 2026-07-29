// Integrazione POST /rank (provider mock, DB SQLite temporaneo). In mock la
// selezione coincide con il top-K per score locale; l'endpoint persiste una riga
// kind:'rank' per la visibilità dei costi.
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createUser, initDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const app = createApp();
const BASE = 'https://traveler.my.site.com/Runway/s/article';

let adminToken = '';
let agentToken = '';

async function seedUser(externalId: string, role: 'admin' | 'agent', password: string) {
  createUser({
    externalId,
    role,
    status: 'active',
    passwordHash: await hashPassword(password),
    mustChangePassword: false,
  });
}

async function loginToken(username: string, password: string): Promise<string> {
  const res = await request(app)
    .post('/auth/login')
    .send({ username, password, client: 'extension' })
    .expect(200);
  return res.body.token as string;
}

const candidates = [
  { url: `${BASE}/A?language=en_US`, text: 'A', score: 5, order: 0 },
  { url: `${BASE}/B?language=en_US`, text: 'B', score: 20, order: 1 },
  { url: `${BASE}/C?language=en_US`, text: 'C', score: 12, order: 2 },
  { url: `${BASE}/D?language=en_US`, text: 'D', score: 1, order: 3 },
];

beforeAll(async () => {
  initDb();
  await seedUser('admin@test', 'admin', 'password-admin-1');
  await seedUser('agente@test', 'agent', 'password-agent-1');
  adminToken = await loginToken('admin@test', 'password-admin-1');
  agentToken = await loginToken('agente@test', 'password-agent-1');
});

describe('POST /rank', () => {
  it('401 senza token', async () => {
    await request(app).post('/rank').send({ query: 'x', candidates }).expect(401);
  });

  it('400 su payload invalido (query o candidates mancanti/vuoti)', async () => {
    await request(app)
      .post('/rank')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ query: '', candidates })
      .expect(400);
    await request(app)
      .post('/rank')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ query: 'rimborso', candidates: [] })
      .expect(400);
    await request(app)
      .post('/rank')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ query: 'rimborso' })
      .expect(400);
  });

  it('200: ritorna gli URL scelti, sottoinsieme dei candidati, ordinati per score (mock)', async () => {
    const res = await request(app)
      .post('/rank')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ query: 'rimborso volo', candidates })
      .expect(200);
    const urls: string[] = res.body.selectedUrls;
    // Mock = top-3 per score: B(20) > C(12) > A(5).
    expect(urls).toEqual([candidates[1].url, candidates[2].url, candidates[0].url]);
    // Sottoinsieme dei candidati (anti-allucinazione garantita a monte).
    const candidateUrls = new Set(candidates.map((c) => c.url));
    expect(urls.every((u) => candidateUrls.has(u))).toBe(true);
    expect(res.body.provider).toBe('mock');
    expect(res.body.model).toBe('claude-haiku-4-5');
  });

  it('persiste una riga kind:"rank" nello storico (visibilità costo rerank)', async () => {
    await request(app)
      .post('/rank')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ query: 'cambio nome biglietto', candidates })
      .expect(200);
    const res = await request(app)
      .get('/requests?agentId=agente@test')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const rankRows = res.body.requests.filter((r: { kind: string }) => r.kind === 'rank');
    expect(rankRows.length).toBeGreaterThan(0);
    expect(rankRows[0].model).toBe('claude-haiku-4-5');
    expect(rankRows[0].status).toBe('ok');
  });
});
