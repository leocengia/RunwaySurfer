// RunwaySurfer on-premise proxy backend — entry point.
//
// Pipeline for POST /ask (see routes/ask.ts):
//   1. route the request to a model by difficulty (router.ts);
//   2. estimate input/output tokens and cost;
//   3. emit the "would-be AI request" (AiPlan) so the CED sees model, cost and
//      the egress endpoint even while the AI call is mocked;
//   4. stream the operational outcome (mock or real provider) as SSE.
//
// The AI provider is selected by AI_PROVIDER (default 'mock'); the API key lives
// here on the server, never in the extension.
import { PORT, ALLOWED_ORIGIN } from './config.js';
import { initDb } from './db.js';
import { bootstrapAdmin } from './auth.js';
import { getProvider } from './provider/index.js';
import { createApp } from './app.js';
import { startMaintenanceScheduler } from './maintenance.js';

// Guardia di configurazione: col provider reale (chiamate a pagamento e dati
// aziendali) il CORS aperto '*' non è accettabile — fail-fast all'avvio.
const provider = (process.env.AI_PROVIDER ?? 'mock').toLowerCase();
if (provider === 'anthropic' && ALLOWED_ORIGIN === '*') {
  console.error(
    '[config] ALLOWED_ORIGIN è obbligatoria quando AI_PROVIDER=anthropic: ' +
      "imposta l'origin dell'estensione (es. chrome-extension://<id>) in .env e riavvia.",
  );
  process.exit(1);
}
if (ALLOWED_ORIGIN === '*') {
  console.warn(
    '[config] ATTENZIONE: CORS aperto (ALLOWED_ORIGIN=*) — accettabile solo per la demo mock. ' +
      'In produzione restringere ad ALLOWED_ORIGIN specifica.',
  );
}

initDb();
await bootstrapAdmin();
startMaintenanceScheduler();

const app = createApp();

app.listen(PORT, () => {
  console.log(
    `RunwaySurfer proxy on :${PORT} — provider=${getProvider().name}, CORS=${ALLOWED_ORIGIN}`,
  );
});
