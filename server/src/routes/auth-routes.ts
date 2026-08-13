// Endpoint di autenticazione. L'identità arriva esclusivamente da una sessione
// verificata (cookie per la dashboard, bearer token per l'estensione).
import { Router, type Request, type Response } from 'express';
import { asyncRoute } from '../http.js';
import { truncate } from '../util.js';
import { deleteExpiredSessions, getUserByExternalId, setUserPassword } from '../db.js';
import {
  authenticate,
  clearLoginFailures,
  clearSessionCookie,
  createSession,
  extractToken,
  hashPassword,
  isLoginBlocked,
  publicUser,
  recordLoginFailure,
  revokeAllUserSessions,
  revokeSession,
  sessionCookie,
  validateNewPassword,
  verifyAgainstDummy,
  verifyPassword,
} from '../auth.js';

export const authRoutes = Router();

const handleLogin = async (req: Request, res: Response): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const username = truncate(body.username, 120);
  const password = typeof body.password === 'string' ? body.password : '';
  const client = body.client === 'extension' ? 'extension' : 'dashboard';
  if (!username || !password) {
    res.status(400).json({ error: 'username e password sono obbligatori' });
    return;
  }
  if (isLoginBlocked(req, username)) {
    res.status(429).json({ error: 'troppi tentativi falliti, riprova tra qualche minuto' });
    return;
  }
  const user = getUserByExternalId(username);
  if (!user) {
    // Flat timing: hash anyway so the response time does not reveal whether
    // the account exists.
    await verifyAgainstDummy(password);
    recordLoginFailure(req, username);
    res.status(401).json({ error: 'credenziali non valide' });
    return;
  }
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    recordLoginFailure(req, username);
    res.status(401).json({ error: 'credenziali non valide' });
    return;
  }
  if (user.status === 'disabled') {
    res.status(403).json({ error: 'utente disabilitato' });
    return;
  }
  clearLoginFailures(req, username);
  deleteExpiredSessions();
  const session = createSession(user.id, client === 'extension' ? 'bearer' : 'cookie');
  const payload = { user: publicUser(user), mustChangePassword: !!user.must_change_password };
  if (client === 'extension') {
    res.json({ ...payload, token: session.token, expiresAt: session.expiresAt });
  } else {
    const maxAge = Math.floor((Date.parse(session.expiresAt) - Date.now()) / 1000);
    res.setHeader('Set-Cookie', sessionCookie(session.token, maxAge));
    res.json(payload);
  }
};

authRoutes.post('/auth/login', asyncRoute(handleLogin));

authRoutes.post('/auth/logout', (req, res) => {
  const presented = extractToken(req);
  if (presented) revokeSession(presented.token);
  if (presented?.via === 'cookie') res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

authRoutes.get('/auth/me', (req, res) => {
  const auth = authenticate(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  res.json({ user: publicUser(auth.user) });
});

const handleChangePassword = async (req: Request, res: Response): Promise<void> => {
  const auth = authenticate(req);
  if (!auth) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!(await verifyPassword(currentPassword, auth.user.password_hash))) {
    res.status(401).json({ error: 'password attuale non corretta' });
    return;
  }
  const invalid = validateNewPassword(newPassword);
  if (invalid) {
    res.status(400).json({ error: invalid });
    return;
  }
  const updated = setUserPassword(auth.user.id, await hashPassword(newPassword), false);
  // Every other session dies with the old password; the presenting one survives.
  revokeAllUserSessions(auth.user.id, extractToken(req)?.token);
  res.json({ ok: true, user: publicUser(updated ?? auth.user) });
};

authRoutes.post('/auth/change-password', asyncRoute(handleChangePassword));
