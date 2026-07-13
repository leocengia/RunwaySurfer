// Test di integrazione dell'app Express (provider mock, DB SQLite temporaneo).
import { beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createUser, initDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';
import { metrics } from '../src/metrics.js';

const app = createApp();

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

beforeAll(async () => {
  initDb();
  await seedUser('admin@test', 'admin', 'password-admin-1');
  await seedUser('agente@test', 'agent', 'password-agent-1');
  adminToken = await loginToken('admin@test', 'password-admin-1');
  agentToken = await loginToken('agente@test', 'password-agent-1');
});

describe('endpoint pubblici', () => {
  it('GET /health risponde senza autenticazione', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.provider).toBe('mock');
  });

  it('GET /login serve la pagina HTML', async () => {
    const res = await request(app).get('/login').expect(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain('login-form');
  });
});

describe('autenticazione', () => {
  it('rifiuta credenziali errate con 401', async () => {
    await request(app)
      .post('/auth/login')
      .send({ username: 'admin@test', password: 'sbagliata!', client: 'extension' })
      .expect(401);
  });

  it('GET /auth/me riconosce il bearer token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.user.username).toBe('admin@test');
  });

  it('endpoint protetti rispondono 401 senza token', async () => {
    await request(app).get('/users').expect(401);
    await request(app).post('/ask').send({ query: 'x', pages: [], links: [] }).expect(401);
  });
});

describe('ruoli', () => {
  it("l'agente non può leggere /users (403), l'admin sì", async () => {
    await request(app).get('/users').set('Authorization', `Bearer ${agentToken}`).expect(403);
    const res = await request(app)
      .get('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });

  it("l'agente può leggere la configurazione estensione", async () => {
    const res = await request(app)
      .get('/extension-config')
      .set('Authorization', `Bearer ${agentToken}`)
      .expect(200);
    expect(res.body.maxPagesPerAsk).toBeGreaterThan(0);
  });
});

describe('POST /ask', () => {
  const validBody = {
    query: 'come cambio indirizzo?',
    pages: [
      {
        url: 'https://kb.example.com/wiki/Indirizzi',
        title: 'Indirizzi',
        text: 'Procedura per il cambio indirizzo di consegna.',
        origin: 'current',
      },
    ],
    links: [],
  };

  it('valida il payload (400 su query/pages mancanti)', async () => {
    await request(app)
      .post('/ask')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ query: '', pages: [], links: [] })
      .expect(400);
  });

  it('streamma plan → delta → done via SSE con il provider mock', async () => {
    const res = await request(app)
      .post('/ask')
      .set('Authorization', `Bearer ${agentToken}`)
      .send(validBody)
      .expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    const events = res.text
      .split('\n\n')
      .filter((f) => f.startsWith('data: '))
      .map((f) => JSON.parse(f.slice('data: '.length)));
    expect(events[0].type).toBe('plan');
    expect(events[0].plan.provider).toBe('mock');
    expect(events[0].plan.model).toBeTruthy();
    expect(events.some((e) => e.type === 'delta')).toBe(true);
    expect(events.at(-1)?.type).toBe('done');
    // Il contatore richieste attive è stato rilasciato dal finally (Bug 4).
    expect(metrics.activeRequests).toBe(0);
  });

  it('registra la richiesta nello storico consultabile via /requests', async () => {
    const res = await request(app)
      .get('/requests?agentId=agente@test')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body.requests.length).toBeGreaterThan(0);
    expect(res.body.requests[0].status).toBe('ok');
  });
});

describe('amministrazione', () => {
  it('crea un utente con password temporanea e cambio obbligatorio', async () => {
    const res = await request(app)
      .post('/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ externalId: 'nuovo@test', tempPassword: 'temporanea-123' })
      .expect(201);
    expect(res.body.user.must_change_password).toBe(1);

    // Il nuovo utente entra ma è bloccato sugli endpoint finché non cambia password.
    const login = await request(app)
      .post('/auth/login')
      .send({ username: 'nuovo@test', password: 'temporanea-123', client: 'extension' })
      .expect(200);
    expect(login.body.mustChangePassword).toBe(true);
    const blocked = await request(app)
      .post('/ask')
      .set('Authorization', `Bearer ${login.body.token}`)
      .send({ query: 'x', pages: [], links: [] })
      .expect(403);
    expect(blocked.body.error).toBe('password_change_required');
  });

  it('PATCH /settings è riservato agli admin', async () => {
    await request(app)
      .patch('/settings')
      .set('Authorization', `Bearer ${agentToken}`)
      .send({ max_request_pages: 5 })
      .expect(403);
    const res = await request(app)
      .patch('/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ max_request_pages: 5 })
      .expect(200);
    expect(res.body.settings.max_request_pages).toBe(5);
  });
});
