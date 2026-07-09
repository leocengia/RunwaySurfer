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

initDb();
await bootstrapAdmin();
startMaintenanceScheduler();

const app = createApp();

app.listen(PORT, () => {
  console.log(
    `RunwaySurfer proxy on :${PORT} — provider=${getProvider().name}, CORS=${ALLOWED_ORIGIN}`,
  );
});
