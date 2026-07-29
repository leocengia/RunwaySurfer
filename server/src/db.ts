import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export type UserRole = 'agent' | 'team_lead' | 'admin';
export type UserStatus = 'pending' | 'active' | 'disabled';
export type SessionKind = 'cookie' | 'bearer';

export interface UserRecord {
  id: number;
  external_id: string;
  email: string | null;
  name: string | null;
  role: UserRole;
  status: UserStatus;
  team_id: number | null;
  // scrypt hash (see auth.ts); NULL = login disabled until an admin sets a password.
  password_hash: string | null;
  must_change_password: number;
  created_at: string;
  updated_at: string;
}

/** User shape safe to serialize in API responses (no password hash). */
export type SafeUser = Omit<UserRecord, 'password_hash'>;

export interface SessionRecord {
  token_hash: string;
  user_id: number;
  kind: SessionKind;
  created_at: string;
  expires_at: string;
  last_seen_at: string;
}

export interface TeamRecord {
  id: number;
  name: string;
  created_at: string;
}

export interface RequestHistoryRecord {
  id: string;
  created_at: string;
  user_id: number | null;
  agent_id: string;
  team_id: number | null;
  query_hash: string;
  query_preview: string;
  provider: string;
  model: string;
  pages_count: number;
  links_count: number;
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_cost_usd: number;
  // Token REALI dal provider (SDK `message.usage`); NULL quando il provider non
  // li espone (es. mock) o la richiesta non è arrivata a completamento.
  actual_input_tokens: number | null;
  actual_output_tokens: number | null;
  duration_ms: number;
  status: string;
  error: string | null;
  selected_links_json: string;
  sources_json: string;
  // 'ask' = sintesi risposta; 'rank' = rerank/selezione candidati (Fase reranker).
  kind: string;
}

export interface RequestHistoryInput {
  id: string;
  userId: number | null;
  agentId: string;
  teamId: number | null;
  query: string;
  provider: string;
  model: string;
  pagesCount: number;
  linksCount: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  /** Token reali dal provider, se disponibili; assenti/null = solo stima. */
  actualInputTokens?: number | null;
  actualOutputTokens?: number | null;
  durationMs: number;
  status: 'ok' | 'error' | 'rejected';
  error?: string;
  selectedLinks: unknown[];
  sources: unknown[];
  /** 'ask' (sintesi, default) o 'rank' (rerank candidati). */
  kind?: 'ask' | 'rank';
}

export interface SettingsRecord {
  max_concurrent_requests: number;
  max_concurrent_per_agent: number;
  max_daily_estimated_cost_usd: number;
  max_request_pages: number;
  max_request_links: number;
  max_page_text_chars: number;
  retention_days: number;
}

const DEFAULT_SETTINGS: SettingsRecord = {
  max_concurrent_requests: Number(process.env.MAX_CONCURRENT_REQUESTS ?? 30),
  max_concurrent_per_agent: Number(process.env.MAX_CONCURRENT_PER_AGENT ?? 2),
  max_daily_estimated_cost_usd: Number(process.env.MAX_DAILY_ESTIMATED_COST_USD ?? 50),
  max_request_pages: Number(process.env.MAX_REQUEST_PAGES ?? 4),
  max_request_links: Number(process.env.MAX_REQUEST_LINKS ?? 12),
  max_page_text_chars: Number(process.env.MAX_PAGE_TEXT_CHARS ?? 6_000),
  retention_days: Number(process.env.REQUEST_RETENTION_DAYS ?? 90),
};

const here = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.RUNWAYSURFER_DB_PATH ?? join(here, '..', 'data', 'runwaysurfer.db');
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function now(): string {
  return new Date().toISOString();
}

function hashQuery(query: string): string {
  return createHash('sha256').update(query).digest('hex');
}

function queryPreview(query: string): string {
  return query.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function json(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL UNIQUE,
      email TEXT,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'agent',
      status TEXT NOT NULL DEFAULT 'pending',
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      password_hash TEXT,
      must_change_password INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('cookie', 'bearer')),
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS requests (
      id TEXT PRIMARY KEY,
      created_at TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      agent_id TEXT NOT NULL,
      team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
      query_hash TEXT NOT NULL,
      query_preview TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      pages_count INTEGER NOT NULL,
      links_count INTEGER NOT NULL,
      estimated_input_tokens INTEGER NOT NULL,
      estimated_output_tokens INTEGER NOT NULL,
      estimated_cost_usd REAL NOT NULL,
      actual_input_tokens INTEGER,
      actual_output_tokens INTEGER,
      duration_ms INTEGER NOT NULL,
      status TEXT NOT NULL,
      error TEXT,
      selected_links_json TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'ask'
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_requests_created_at ON requests(created_at);
    CREATE INDEX IF NOT EXISTS idx_requests_agent ON requests(agent_id);
    CREATE INDEX IF NOT EXISTS idx_requests_user ON requests(user_id);
    CREATE INDEX IF NOT EXISTS idx_requests_team ON requests(team_id);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  const insertSetting = db.prepare(`
    INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)
  `);
  const ts = now();
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insertSetting.run(key, String(value), ts);
  }

  migrate();
}

// Schema versioning via PRAGMA user_version. Version 1 adds the auth columns to
// `users` for databases created before the login feature; version 2 adds the
// real-token columns to `requests`; version 3 adds `kind` ('ask'|'rank') to
// `requests` per attribuire il costo del reranker separatamente. Il guard su
// table_info tiene le ALTER idempotenti (i DB freschi hanno già le colonne dalla
// CREATE TABLE).
function migrate(): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version < 1) {
    db.transaction(() => {
      const columns = (db.pragma('table_info(users)') as Array<{ name: string }>).map(
        (c) => c.name,
      );
      if (!columns.includes('password_hash')) {
        db.exec('ALTER TABLE users ADD COLUMN password_hash TEXT');
      }
      if (!columns.includes('must_change_password')) {
        db.exec('ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0');
      }
      db.pragma('user_version = 1');
    })();
  }
  if (version < 2) {
    db.transaction(() => {
      const columns = (db.pragma('table_info(requests)') as Array<{ name: string }>).map(
        (c) => c.name,
      );
      // Colonne nullable: le righe storiche restano valide (solo stima, actual NULL).
      if (!columns.includes('actual_input_tokens')) {
        db.exec('ALTER TABLE requests ADD COLUMN actual_input_tokens INTEGER');
      }
      if (!columns.includes('actual_output_tokens')) {
        db.exec('ALTER TABLE requests ADD COLUMN actual_output_tokens INTEGER');
      }
      db.pragma('user_version = 2');
    })();
  }
  if (version < 3) {
    db.transaction(() => {
      const columns = (db.pragma('table_info(requests)') as Array<{ name: string }>).map(
        (c) => c.name,
      );
      // `kind` distingue la chiamata di sintesi ('ask') da quella di rerank
      // ('rank'), per attribuire il costo separatamente. Default 'ask' → le righe
      // storiche restano corrette senza backfill.
      if (!columns.includes('kind')) {
        db.exec("ALTER TABLE requests ADD COLUMN kind TEXT NOT NULL DEFAULT 'ask'");
      }
      db.pragma('user_version = 3');
    })();
  }
}

/** Strips credential material before a user row leaves the server. */
export function sanitizeUser(user: UserRecord): SafeUser {
  const { password_hash: _password_hash, ...safe } = user;
  return safe;
}

export function getSettings(): SettingsRecord {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{
    key: string;
    value: string;
  }>;
  const values: Record<string, number> = {};
  for (const row of rows) values[row.key] = Number(row.value);
  return {
    max_concurrent_requests:
      values.max_concurrent_requests ?? DEFAULT_SETTINGS.max_concurrent_requests,
    max_concurrent_per_agent:
      values.max_concurrent_per_agent ?? DEFAULT_SETTINGS.max_concurrent_per_agent,
    max_daily_estimated_cost_usd:
      values.max_daily_estimated_cost_usd ?? DEFAULT_SETTINGS.max_daily_estimated_cost_usd,
    max_request_pages: values.max_request_pages ?? DEFAULT_SETTINGS.max_request_pages,
    max_request_links: values.max_request_links ?? DEFAULT_SETTINGS.max_request_links,
    max_page_text_chars: values.max_page_text_chars ?? DEFAULT_SETTINGS.max_page_text_chars,
    retention_days: values.retention_days ?? DEFAULT_SETTINGS.retention_days,
  };
}

export function updateSettings(patch: Partial<SettingsRecord>): SettingsRecord {
  const allowed = new Set(Object.keys(DEFAULT_SETTINGS));
  const stmt = db.prepare(`
    INSERT INTO settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  const ts = now();
  for (const [key, value] of Object.entries(patch)) {
    if (!allowed.has(key) || typeof value !== 'number' || !Number.isFinite(value)) continue;
    stmt.run(key, String(value), ts);
  }
  return getSettings();
}

export function resolveUser(identity: {
  externalId: string;
  email?: string | null;
  name?: string | null;
}): UserRecord {
  const existing = db
    .prepare('SELECT * FROM users WHERE external_id = ?')
    .get(identity.externalId) as UserRecord | undefined;
  if (existing) return existing;

  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO users (external_id, email, name, role, status, team_id, created_at, updated_at)
       VALUES (?, ?, ?, 'agent', 'pending', NULL, ?, ?)`,
    )
    .run(identity.externalId, identity.email ?? null, identity.name ?? null, ts, ts);
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRecord;
}

export function listUsers(): UserRecord[] {
  return db.prepare('SELECT * FROM users ORDER BY created_at DESC').all() as UserRecord[];
}

export function createUser(input: {
  externalId: string;
  email?: string | null;
  name?: string | null;
  role?: UserRole;
  status?: UserStatus;
  teamId?: number | null;
  passwordHash?: string | null;
  mustChangePassword?: boolean;
}): UserRecord {
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO users (external_id, email, name, role, status, team_id, password_hash, must_change_password, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.externalId,
      input.email ?? null,
      input.name ?? null,
      input.role ?? 'agent',
      input.status ?? 'active',
      input.teamId ?? null,
      input.passwordHash ?? null,
      input.mustChangePassword ? 1 : 0,
      ts,
      ts,
    );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid) as UserRecord;
}

export function getUserById(id: number): UserRecord | null {
  return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined) ?? null;
}

export function getUserByExternalId(externalId: string): UserRecord | null {
  return (
    (db.prepare('SELECT * FROM users WHERE external_id = ?').get(externalId) as
      UserRecord | undefined) ?? null
  );
}

export function setUserPassword(
  id: number,
  passwordHash: string,
  mustChange: boolean,
): UserRecord | null {
  const info = db
    .prepare(
      'UPDATE users SET password_hash = ?, must_change_password = ?, updated_at = ? WHERE id = ?',
    )
    .run(passwordHash, mustChange ? 1 : 0, now(), id);
  if (info.changes === 0) return null;
  return getUserById(id);
}

export function insertSession(
  tokenHash: string,
  userId: number,
  kind: SessionKind,
  expiresAt: string,
): void {
  const ts = now();
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, kind, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(tokenHash, userId, kind, ts, expiresAt, ts);
}

export function getSessionWithUser(
  tokenHash: string,
): { session: SessionRecord; user: UserRecord } | null {
  const row = db
    .prepare(
      `SELECT s.token_hash, s.user_id, s.kind, s.created_at AS session_created_at,
              s.expires_at, s.last_seen_at, u.*
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .get(tokenHash) as
    | (UserRecord & {
        token_hash: string;
        user_id: number;
        kind: SessionKind;
        session_created_at: string;
        expires_at: string;
        last_seen_at: string;
      })
    | undefined;
  if (!row) return null;
  const { token_hash, user_id, kind, session_created_at, expires_at, last_seen_at, ...user } = row;
  return {
    session: {
      token_hash,
      user_id,
      kind,
      created_at: session_created_at,
      expires_at,
      last_seen_at,
    },
    user: user as UserRecord,
  };
}

export function touchSession(tokenHash: string): void {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(now(), tokenHash);
}

export function deleteSession(tokenHash: string): void {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteUserSessions(userId: number, exceptTokenHash?: string): number {
  const info = exceptTokenHash
    ? db
        .prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?')
        .run(userId, exceptTokenHash)
    : db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return info.changes;
}

export function deleteExpiredSessions(): number {
  return db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()).changes;
}

export function countAdminsWithPassword(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND password_hash IS NOT NULL")
    .get() as { n: number };
  return row.n;
}

export function updateUser(
  id: number,
  patch: Partial<Pick<UserRecord, 'email' | 'name' | 'role' | 'status' | 'team_id'>>,
): UserRecord | null {
  const current = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
  if (!current) return null;
  db.prepare(
    `UPDATE users
     SET email = ?, name = ?, role = ?, status = ?, team_id = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.email ?? current.email,
    patch.name ?? current.name,
    patch.role ?? current.role,
    patch.status ?? current.status,
    patch.team_id === undefined ? current.team_id : patch.team_id,
    now(),
    id,
  );
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord;
}

export function listTeams(): TeamRecord[] {
  return db.prepare('SELECT * FROM teams ORDER BY name').all() as TeamRecord[];
}

export function createTeam(name: string): TeamRecord {
  const info = db
    .prepare('INSERT INTO teams (name, created_at) VALUES (?, ?)')
    .run(name.trim(), now());
  return db.prepare('SELECT * FROM teams WHERE id = ?').get(info.lastInsertRowid) as TeamRecord;
}

export function insertRequestHistory(input: RequestHistoryInput): void {
  db.prepare(
    `INSERT INTO requests (
      id, created_at, user_id, agent_id, team_id, query_hash, query_preview,
      provider, model, pages_count, links_count, estimated_input_tokens,
      estimated_output_tokens, estimated_cost_usd, actual_input_tokens,
      actual_output_tokens, duration_ms, status, error,
      selected_links_json, sources_json, kind
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    now(),
    input.userId,
    input.agentId,
    input.teamId,
    hashQuery(input.query),
    queryPreview(input.query),
    input.provider,
    input.model,
    input.pagesCount,
    input.linksCount,
    input.estimatedInputTokens,
    input.estimatedOutputTokens,
    input.estimatedCostUsd,
    input.actualInputTokens ?? null,
    input.actualOutputTokens ?? null,
    input.durationMs,
    input.status,
    input.error ?? null,
    json(input.selectedLinks),
    json(input.sources),
    input.kind ?? 'ask',
  );
}

export function listRequests(filters: {
  agentId?: string;
  status?: string;
  model?: string;
  teamId?: number;
  limit?: number;
}): RequestHistoryRecord[] {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (filters.agentId) {
    clauses.push('agent_id = ?');
    params.push(filters.agentId);
  }
  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }
  if (filters.model) {
    clauses.push('model = ?');
    params.push(filters.model);
  }
  if (typeof filters.teamId === 'number') {
    clauses.push('team_id = ?');
    params.push(filters.teamId);
  }
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 500);
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  return db
    .prepare(`SELECT * FROM requests ${where} ORDER BY created_at DESC LIMIT ?`)
    .all(...params, limit) as RequestHistoryRecord[];
}

export function getRequest(id: string): RequestHistoryRecord | null {
  return (
    (db.prepare('SELECT * FROM requests WHERE id = ?').get(id) as
      RequestHistoryRecord | undefined) ?? null
  );
}

export function analyticsSummary() {
  const totals = db
    .prepare(
      `
    SELECT
      COUNT(*) as requests,
      COALESCE(SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END), 0) as ok,
      COALESCE(SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END), 0) as errors,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) as rejected,
      COALESCE(SUM(estimated_input_tokens), 0) as inputTokens,
      COALESCE(SUM(estimated_output_tokens), 0) as outputTokens,
      COALESCE(SUM(estimated_cost_usd), 0) as estimatedCostUsd
    FROM requests
  `,
    )
    .get();
  const byModel = db
    .prepare(
      `
    SELECT model, COUNT(*) as requests, COALESCE(SUM(estimated_cost_usd), 0) as estimatedCostUsd
    FROM requests GROUP BY model ORDER BY requests DESC
  `,
    )
    .all();
  const byAgent = db
    .prepare(
      `
    SELECT agent_id as agentId, COUNT(*) as requests, COALESCE(SUM(estimated_cost_usd), 0) as estimatedCostUsd
    FROM requests GROUP BY agent_id ORDER BY requests DESC LIMIT 20
  `,
    )
    .all();
  return { totals, byModel, byAgent };
}

export function pruneOldRequests(retentionDays = getSettings().retention_days): number {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const info = db.prepare('DELETE FROM requests WHERE created_at < ?').run(cutoff);
  return info.changes;
}

// NOTA: initDb() NON viene più eseguita come side effect all'import; è il
// punto d'ingresso (index.ts) o il setup dei test a chiamarla esplicitamente,
// così l'ordine di inizializzazione è visibile e il modulo resta testabile.
