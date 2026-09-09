// Terminazione TLS diretta in Node: lettura e validazione del materiale,
// ricarica a caldo dopo un rinnovo, timeout del server sul bordo.
//
// Il CED ha escluso il reverse proxy, quindi questo processo È il terminatore
// TLS. Due conseguenze che guidano tutto il modulo:
//
//   1. Il rinnovo del certificato NON è compito dell'applicativo. Un client
//      ACME esterno (certbot + deploy hook, vedi deploy/tls-deploy-hook.sh)
//      scrive due file PEM; qui li si legge, li si valida e — quando cambiano —
//      si sostituisce il contesto TLS senza riavviare e senza interrompere gli
//      stream /ask aperti.
//   2. I timeout del server Node diventano il tetto sulla durata delle
//      risposte, ruolo che prima aveva il proxy. Vedi applyEdgeTimeouts.
//
// Volutamente NON si verifica che il certificato corrisponda all'hostname:
// l'applicativo non deve conoscere il proprio nome (resta solo nella renewal
// config di certbot, nella GPO delle postazioni e nel DNS). Un mismatch si vede
// nel browser, e la riga [tls] di avvio stampa subject e SAN per il controllo.
import { createHash, createPrivateKey, X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import * as tls from 'node:tls';
import type { TlsPaths } from './config.js';

export interface TlsMaterial {
  cert: Buffer;
  key: Buffer;
  ca?: Buffer;
  passphrase?: string;
  /** sha256 di cert+key+ca: è la chiave del confronto per la ricarica. */
  hash: string;
  subject: string;
  subjectAltName?: string;
  validFrom: Date;
  validTo: Date;
  fingerprint256: string;
}

/**
 * Materiale attualmente servito, pubblicato per la dashboard.
 *
 * Tenuto qui invece di rileggere i file a ogni /dashboard-data: la dashboard è
 * l'unico posto dove qualcuno si accorge che il rinnovo automatico si è
 * fermato, e deve mostrare il certificato IN USO, non quello su disco (dopo un
 * rinnovo colto a metà i due possono differire).
 */
let activeMaterial: TlsMaterial | null = null;

export function setActiveTlsMaterial(m: TlsMaterial | null): void {
  activeMaterial = m;
}

export function getActiveTlsMaterial(): TlsMaterial | null {
  return activeMaterial;
}

export type CertState = 'ok' | 'expiring' | 'expired';

export interface CertHealth {
  state: CertState;
  /** Giorni interi alla scadenza; negativo se già scaduto. */
  daysToExpiry: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function read(path: string, what: string): Buffer {
  try {
    return readFileSync(path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // È il fallimento più probabile alla PRIMA installazione: certbot scrive
    // privkey.pem come 0600 root:root, e il servizio gira come utente non
    // privilegiato. Il messaggio deve dire dove guardare, non solo "EACCES".
    if (code === 'EACCES') {
      throw new Error(
        `${what}: file non leggibile dall'utente del servizio (${path}). ` +
          'Verificare proprietario e permessi: i file devono essere copiati dal ' +
          'deploy hook del client ACME (vedi deploy/tls-deploy-hook.sh), non letti ' +
          'direttamente da /etc/letsencrypt, che è accessibile solo a root.',
      );
    }
    if (code === 'ENOENT') {
      throw new Error(
        `${what}: file non trovato (${path}). Se il certificato non è ancora stato ` +
          'emesso, lasciare vuote TLS_CERT_PATH e TLS_KEY_PATH: il servizio parte ' +
          'in HTTP in chiaro.',
      );
    }
    throw new Error(`${what}: file non leggibile (${path}): ${String(e)}`);
  }
}

/**
 * Legge e valida cert, chiave ed eventuale catena. Ogni passo esiste perché
 * fallisce in un modo distinto e va diagnosticato in modo distinto.
 */
export function loadTlsMaterial(paths: TlsPaths): TlsMaterial {
  const cert = read(paths.certPath, 'Il certificato TLS');
  const key = read(paths.keyPath, 'La chiave privata TLS');
  const ca = paths.caPath ? read(paths.caPath, 'La catena intermedia TLS') : undefined;

  // Chiave troncata a metà scrittura, file DER/PFX passato come PEM, passphrase
  // sbagliata: tutti e tre si fermano qui, prima di arrivare al server.
  try {
    createPrivateKey({ key, passphrase: paths.passphrase });
  } catch (e) {
    throw new Error(
      `La chiave privata TLS non è utilizzabile (${paths.keyPath}): ${String(e)}. ` +
        'Attese: PEM non cifrato, oppure TLS_KEY_PASSPHRASE impostata.',
    );
  }

  let x509: X509Certificate;
  try {
    // Su un fullchain questo parsa SOLO il primo certificato — che è
    // esattamente la foglia la cui scadenza ci interessa. Non è un difetto.
    x509 = new X509Certificate(cert);
  } catch (e) {
    throw new Error(
      `Il certificato TLS non è un PEM valido (${paths.certPath}): ${String(e)}.`,
    );
  }

  // L'unico modo economico di intercettare una chiave che non corrisponde al
  // certificato: capita davvero quando un rinnovo scrive il cert prima della
  // chiave, e senza questo controllo il difetto emergerebbe come handshake
  // fallito su ogni postazione.
  try {
    tls.createSecureContext({ cert, key, ca, passphrase: paths.passphrase });
  } catch (e) {
    throw new Error(
      `Certificato e chiave TLS non sono una coppia valida: ${String(e)}. ` +
        `cert=${paths.certPath} key=${paths.keyPath}`,
    );
  }

  const hash = createHash('sha256')
    .update(cert)
    .update(key)
    .update(ca ?? '')
    .digest('hex');

  return {
    cert,
    key,
    ca,
    passphrase: paths.passphrase,
    hash,
    subject: x509.subject.replace(/\n/g, ' '),
    subjectAltName: x509.subjectAltName,
    validFrom: new Date(x509.validFrom),
    validTo: new Date(x509.validTo),
    fingerprint256: x509.fingerprint256,
  };
}

/**
 * Unica fonte delle opzioni TLS.
 *
 * setSecureContext SOSTITUISCE il contesto, non lo fonde: se minVersion o ca
 * vivessero solo nella createServer, la prima ricarica dopo un rinnovo le
 * perderebbe in silenzio. Per questo la funzione è una sola e la usano
 * entrambi i percorsi.
 */
export function secureContextOptions(m: TlsMaterial): tls.SecureContextOptions {
  return {
    cert: m.cert,
    key: m.key,
    ca: m.ca,
    passphrase: m.passphrase,
    minVersion: 'TLSv1.2',
    honorCipherOrder: true,
  };
}

export function assessCertificate(
  m: Pick<TlsMaterial, 'validTo'>,
  now: Date,
  warnDays: number,
): CertHealth {
  const daysToExpiry = Math.floor((m.validTo.getTime() - now.getTime()) / MS_PER_DAY);
  if (m.validTo.getTime() <= now.getTime()) return { state: 'expired', daysToExpiry };
  if (daysToExpiry <= warnDays) return { state: 'expiring', daysToExpiry };
  return { state: 'ok', daysToExpiry };
}

export interface CertificateReloader {
  /** Esegue subito un controllo. Usata dai test invece di aspettare l'interval. */
  checkNow(): void;
  stop(): void;
}

/**
 * Sorveglia i file del certificato e applica il nuovo contesto quando cambiano.
 *
 * Polling sul CONTENUTO, non fs.watch. fs.watch non funziona per questo caso:
 * TLS_CERT_PATH punta tipicamente a un symlink certbot
 * (live/<host>/fullchain.pem -> ../../archive/...), il watcher risolve l'inode
 * di destinazione, e il rinnovo scrive un file nuovo e ri-punta il symlink
 * senza toccare quell'inode: l'evento non arriva mai. Su Windows la
 * sostituzione per rename è inaffidabile, e i bind mount (ReadOnlyPaths,
 * Docker) rompono la propagazione inotify.
 *
 * Il polling va bene perché la scadenza si misura in settimane: certbot rinnova
 * con 30 giorni di margine, quindi 6 ore di latenza sono lo 0,8% del margine, e
 * il costo è due readFileSync da pochi KB più uno sha256. In più VALIDA a ogni
 * giro, così un rinnovo che ha prodotto una chiave non abbinata finisce nei log
 * invece di restare silente fino al riavvio successivo.
 *
 * Confronto per hash e non per mtime: il contenuto va letto comunque per
 * validarlo, quindi l'hash è gratis, ed è immune a `touch`, a `cp -p` e allo
 * scarto d'orologio.
 */
export function startCertificateReloader(opts: {
  paths: TlsPaths;
  /** Materiale attualmente in uso: fornisce l'hash di partenza. */
  current: TlsMaterial;
  /** In produzione: server.setSecureContext(secureContextOptions(m)). */
  apply: (m: TlsMaterial) => void;
  now?: () => Date;
  /** false nei test: un listener SIGHUP registrato e mai rimosso è un leak. */
  sighup?: boolean;
}): CertificateReloader {
  const now = opts.now ?? (() => new Date());
  let hash = opts.current.hash;

  const check = (): void => {
    let next: TlsMaterial;
    try {
      next = loadTlsMaterial(opts.paths);
    } catch (e) {
      // Rinnovo colto a metà, chiave non abbinata, permessi cambiati: si RESTA
      // sul contesto in uso. Un certificato vecchio ma valido serve i browser;
      // uno rotto non serve nessuno.
      console.error('[tls] ricarica annullata, resto sul certificato in uso:', String(e));
      return;
    }

    const health = assessCertificate(next, now(), opts.paths.expiryWarnDays);

    if (next.hash === hash) {
      if (health.state !== 'ok') {
        // È così che ci si accorge che il rinnovo automatico si è fermato,
        // mentre c'è ancora tempo per intervenire. Il giorno della scadenza il
        // servizio si ferma per tutti insieme e nessun agente può aggirarlo.
        console.warn(
          `[tls] il certificato in uso scade fra ${health.daysToExpiry} giorni ` +
            `(${next.validTo.toISOString()}): il rinnovo automatico non sta girando, ` +
            'controllare il timer del client ACME (systemctl list-timers | grep certbot).',
        );
      }
      return;
    }

    if (health.state === 'expired') {
      console.error(
        '[tls] i nuovi file contengono un certificato GIÀ SCADUTO ' +
          `(${next.validTo.toISOString()}): ricarica annullata, resto sul precedente.`,
      );
      return;
    }

    opts.apply(next);
    hash = next.hash;
    console.log(
      `[tls] certificato ricaricato senza riavvio: subject=${next.subject} ` +
        `scadenza=${next.validTo.toISOString()} (${health.daysToExpiry} giorni) ` +
        `fingerprint=${next.fingerprint256}`,
    );
  };

  const timer = setInterval(check, opts.paths.reloadPollMs);
  timer.unref();

  // Ricarica immediata su richiesta del deploy hook. NON sostituisce il
  // polling: Windows non consegna SIGHUP, e un hook che non è partito deve
  // essere recuperato comunque.
  const onSighup = (): void => {
    console.log('[tls] SIGHUP ricevuto: controllo il materiale TLS');
    check();
  };
  if (opts.sighup !== false) process.on('SIGHUP', onSighup);

  return {
    checkNow: check,
    stop: () => {
      clearInterval(timer);
      if (opts.sighup !== false) process.off('SIGHUP', onSighup);
    },
  };
}

/**
 * Timeout del server con Node sul bordo, senza reverse proxy davanti.
 *
 * Dei timeout di http.Server uno solo può uccidere una risposta lunga, e le
 * risposte di /ask restano aperte per minuti:
 *
 *   server.timeout          inattività del SOCKET, in entrambe le direzioni  <- SÌ
 *   server.headersTimeout   completamento degli header di RICHIESTA          no
 *   server.requestTimeout   ricezione della RICHIESTA intera, body compreso  no
 *   server.keepAliveTimeout attesa della richiesta successiva, dopo res.end  no
 *
 * Quindi la regola è una: server.timeout resta 0.
 */
export function applyEdgeTimeouts(server: http.Server): void {
  // Node >= 13 ha già 0, ma lo si fissa per non dipendere da un default: una
  // pausa del modello di N secondi senza byte chiuderebbe /ask a metà.
  server.timeout = 0;

  // Anti-slowloris. Va tenuto > keepAliveTimeout, altrimenti una connessione
  // riusata all'ultimo istante viene tagliata a metà header.
  server.headersTimeout = 60_000;

  // Il timer si azzera a fine richiesta, quindi NON limita la durata della
  // risposta SSE. 120s sono generosi per un body che al massimo è 4 MB
  // (express.json in app.ts) su una LAN. Metterlo a 0 riaprirebbe slowloris.
  server.requestTimeout = 120_000;

  // Guadagno specifico del TLS nativo: senza proxy da far combaciare, ogni
  // riconnessione risparmiata è un handshake TLS risparmiato. La dashboard fa
  // più richieste di seguito ed è la principale beneficiaria.
  server.keepAliveTimeout = 30_000;
}

/**
 * Location del redirect 301 verso https, o null se l'header Host non è
 * utilizzabile.
 *
 * L'header Host arriva dal client: va validato, non concatenato. La porta viene
 * scartata perché il redirect punta sempre alla 443.
 */
export function redirectLocation(hostHeader: string | undefined, url: string): string | null {
  const host = (hostHeader ?? '').split(':')[0];
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(host)) return null;
  // Solo un path assoluto senza caratteri di controllo: nulla che possa
  // iniettare una seconda riga di header.
  const path = /^\/[^\s\\]*$/.test(url) ? url : '/';
  return `https://${host}${path}`;
}
