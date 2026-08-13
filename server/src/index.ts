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
// Guardia simmetrica: senza chiave il provider reale esplode alla PRIMA richiesta
// vera, cioè quando un agente sta già aspettando una risposta. Meglio non partire.
if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
  console.error(
    '[config] ANTHROPIC_API_KEY è obbligatoria quando AI_PROVIDER=anthropic: ' +
      'impostala in .env e riavvia (senza, ogni richiesta fallirebbe a runtime).',
  );
  process.exit(1);
}
if (ALLOWED_ORIGIN === '*') {
  console.warn(
    '[config] ATTENZIONE: CORS aperto (ALLOWED_ORIGIN=*) — accettabile solo per la demo mock. ' +
      'In produzione restringere ad ALLOWED_ORIGIN specifica.',
  );
}

// Un errore asincrono sfuggito a tutte le reti non deve spegnere il servizio per
// tutti gli agenti: su Node una rejection non gestita termina il processo. Qui si
// logga e si continua — il backend di un call center deve restare in piedi.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal:unhandledRejection] il servizio continua:', reason);
});
// Un'eccezione sincrona non gestita lascia invece lo stato del processo incerto:
// si logga e si esce con un codice != 0, così il process manager riavvia pulito.
process.on('uncaughtException', (err) => {
  console.error('[fatal:uncaughtException] esco per farmi riavviare:', err);
  process.exit(1);
});

initDb();
await bootstrapAdmin();
startMaintenanceScheduler();

const app = createApp();

app.listen(PORT, () => {
  console.log(
    `RunwaySurfer proxy on :${PORT} — provider=${getProvider().name}, CORS=${ALLOWED_ORIGIN}`,
  );
});
