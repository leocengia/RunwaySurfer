// Endpoint amministrativi e di osservabilità (JSON): utenti, team, storico
// richieste, analytics, settings, manutenzione e stato del proxy.
import { Router, type Request, type Response } from 'express';
import { asyncRoute } from '../http.js';
import { newRequestId, truncate } from '../util.js';
import { PORT, ALLOWED_ORIGIN } from '../config.js';
import { getProvider, ANTHROPIC_EGRESS } from '../provider/index.js';
import { metrics } from '../metrics.js';
import { dashboardData, extensionConfig } from '../status.js';
import {
  analyticsSummary,
  createTeam,
  createUser,
  getRequest,
  getSettings,
  insertFeedback,
  listFeedback,
  listFlaggedRequests,
  listRequests,
  listTeams,
  listUsers,
  pruneOldRequests,
  sanitizeUser,
  setUserPassword,
  updateSettings,
  updateUser,
  type SettingsRecord,
} from '../db.js';
import {
  hashPassword,
  requireAuth,
  revokeAllUserSessions,
  validateNewPassword,
  type AuthContext,
} from '../auth.js';

export const adminRoutes = Router();

/**
 * Server & network requirements — surfaced for the CED so they can plan the
 * on-prem deployment without reading the code.
 */
adminRoutes.get('/requirements', requireAuth('team_lead'), (_req, res) => {
  res.json({
    backend: {
      runtime: 'Node.js 20+ (single stateless process)',
      cpu: '1 vCPU sufficiente per il prototipo (I/O bound)',
      ram: '256–512 MB',
      disk: 'minimo (nessuna persistenza; log opzionali)',
      scaling: 'orizzontale, stateless — replicabile dietro load balancer',
    },
    network: {
      inbound: `porta ${PORT} (HTTP); esporre via reverse proxy con TLS`,
      outbound_egress: `HTTPS verso ${ANTHROPIC_EGRESS} (solo con provider reale)`,
      cors: `Access-Control-Allow-Origin = ${ALLOWED_ORIGIN}`,
    },
    secrets: {
      anthropic_api_key: "ANTHROPIC_API_KEY via env/secret manager sul server; MAI nell'estensione",
      rotation: "ruotabile senza redeploy dell'estensione",
    },
    provider: getProvider().name,
    note: 'Con AI_PROVIDER=mock non esce traffico verso Internet: ideale per la demo.',
  });
});

adminRoutes.get('/dashboard-data', requireAuth('team_lead'), (_req, res) => {
  res.json(dashboardData());
});

adminRoutes.get('/metrics', requireAuth('team_lead'), (_req, res) => {
  res.json(metrics);
});

adminRoutes.get('/extension-config', requireAuth('agent'), (_req, res) => {
  res.json(extensionConfig());
});

adminRoutes.get('/users', requireAuth('team_lead'), (_req, res) => {
  res.json({ users: listUsers().map(sanitizeUser) });
});

const handleCreateUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const externalId = truncate(body.externalId ?? body.external_id, 120);
    if (!externalId) {
      res.status(400).json({ error: 'externalId is required' });
      return;
    }
    const tempPassword = typeof body.tempPassword === 'string' ? body.tempPassword : '';
    const invalid = validateNewPassword(tempPassword);
    if (invalid) {
      res.status(400).json({ error: `tempPassword: ${invalid}` });
      return;
    }
    const user = createUser({
      externalId,
      email: truncate(body.email, 240) || null,
      name: truncate(body.name, 240) || null,
      role: body.role === 'admin' || body.role === 'team_lead' ? body.role : 'agent',
      status: body.status === 'pending' || body.status === 'disabled' ? body.status : 'active',
      teamId: typeof body.teamId === 'number' ? body.teamId : null,
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
    });
    res.status(201).json({ user: sanitizeUser(user) });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
};

adminRoutes.post('/users', requireAuth('admin'), asyncRoute(handleCreateUser));

// Recovery path for locked-out or pre-auth users: new temporary password,
// forced change, all existing sessions revoked.
const handleResetPassword = async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid user id' });
    return;
  }
  const tempPassword = (req.body as Record<string, unknown>)?.tempPassword;
  const invalid = validateNewPassword(tempPassword);
  if (invalid) {
    res.status(400).json({ error: `tempPassword: ${invalid}` });
    return;
  }
  const user = setUserPassword(id, await hashPassword(tempPassword as string), true);
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  revokeAllUserSessions(id);
  res.json({ user: sanitizeUser(user) });
};

adminRoutes.post(
  '/users/:id/reset-password',
  requireAuth('admin'),
  asyncRoute(handleResetPassword),
);

adminRoutes.patch('/users/:id', requireAuth('admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'invalid user id' });
    return;
  }
  const body = req.body as Record<string, unknown>;
  const user = updateUser(id, {
    email: typeof body.email === 'string' ? truncate(body.email, 240) : undefined,
    name: typeof body.name === 'string' ? truncate(body.name, 240) : undefined,
    role:
      body.role === 'admin' || body.role === 'team_lead' || body.role === 'agent'
        ? body.role
        : undefined,
    status:
      body.status === 'pending' || body.status === 'active' || body.status === 'disabled'
        ? body.status
        : undefined,
    team_id:
      typeof body.teamId === 'number' ? body.teamId : body.teamId === null ? null : undefined,
  });
  if (!user) {
    res.status(404).json({ error: 'user not found' });
    return;
  }
  if (user.status === 'disabled') revokeAllUserSessions(id);
  res.json({ user: sanitizeUser(user) });
});

adminRoutes.get('/teams', requireAuth('team_lead'), (_req, res) => {
  res.json({ teams: listTeams() });
});

adminRoutes.post('/teams', requireAuth('admin'), (req, res) => {
  try {
    const name = truncate((req.body as Record<string, unknown>).name, 160);
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    res.status(201).json({ team: createTeam(name) });
  } catch (e) {
    res.status(400).json({ error: String(e) });
  }
});

adminRoutes.get('/requests', requireAuth('team_lead'), (req, res) => {
  res.json({
    requests: listRequests({
      agentId: typeof req.query.agentId === 'string' ? req.query.agentId : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      model: typeof req.query.model === 'string' ? req.query.model : undefined,
      teamId: typeof req.query.teamId === 'string' ? Number(req.query.teamId) : undefined,
      limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
    }),
  });
});

adminRoutes.get('/requests/:id', requireAuth('team_lead'), (req, res) => {
  const request = getRequest(req.params.id);
  if (!request) {
    res.status(404).json({ error: 'request not found' });
    return;
  }
  res.json({ request });
});

adminRoutes.get('/analytics/summary', requireAuth('team_lead'), (_req, res) => {
  res.json(analyticsSummary());
});

/** Quanto di un commento libero si conserva. Un paragrafo basta; un romanzo no. */
const MAX_FEEDBACK_COMMENT_CHARS = 600;

/**
 * Feedback di un agente su una risposta. `requireAuth('agent')` accetta sia il
 * Bearer della sidebar sia il cookie della dashboard, quindi non serve una route
 * separata per i due contesti.
 *
 * PRIVACY: il commento arriva GIÀ passato da scrubPii nel browser (lib/scrub.ts).
 * Qui viene solo troncato, e NON finisce nei log — come per la query.
 */
adminRoutes.post('/feedback', requireAuth('agent'), (req, res) => {
  const { user } = res.locals.auth as AuthContext;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rating = body.rating;
  if (rating !== 'up' && rating !== 'down') {
    res.status(400).json({ error: "invalid request: rating must be 'up' or 'down'" });
    return;
  }
  const id = newRequestId();
  insertFeedback({
    id,
    // Un feedback senza richiesta è legittimo: è la segnalazione generica.
    requestId: typeof body.requestId === 'string' ? truncate(body.requestId, 64) : null,
    userId: user.id,
    agentId: user.external_id,
    rating,
    comment:
      typeof body.comment === 'string' ? truncate(body.comment, MAX_FEEDBACK_COMMENT_CHARS) : null,
    queryPreview: typeof body.query === 'string' ? truncate(body.query, 240) : null,
    model: typeof body.model === 'string' ? truncate(body.model, 60) : null,
    mode: typeof body.mode === 'string' ? truncate(body.mode, 20) : null,
  });
  // Nel log solo l'esito, mai il commento.
  console.log(`[feedback:${id}] agent=${user.external_id} rating=${rating}`);
  res.status(201).json({ ok: true, id });
});

/** Feedback degli agenti + richieste che il sistema segnala da sé. */
adminRoutes.get('/feedback', requireAuth('team_lead'), (req, res) => {
  const limit = Number((req.query.limit as string | undefined) ?? 50);
  res.json({
    feedback: listFeedback({ limit }),
    flagged: listFlaggedRequests({ limit }),
  });
});

adminRoutes.get('/settings', requireAuth('team_lead'), (_req, res) => {
  res.json({ settings: getSettings() });
});

adminRoutes.patch('/settings', requireAuth('admin'), (req, res) => {
  res.json({ settings: updateSettings(req.body as Partial<SettingsRecord>) });
});

adminRoutes.post('/maintenance/prune', requireAuth('admin'), (_req, res) => {
  res.json({ deleted: pruneOldRequests() });
});
