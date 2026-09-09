// Composizione dell'app Express: middleware globali + montaggio delle route.
// Esportata come factory (senza listen) così i test di integrazione possono
// istanziarla con supertest.
import express from 'express';
import cors from 'cors';
import { ALLOWED_ORIGINS, TLS_ENABLED } from './config.js';
import { RELEASE } from './release.js';
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
  //
  // ALLOWED_ORIGINS è un ARRAY (tranne nel caso wildcard) e va passato come
  // tale: con una stringa `cors` emette quell'Access-Control-Allow-Origin a
  // ogni richiesta senza confrontarlo con l'Origin ricevuta, quindi una sola
  // origin ammessa diventa «ammessa nessuna» per tutte le altre, senza che il
  // server se ne accorga. Con un array confronta ed echeggia solo se combacia,
  // aggiungendo `Vary: Origin`.
  app.use(cors({ origin: ALLOWED_ORIGINS, allowedHeaders: ['Content-Type', 'Authorization'] }));
  app.use(express.json({ limit: '4mb' }));

  // Header di sicurezza per le pagine HTML servite (login/dashboard).
  // CSP: solo risorse same-origin; inline script/style sono necessari perché
  // le pagine sono renderizzate come template senza asset esterni.
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    // Solo servendo davvero in TLS: annunciarlo in HTTP renderebbe la dashboard
    // irraggiungibile in sviluppo. Senza includeSubDomains (aviationsrl.it
    // ospita altro) e senza preload (questo host è interno). 180 giorni e non un
    // anno perché HSTS inchioda il browser a https e per /dashboard non esiste
    // un fallback: una max-age più corta limita quanto vive un errore.
    if (TLS_ENABLED) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
    );
    next();
  });

  /**
   * Liveness probe.
   *
   * `version` e `commit` sono ciò che rende verificabile un aggiornamento: lo
   * script di deploy interroga questo endpoint finché non risponde con il commit
   * atteso, invece di accontentarsi di «il processo è su». Nient'altro va qui —
   * è l'unico endpoint non autenticato oltre a /auth/login, e la versione di
   * Node o dello schema non vanno regalate a chiunque sia in rete: quelle
   * stanno in /dashboard-data, che è autenticato.
   */
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      provider: getProvider().name,
      version: RELEASE.version,
      commit: RELEASE.shortCommit,
    });
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
