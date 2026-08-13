// Composizione dell'app Express: middleware globali + montaggio delle route.
// Esportata come factory (senza listen) così i test di integrazione possono
// istanziarla con supertest.
import express from 'express';
import cors from 'cors';
import { ALLOWED_ORIGIN } from './config.js';
import { getProvider } from './provider/index.js';
import { authRoutes } from './routes/auth-routes.js';
import { adminRoutes } from './routes/admin.js';
import { askRoutes } from './routes/ask.js';
import { rankRoutes } from './routes/rank.js';
import { pageRoutes } from './routes/pages.js';

export function createApp(): express.Express {
  const app = express();
  // The Authorization header makes extension requests non-simple, so the cors
  // middleware must whitelist it and answer the resulting OPTIONS preflights.
  // Bearer auth needs no credentials:true, so origin '*' stays legal; dashboard
  // cookies are same-origin and never go through CORS.
  app.use(cors({ origin: ALLOWED_ORIGIN, allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '4mb' }));

  // Header di sicurezza per le pagine HTML servite (login/dashboard).
  // CSP: solo risorse same-origin; inline script/style sono necessari perché
  // le pagine sono renderizzate come template senza asset esterni.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    );
    next();
  });

  /** Liveness probe. */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', provider: getProvider().name });
  });

  app.use(authRoutes);
  app.use(askRoutes);
  app.use(rankRoutes);
  app.use(adminRoutes);
  app.use(pageRoutes);

  // Rete finale: qualunque errore non gestito arriva qui (gli handler async lo
  // raggiungono grazie ad asyncRoute — vedi http.ts). Lo stack resta nei log del
  // server e NON va nella risposta: al client basta sapere che è colpa nostra.
  // Su /ask gli header SSE possono essere già partiti: in quel caso non si può
  // più cambiare status, si chiude solo la connessione.
  app.use(
    (err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error(`[error] ${req.method} ${req.path}:`, err);
      if (res.headersSent) {
        res.end();
        return;
      }
      res.status(500).json({ error: 'internal error' });
    },
  );

  return app;
}
