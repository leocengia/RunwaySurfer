// Configurazione da variabili d'ambiente e costanti globali del backend.
// Centralizzata qui così i moduli route non leggono process.env in ordine sparso.
import { MODELS } from './router.js';

/**
 * Percorsi e soglie del materiale TLS. Solo stringhe e numeri: la lettura dei
 * file e il parsing del certificato stanno in tls.ts, così questo modulo resta
 * puro e testabile senza filesystem.
 */
export interface TlsPaths {
  certPath: string;
  keyPath: string;
  /** Catena intermedia separata: serve solo se certPath non è già un fullchain. */
  caPath?: string;
  passphrase?: string;
  reloadPollMs: number;
  expiryWarnDays: number;
}

export interface ServerConfig {
  port: number;
  /** undefined = tutte le interfacce (0.0.0.0 / ::). */
  host: string | undefined;
  /** Porta del redirect 301 verso https; null = disattivato. */
  redirectPort: number | null;
  /** null = il servizio parte in HTTP in chiaro (sviluppo e demo Docker). */
  tls: TlsPaths | null;
}

const DEFAULT_HTTP_PORT = 8787;
const DEFAULT_HTTPS_PORT = 443;
const DEFAULT_RELOAD_POLL_MS = 6 * 60 * 60 * 1000; // 6h — vedi tls.ts
const DEFAULT_EXPIRY_WARN_DAYS = 21;

/** Vuoto e assente sono la stessa cosa: una env impostata a "" non è una scelta. */
function str(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

function port(
  env: NodeJS.ProcessEnv,
  name: string,
  errors: string[],
  fallback: number | null,
): number | null {
  const raw = str(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${name} deve essere un intero fra 1 e 65535 (valore attuale: "${raw}").`);
    return fallback;
  }
  return value;
}

function positiveMs(
  env: NodeJS.ProcessEnv,
  name: string,
  errors: string[],
  fallback: number,
): number {
  const raw = str(env, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    errors.push(`${name} deve essere un numero positivo (valore attuale: "${raw}").`);
    return fallback;
  }
  return value;
}

/**
 * Risolve la configurazione di rete dalle variabili d'ambiente.
 *
 * Puro di proposito: nessun accesso al filesystem, nessun process.exit, nessun
 * throw. Gli errori tornano come lista e li stampa index.ts col prefisso
 * `[config]`, insieme alle altre guardie di avvio — così un deploy mezzo
 * configurato si ferma con un messaggio, non alla prima richiesta di un agente.
 */
export function resolveServerConfig(env: NodeJS.ProcessEnv): {
  config: ServerConfig;
  errors: string[];
} {
  const errors: string[] = [];

  const certPath = str(env, 'TLS_CERT_PATH');
  const keyPath = str(env, 'TLS_KEY_PATH');

  // Mezza configurazione TLS non è un default plausibile: è sempre un errore di
  // deploy, e lasciarla passare significherebbe partire in chiaro su una porta
  // che gli agenti raggiungono via https. Meglio non partire.
  if (Boolean(certPath) !== Boolean(keyPath)) {
    errors.push(
      'TLS_CERT_PATH e TLS_KEY_PATH vanno impostate ENTRAMBE o nessuna delle due: ' +
        `impostata solo ${certPath ? 'TLS_CERT_PATH' : 'TLS_KEY_PATH'}.`,
    );
  }

  const tls: TlsPaths | null =
    certPath && keyPath
      ? {
          certPath,
          keyPath,
          caPath: str(env, 'TLS_CA_PATH'),
          passphrase: str(env, 'TLS_KEY_PASSPHRASE'),
          reloadPollMs: positiveMs(env, 'TLS_RELOAD_POLL_MS', errors, DEFAULT_RELOAD_POLL_MS),
          expiryWarnDays: positiveMs(env, 'TLS_EXPIRY_WARN_DAYS', errors, DEFAULT_EXPIRY_WARN_DAYS),
        }
      : null;

  // Default condizionato: il CED ha dato un hostname nudo, e `https://host` È la
  // 443. Con la 443 come default il .env di produzione ha solo le due righe
  // TLS_*, e la porta non si può dimenticare — il cui failure mode sarebbe
  // "servizio su, agenti che non lo raggiungono".
  const resolvedPort = port(env, 'PORT', errors, tls ? DEFAULT_HTTPS_PORT : DEFAULT_HTTP_PORT)!;
  const redirectPort = port(env, 'HTTP_REDIRECT_PORT', errors, null);

  if (redirectPort !== null && !tls) {
    errors.push(
      'HTTP_REDIRECT_PORT è impostata ma il TLS non è configurato: ' +
        'redirigerebbe verso uno schema che questo servizio non serve.',
    );
  }
  if (redirectPort !== null && redirectPort === resolvedPort) {
    errors.push(`HTTP_REDIRECT_PORT e PORT non possono essere la stessa porta (${resolvedPort}).`);
  }

  return {
    config: { port: resolvedPort, host: str(env, 'HOST'), redirectPort, tls },
    errors,
  };
}

const resolved = resolveServerConfig(process.env);

export const SERVER = resolved.config;
export const PORT = SERVER.port;
export const TLS_ENABLED = SERVER.tls !== null;
export const PUBLIC_SCHEME = TLS_ENABLED ? 'https' : 'http';

/**
 * Flag Secure sul cookie di sessione della dashboard. Con il TLS terminato da
 * Node il processo SA se sta servendo in https, quindi il default lo deriva:
 * farlo ridichiarare all'operatore ha come failure mode un cookie di sessione
 * senza Secure. `COOKIE_SECURE=0` resta la via d'uscita esplicita.
 */
export const COOKIE_SECURE =
  process.env.COOKIE_SECURE === undefined || process.env.COOKIE_SECURE.trim() === ''
    ? TLS_ENABLED
    : process.env.COOKIE_SECURE.trim() === '1';

/**
 * Intervallo del keep-alive SSE su /ask. Metà del budget di inattività del
 * client (STREAM_IDLE_TIMEOUT_MS in lib/client.ts, 30s): così un ping perso o
 * in ritardo non basta a far scattare l'abort.
 */
export const ASK_PING_MS = positiveMs(process.env, 'ASK_PING_MS', [], 15_000);

/**
 * Origin della pagina Knowledge Base.
 *
 * Il server ha bisogno di conoscerla per una ragione sola: in Manifest V3 un
 * fetch che parte da un content script viaggia con l'Origin della PAGINA
 * ospite, non con quello dell'estensione (Chrome ha rimosso il bypass CORS per
 * i content script nella 85). La sidebar gira dentro la KB, quindi è questa
 * l'origin che il backend vede arrivare, ed è questa che deve essere ammessa.
 */
export const KB_PAGE_ORIGIN = 'https://traveler.my.site.com';

/** Schemi ammessi in ALLOWED_ORIGIN: http/https per le pagine, chrome-extension per la pagina opzioni. */
const ORIGIN_SHAPE = /^(?:https?|chrome-extension):\/\/[A-Za-z0-9._-]+(?::\d{1,5})?$/;

/**
 * Origin CORS ammesse, come lista separata da virgole.
 *
 * Perché una LISTA e non una stringa sola: le chiamate al backend arrivano da
 * due contesti diversi con due Origin diversi — la sidebar (content script
 * dentro la KB → Origin della KB) e la pagina delle opzioni con il suo pulsante
 * «Test connessione» (→ chrome-extension://<id>). Ammetterne una sola rompe
 * l'altra, e la combinazione peggiore è proprio quella documentata prima di
 * questa modifica: ammettere solo l'estensione fa funzionare il test di
 * connessione e fallire ogni chiamata della sidebar, con un messaggio che parla
 * di rete.
 *
 * Il valore va poi passato a `cors` come ARRAY, mai come stringa: con una
 * stringa la libreria emette quell'Access-Control-Allow-Origin sempre, senza
 * confrontarlo con la richiesta; con un array confronta ed echeggia l'origin
 * solo se ammessa. Fail-closed invece di fail-confusing.
 */
export function resolveAllowedOrigins(env: NodeJS.ProcessEnv): {
  origins: string[] | '*';
  /** Forma leggibile per log, /requirements e dashboard. */
  display: string;
  errors: string[];
} {
  const errors: string[] = [];
  const raw = str(env, 'ALLOWED_ORIGIN');

  // Assente o vuota = demo aperta. Nota: prima si usava `?? '*'`, che NON
  // intercetta la stringa vuota: una riga `ALLOWED_ORIGIN=` svuotata a mano
  // arrivava a `cors` come '', il middleware diventava un no-op e non emetteva
  // alcun header CORS — ogni chiamata dal browser falliva — mentre la guardia
  // di avvio non se ne accorgeva perché '' non è '*'.
  if (raw === undefined || raw === '*') {
    return { origins: '*', display: '*', errors };
  }

  const seen = new Set<string>();
  for (const piece of raw.split(',')) {
    // Lo slash finale va tolto: un `https://host/` incollato non combacerà mai
    // con un header Origin, che non ne ha. Fallimento totale e senza indizi.
    const origin = piece.trim().replace(/\/+$/, '');
    if (origin === '') continue;
    if (origin === '*') {
      // `cors` confronta la voce '*' di un array per uguaglianza stringa contro
      // l'origin della richiesta: in una lista non è un wildcard, è codice
      // morto. Meglio un errore che una configurazione che sembra permissiva.
      errors.push(
        "ALLOWED_ORIGIN: '*' non può essere mescolato ad altre origin — " +
          'in una lista non vale come wildcard. Usare solo * oppure solo origin esplicite.',
      );
      continue;
    }
    if (!ORIGIN_SHAPE.test(origin)) {
      errors.push(
        `ALLOWED_ORIGIN: "${origin}" non è un'origin valida. ` +
          'Attesa la forma schema://host[:porta], senza percorso, con schema ' +
          'http, https o chrome-extension.',
      );
      continue;
    }
    seen.add(origin);
  }

  if (seen.size === 0 && errors.length === 0) {
    errors.push('ALLOWED_ORIGIN non contiene nessuna origin utilizzabile.');
  }

  const origins = [...seen];
  return { origins, display: origins.join(', '), errors };
}

const allowed = resolveAllowedOrigins(process.env);

/** Lista effettiva da passare a `cors` ('*' solo per la demo). */
export const ALLOWED_ORIGINS = allowed.origins;

/** Forma leggibile, usata nei log e nei payload di stato. */
export const ALLOWED_ORIGIN = allowed.display;

/**
 * Tutti i problemi di configurazione raccolti all'import, stampati da index.ts
 * col prefisso [config] prima di uscire. Dichiarata QUI e non accanto a SERVER
 * perché deve includere anche gli errori di ALLOWED_ORIGIN, risolta più sotto.
 */
export const CONFIG_ERRORS = [...resolved.errors, ...allowed.errors];

/** Limite difensivo sulla lunghezza della query accettata da /ask. */
export const MAX_QUERY_CHARS = 1_000;

/**
 * Dollari per euro, usato SOLO per confrontare la spesa (che il listino esprime
 * in USD) con il budget, che è espresso in euro.
 *
 * È un tasso fisso, non un cambio in tempo reale: va bene per un tetto di spesa
 * — se il cambio si muove del 10%, il tetto effettivo si muove del 10% — e non va
 * bene per la contabilità. Aggiornabile con la env `USD_PER_EUR` senza toccare il
 * codice. Il default è volutamente basso: sottostimando il valore dell'euro il
 * guardrail scatta un po' PRIMA, non dopo.
 */
export const USD_PER_EUR = Number(process.env.USD_PER_EUR ?? 1.05);

/** Quante richieste recenti tenere nelle metriche live in memoria. */
export const RECENT_REQUEST_LIMIT = 25;

/**
 * Tetto difensivo ai candidati accettati da /rank. La shortlist client è ~30;
 * 40 lascia margine senza far esplodere il prompt del reranker.
 */
export const MAX_RANK_CANDIDATES = 40;

/**
 * Modello del reranker: SEMPRE il più economico (haiku). La selezione è una
 * classificazione di metadati, non una sintesi → non passa da chooseModel.
 * Override via env RANK_MODEL solo per esperimenti.
 */
export const RANK_MODEL = process.env.RANK_MODEL ?? MODELS.haiku.id;
