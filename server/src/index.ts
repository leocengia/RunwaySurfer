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
// PRIMO import, e non è un caso: carica server/.env prima che config.ts e db.ts
// leggano l'ambiente (lo fanno al momento del proprio import).
import './load-env.js';
import * as http from 'node:http';
import * as https from 'node:https';
import {
  ALLOWED_ORIGIN,
  ALLOWED_ORIGINS,
  CONFIG_ERRORS,
  KB_PAGE_ORIGIN,
  PUBLIC_SCHEME,
  SERVER,
} from './config.js';
import { DB_PATH, initDb } from './db.js';
import { RELEASE } from './release.js';
import { bootstrapAdmin } from './auth.js';
import { getProvider } from './provider/index.js';
import { createApp } from './app.js';
import { startMaintenanceScheduler } from './maintenance.js';
import {
  applyEdgeTimeouts,
  assessCertificate,
  loadTlsMaterial,
  redirectLocation,
  secureContextOptions,
  setActiveTlsMaterial,
  startCertificateReloader,
  type TlsMaterial,
} from './tls.js';

// Configurazione di rete incoerente (mezza configurazione TLS, porta fuori
// range, redirect senza https): si ferma qui con l'elenco, non alla prima
// richiesta di un agente.
if (CONFIG_ERRORS.length > 0) {
  for (const error of CONFIG_ERRORS) console.error(`[config] ${error}`);
  process.exit(1);
}

// Guardia di configurazione: col provider reale (chiamate a pagamento e dati
// aziendali) il CORS aperto '*' non è accettabile — fail-fast all'avvio.
const provider = (process.env.AI_PROVIDER ?? 'mock').toLowerCase();
if (provider === 'anthropic' && ALLOWED_ORIGINS === '*') {
  console.error(
    '[config] ALLOWED_ORIGIN è obbligatoria quando AI_PROVIDER=anthropic: ' +
      `imposta le origin ammesse in .env e riavvia, per esempio\n` +
      `  ALLOWED_ORIGIN=${KB_PAGE_ORIGIN},chrome-extension://<id-estensione>`,
  );
  process.exit(1);
}
// La sidebar è un content script dentro la KB: in Manifest V3 le sue chiamate
// viaggiano con l'Origin della PAGINA, non dell'estensione. Ammettere solo
// l'estensione è la configurazione che è stata documentata per mesi, e produce
// il guasto peggiore possibile: il pulsante «Test connessione» della pagina
// opzioni riesce (gira da chrome-extension://) mentre TUTTE le chiamate della
// sidebar vengono bloccate dal browser, e l'agente legge «Backend non
// raggiungibile» — un messaggio che manda a cercare la VPN. Qui diventa una
// riga all'avvio invece di dieci postazioni ferme.
if (provider === 'anthropic' && !ALLOWED_ORIGINS.includes(KB_PAGE_ORIGIN)) {
  console.error(
    `[config] ALLOWED_ORIGIN non contiene ${KB_PAGE_ORIGIN}, che è l'origin da cui la ` +
      'sidebar chiama davvero il backend (in Manifest V3 il fetch di un content script ' +
      "porta l'Origin della pagina ospite, non quello dell'estensione). Senza, il " +
      'browser bloccherebbe ogni richiesta degli agenti. Aggiungila:\n' +
      `  ALLOWED_ORIGIN=${KB_PAGE_ORIGIN},chrome-extension://<id-estensione>`,
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
if (ALLOWED_ORIGINS === '*') {
  console.warn(
    '[config] ATTENZIONE: CORS aperto (ALLOWED_ORIGIN=*) — accettabile solo per la demo mock. ' +
      'In produzione restringere ad ALLOWED_ORIGIN specifica.',
  );
} else {
  // Prova che il valore letto è quello inteso: le origin si sbagliano con uno
  // slash finale o una virgola di troppo, e il sintomo è indistinguibile da un
  // problema di rete.
  console.log(`[config] origin CORS ammesse: ${ALLOWED_ORIGINS.join(' ')}`);
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

// initDb() ora può rifiutarsi di procedere: un database scritto da una build più
// recente di questa (tipicamente dopo un rollback) non va toccato. Una riga [db]
// pulita nel journal, coerente con i prefissi [config] e [tls], invece di uno
// stack trace.
try {
  initDb();
} catch (e) {
  console.error(`[db] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
await bootstrapAdmin();
startMaintenanceScheduler();

const app = createApp();

// Il CED ha escluso il reverse proxy: se il materiale TLS è configurato, questo
// processo termina l'HTTPS. Senza, resta l'HTTP in chiaro dello sviluppo e della
// demo Docker.
//
// NIENTE shutdown graceful: server.close() attende la chiusura degli stream SSE
// aperti, che durano minuti, e bloccherebbe ogni riavvio fino a TimeoutStopSec.
// Chi volesse aggiungerlo deve prevedere un process.exit() dopo una finestra di
// grazia breve.
let server: http.Server;

if (SERVER.tls) {
  let material: TlsMaterial;
  try {
    material = loadTlsMaterial(SERVER.tls);
  } catch (e) {
    console.error(`[tls] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }

  const health = assessCertificate(material, new Date(), SERVER.tls.expiryWarnDays);
  if (health.state === 'expired') {
    // Servire un certificato che ogni browser rifiuta è peggio che essere
    // visibilmente giù: con Restart=on-failure il servizio resta in restart-loop
    // e il difetto è evidente nei log invece di sembrare un problema di rete.
    console.error(
      `[tls] il certificato è SCADUTO il ${material.validTo.toISOString()}: non parto. ` +
        'Rinnovare (certbot renew) e verificare che il deploy hook abbia copiato i file.',
    );
    process.exit(1);
  }
  if (health.state === 'expiring') {
    console.warn(
      `[tls] il certificato scade fra ${health.daysToExpiry} giorni ` +
        `(${material.validTo.toISOString()}): verificare il rinnovo automatico.`,
    );
  }

  const httpsServer = https.createServer(secureContextOptions(material), app);
  server = httpsServer;
  setActiveTlsMaterial(material);

  console.log(
    `[tls] certificato caricato: subject=${material.subject} ` +
      `san=${material.subjectAltName ?? 'nessuno'} ` +
      `scadenza=${material.validTo.toISOString()} (${health.daysToExpiry} giorni) ` +
      `fingerprint=${material.fingerprint256}`,
  );

  // Le connessioni già stabilite mantengono il vecchio contesto: uno stream
  // /ask aperto da tre minuti non viene interrotto dal rinnovo, e la richiesta
  // successiva prende il certificato nuovo. È il motivo per cui dopo un rinnovo
  // NON serve riavviare il servizio.
  startCertificateReloader({
    paths: SERVER.tls,
    current: material,
    apply: (next) => {
      httpsServer.setSecureContext(secureContextOptions(next));
      setActiveTlsMaterial(next);
    },
  });
} else {
  server = http.createServer(app);
}

applyEdgeTimeouts(server);

// Registrato PRIMA della listen: sono i due fallimenti che capitano davvero
// alla prima installazione, e senza messaggio costano una mezz'ora a testa.
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EACCES' && SERVER.port < 1024) {
    console.error(
      `[config] permesso negato sulla porta ${SERVER.port}: come utente non privilegiato ` +
        'serve AmbientCapabilities=CAP_NET_BIND_SERVICE nella unit systemd ' +
        '(vedi deploy/runwaysurfer.service), oppure impostare PORT a un valore > 1024.',
    );
    process.exit(1);
  }
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[config] la porta ${SERVER.port} è già occupata da un altro processo: ` +
        'verificare che non ci sia un secondo servizio in ascolto (su Windows spesso IIS).',
    );
    process.exit(1);
  }
  throw err;
});

server.listen(SERVER.port, SERVER.host, () => {
  // Una riga sola, con tutto ciò che serve a capire cosa è partito: versione e
  // commit (per sapere se l'aggiornamento ha avuto effetto), schema e percorso
  // del database (per accorgersi se RUNWAYSURFER_DB_PATH è sparito dall'env
  // file e il DB è finito dentro una directory di release).
  console.log(
    `RunwaySurfer ${RELEASE.version} (${RELEASE.shortCommit}) su ` +
      `${PUBLIC_SCHEME}://${SERVER.host ?? '0.0.0.0'}:${SERVER.port} — ` +
      `provider=${getProvider().name}, CORS=${ALLOWED_ORIGIN}, ` +
      `schema=${RELEASE.schemaVersion}, db=${DB_PATH}, node=${process.version}`,
  );
});

// Redirect 301 solo per le persone: chi apre /dashboard da un vecchio segnalibro
// http:// altrimenti vede «impossibile raggiungere il sito», indistinguibile da
// un servizio giù. L'estensione non lo usa mai (la GPO le passa un URL https), e
// NON serve al rinnovo del certificato: la validazione è DNS-01, che non tocca
// la porta 80.
if (SERVER.redirectPort !== null) {
  const redirectServer = http.createServer((req, res) => {
    const location = redirectLocation(req.headers.host, req.url ?? '/');
    if (!location) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Host non valido\n');
      return;
    }
    res.writeHead(301, { Location: location, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`Questo servizio è disponibile solo in HTTPS: ${location}\n`);
  });
  redirectServer.on('error', (err) => {
    // Il redirect è una comodità: se la porta 80 non è disponibile il servizio
    // principale deve restare in piedi comunque.
    console.error(`[config] redirect HTTP sulla porta ${SERVER.redirectPort} non attivo:`, err);
  });
  redirectServer.listen(SERVER.redirectPort, SERVER.host, () => {
    console.log(`[config] redirect 301 verso https attivo sulla porta ${SERVER.redirectPort}`);
  });
}
