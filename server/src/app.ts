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
import { pageRoutes } from './routes/pages.js';

export function createApp(): express.Express {
  const app = express();
  // The Authorization header makes extension requests non-simple, so the cors
  // middleware must whitelist it and answer the resulting OPTIONS preflights.
  // Bearer auth needs no credentials:true, so origin '*' stays legal; dashboard
  // cookies are same-origin and never go through CORS.
  app.use(cors({ origin: ALLOWED_ORIGIN, allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '4mb' }));

  /** Liveness probe. */
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', provider: getProvider().name });
  });

  app.use(authRoutes);
  app.use(askRoutes);
  app.use(adminRoutes);
  app.use(pageRoutes);

  return app;
}
