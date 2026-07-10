// Authentication layer: scrypt password hashing, opaque session tokens stored
// hashed in SQLite, cookie/bearer extraction and role-based route guards.
//
// Uses only node:crypto — no new npm dependencies (CED constraint). The same
// sessions table backs both surfaces: the dashboard receives the token as an
// HttpOnly cookie, the extension as a bearer token kept in chrome.storage.
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type express from 'express';
import {
  countAdminsWithPassword,
  createUser,
  deleteSession,
  deleteUserSessions,
  getSessionWithUser,
  getUserByExternalId,
  insertSession,
  sanitizeUser,
  setUserPassword,
  touchSession,
  updateUser,
  type SessionKind,
  type SessionRecord,
  type UserRecord,
  type UserRole,
} from './db.js';

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SALT_BYTES = 16;
const KEY_BYTES = 64;

export const SESSION_COOKIE = 'rs_session';
const COOKIE_TTL_MS = 12 * 60 * 60 * 1000; // dashboard: one work day
const BEARER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // extension: re-login monthly
const TOUCH_THROTTLE_MS = 60 * 1000;
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';

const MIN_PASSWORD_LENGTH = 8;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Stored format: scrypt$N=16384,r=8,p=1$<salt b64url>$<hash b64url>. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scryptAsync(password, salt);
  return `scrypt$N=${SCRYPT_N},r=${SCRYPT_R},p=${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[2], 'base64url');
  const expected = Buffer.from(parts[3], 'base64url');
  if (salt.length !== SALT_BYTES || expected.length !== KEY_BYTES) return false;
  const actual = await scryptAsync(password, salt);
  return timingSafeEqual(actual, expected);
}

// Verified against unknown usernames so login timing does not reveal whether
// an account exists. Initialized at startup.
let dummyHash = '';
void hashPassword(randomBytes(8).toString('hex')).then((h) => {
  dummyHash = h;
});

export async function verifyAgainstDummy(password: string): Promise<void> {
  if (dummyHash) await verifyPassword(password, dummyHash);
}

export function validateNewPassword(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `la password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri`;
  }
  if (password.length > 200) return 'password troppo lunga';
  return null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface CreatedSession {
  token: string;
  expiresAt: string;
  kind: SessionKind;
}

export function createSession(userId: number, kind: SessionKind): CreatedSession {
  const token = randomBytes(32).toString('base64url');
  const ttl = kind === 'cookie' ? COOKIE_TTL_MS : BEARER_TTL_MS;
  const expiresAt = new Date(Date.now() + ttl).toISOString();
  insertSession(hashToken(token), userId, kind, expiresAt);
  return { token, expiresAt, kind };
}

export interface AuthContext {
  user: UserRecord;
  session: SessionRecord;
  via: 'cookie' | 'bearer';
}

/** Resolves a raw token to its user; deletes expired rows, refuses disabled users. */
export function getSessionUser(token: string): { user: UserRecord; session: SessionRecord } | null {
  const found = getSessionWithUser(hashToken(token));
  if (!found) return null;
  if (found.session.expires_at < new Date().toISOString()) {
    deleteSession(found.session.token_hash);
    return null;
  }
  if (found.user.status === 'disabled') return null;
  if (Date.now() - Date.parse(found.session.last_seen_at) > TOUCH_THROTTLE_MS) {
    touchSession(found.session.token_hash);
  }
  return found;
}

export function revokeSession(token: string): void {
  deleteSession(hashToken(token));
}

export function revokeAllUserSessions(userId: number, exceptToken?: string): number {
  return deleteUserSessions(userId, exceptToken ? hashToken(exceptToken) : undefined);
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

/** Secure only behind TLS (COOKIE_SECURE=1): on plain http://localhost the browser would drop it. */
export function sessionCookie(token: string, maxAgeSeconds: number): string {
  const secure = COOKIE_SECURE ? '; Secure' : '';
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearSessionCookie(): string {
  return sessionCookie('', 0);
}

/** Extracts the presented token: Authorization bearer first, session cookie as fallback. */
export function extractToken(
  req: express.Request,
): { token: string; via: 'cookie' | 'bearer' } | null {
  const authHeader = req.get('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return { token, via: 'bearer' };
  }
  const cookie = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (cookie) return { token: cookie, via: 'cookie' };
  return null;
}

export function authenticate(req: express.Request): AuthContext | null {
  const presented = extractToken(req);
  if (!presented) return null;
  const found = getSessionUser(presented.token);
  if (!found) return null;
  return { ...found, via: presented.via };
}

const ROLE_RANK: Record<UserRole, number> = { agent: 0, team_lead: 1, admin: 2 };

/**
 * JSON API guard. Rejects missing/expired sessions (401), insufficient role
 * (403) and pending forced password changes (403 password_change_required —
 * the /auth/* routes use authenticate() directly and stay reachable).
 */
export function requireAuth(minRole: UserRole = 'agent') {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = authenticate(req);
    if (!auth) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (ROLE_RANK[auth.user.role] < ROLE_RANK[minRole]) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }
    if (auth.user.must_change_password) {
      res.status(403).json({ error: 'password_change_required' });
      return;
    }
    res.locals.auth = auth;
    next();
  };
}

/** HTML page guard: redirects to /login or /change-password instead of returning JSON. */
export function requirePage(minRole: UserRole = 'team_lead') {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = authenticate(req);
    if (!auth) {
      res.redirect('/login');
      return;
    }
    if (auth.user.must_change_password) {
      res.redirect('/change-password');
      return;
    }
    if (ROLE_RANK[auth.user.role] < ROLE_RANK[minRole]) {
      res
        .status(403)
        .type('html')
        .send('<h1>403</h1><p>Accesso riservato.</p><a href="/login">Login</a>');
      return;
    }
    res.locals.auth = auth;
    next();
  };
}

// ---------------------------------------------------------------------------
// Login rate limiting: in-memory failure counter per ip|username. Resets on
// restart (acceptable — live metrics already do) and on successful login.
const loginFailures = new Map<string, { count: number; windowStart: number }>();

function limiterKey(req: express.Request, username: string): string {
  return `${req.ip}|${username.toLowerCase()}`;
}

export function isLoginBlocked(req: express.Request, username: string): boolean {
  const nowMs = Date.now();
  for (const [key, entry] of loginFailures) {
    if (nowMs - entry.windowStart > LOGIN_WINDOW_MS) loginFailures.delete(key);
  }
  const entry = loginFailures.get(limiterKey(req, username));
  return !!entry && entry.count >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(req: express.Request, username: string): void {
  const key = limiterKey(req, username);
  const nowMs = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || nowMs - entry.windowStart > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, windowStart: nowMs });
  } else {
    entry.count += 1;
  }
}

export function clearLoginFailures(req: express.Request, username: string): void {
  loginFailures.delete(limiterKey(req, username));
}

// ---------------------------------------------------------------------------

/**
 * First-run bootstrap: if no admin can log in yet, create (or upgrade) the
 * ADMIN_USERNAME account from ADMIN_BOOTSTRAP_PASSWORD with a forced password
 * change. Without the env var the server still starts, but with a loud warning
 * because the dashboard would be unreachable.
 */
export async function bootstrapAdmin(): Promise<void> {
  if (countAdminsWithPassword() > 0) return;
  const username = (process.env.ADMIN_USERNAME ?? 'admin').trim();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!password) {
    console.warn(
      '[auth] ATTENZIONE: nessun admin con password nel database e ADMIN_BOOTSTRAP_PASSWORD non impostata — ' +
        'la dashboard non è accessibile. Imposta ADMIN_BOOTSTRAP_PASSWORD e riavvia.',
    );
    return;
  }
  const hash = await hashPassword(password);
  const existing = getUserByExternalId(username);
  if (existing) {
    setUserPassword(existing.id, hash, true);
    if (existing.role !== 'admin' || existing.status !== 'active') {
      updateUser(existing.id, { role: 'admin', status: 'active' });
    }
    console.log(
      `[auth] bootstrap: password impostata per l'utente esistente "${username}" (cambio obbligatorio al primo login)`,
    );
  } else {
    const user = createUser({
      externalId: username,
      name: 'Amministratore',
      role: 'admin',
      status: 'active',
      passwordHash: hash,
      mustChangePassword: true,
    });
    console.log(
      `[auth] bootstrap: creato admin "${user.external_id}" (cambio password obbligatorio al primo login)`,
    );
  }
}

/** Response shape shared by /auth/login, /auth/me and the dashboard. */
export function publicUser(user: UserRecord) {
  const safe = sanitizeUser(user);
  return {
    id: safe.id,
    username: safe.external_id,
    email: safe.email,
    name: safe.name,
    role: safe.role,
    status: safe.status,
    teamId: safe.team_id,
    mustChangePassword: !!safe.must_change_password,
  };
}
