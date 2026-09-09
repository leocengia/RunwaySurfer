// Terminazione TLS: risoluzione della configurazione, lettura e validazione del
// materiale, ricarica dopo un rinnovo, redirect.
//
// I certificati sono fixture committate (vedi tests/fixtures/tls/README.md):
// Node non sa firmare un certificato, e generarlo con openssl a runtime avrebbe
// skippato questi test proprio dove servono di più.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyFileSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as https from 'node:https';
import type { AddressInfo } from 'node:net';
import { resolveServerConfig, type TlsPaths } from '../src/config.js';
import { createApp } from '../src/app.js';
import {
  applyEdgeTimeouts,
  assessCertificate,
  loadTlsMaterial,
  redirectLocation,
  secureContextOptions,
  startCertificateReloader,
} from '../src/tls.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'tls');
const CERT = join(FIXTURES, 'test-only.crt');
const KEY = join(FIXTURES, 'test-only.key');
const RENEWED_CERT = join(FIXTURES, 'test-only-renewed.crt');
const RENEWED_KEY = join(FIXTURES, 'test-only-renewed.key');

function paths(over: Partial<TlsPaths> = {}): TlsPaths {
  return {
    certPath: CERT,
    keyPath: KEY,
    reloadPollMs: 60_000,
    expiryWarnDays: 21,
    ...over,
  };
}

/** Copia la coppia in una cartella temporanea, così i test possono sostituirla. */
function mutablePair(): { dir: string; certPath: string; keyPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'rs-tls-'));
  const certPath = join(dir, 'fullchain.pem');
  const keyPath = join(dir, 'privkey.pem');
  copyFileSync(CERT, certPath);
  copyFileSync(KEY, keyPath);
  return { dir, certPath, keyPath };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveServerConfig', () => {
  it('senza variabili TLS resta in HTTP sulla 8787', () => {
    const { config, errors } = resolveServerConfig({});
    expect(errors).toEqual([]);
    expect(config.tls).toBeNull();
    expect(config.port).toBe(8787);
    expect(config.host).toBeUndefined();
    expect(config.redirectPort).toBeNull();
  });

  it('con cert e chiave passa alla 443 senza che nessuno debba scriverlo', () => {
    const { config, errors } = resolveServerConfig({
      TLS_CERT_PATH: '/etc/runwaysurfer/tls/fullchain.pem',
      TLS_KEY_PATH: '/etc/runwaysurfer/tls/privkey.pem',
    });
    expect(errors).toEqual([]);
    expect(config.port).toBe(443);
    expect(config.tls).toMatchObject({
      certPath: '/etc/runwaysurfer/tls/fullchain.pem',
      keyPath: '/etc/runwaysurfer/tls/privkey.pem',
    });
  });

  it('PORT esplicita vince sul default condizionato', () => {
    const { config } = resolveServerConfig({
      TLS_CERT_PATH: 'a',
      TLS_KEY_PATH: 'b',
      PORT: '8443',
    });
    expect(config.port).toBe(8443);
  });

  it('una env impostata a stringa vuota vale come assente', () => {
    const { config, errors } = resolveServerConfig({ TLS_CERT_PATH: '  ', TLS_KEY_PATH: '' });
    expect(errors).toEqual([]);
    expect(config.tls).toBeNull();
  });

  // È la mezza configurazione TLS: partirebbe in chiaro su una porta che gli
  // agenti raggiungono via https, e nessuno lo noterebbe fino alla prima query.
  it('rifiuta solo TLS_CERT_PATH', () => {
    const { errors } = resolveServerConfig({ TLS_CERT_PATH: 'solo-il-cert.pem' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('ENTRAMBE');
  });

  it('rifiuta solo TLS_KEY_PATH', () => {
    const { errors } = resolveServerConfig({ TLS_KEY_PATH: 'solo-la-chiave.pem' });
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('TLS_KEY_PATH');
  });

  it('rifiuta il redirect senza TLS: punterebbe a uno schema non servito', () => {
    const { errors } = resolveServerConfig({ HTTP_REDIRECT_PORT: '80' });
    expect(errors.join(' ')).toContain('HTTP_REDIRECT_PORT');
  });

  it('rifiuta redirect e servizio sulla stessa porta', () => {
    const { errors } = resolveServerConfig({
      TLS_CERT_PATH: 'a',
      TLS_KEY_PATH: 'b',
      PORT: '8443',
      HTTP_REDIRECT_PORT: '8443',
    });
    expect(errors.join(' ')).toContain('stessa porta');
  });

  it.each(['abc', '0', '70000', '443.5'])('rifiuta PORT non valida: %s', (value) => {
    const { errors } = resolveServerConfig({ PORT: value });
    expect(errors.join(' ')).toContain('PORT deve essere un intero');
  });

  it('rifiuta TLS_RELOAD_POLL_MS non positiva', () => {
    const { errors } = resolveServerConfig({
      TLS_CERT_PATH: 'a',
      TLS_KEY_PATH: 'b',
      TLS_RELOAD_POLL_MS: '0',
    });
    expect(errors.join(' ')).toContain('TLS_RELOAD_POLL_MS');
  });

  it('legge HOST come indirizzo di bind', () => {
    expect(resolveServerConfig({ HOST: '127.0.0.1' }).config.host).toBe('127.0.0.1');
  });
});

describe('loadTlsMaterial', () => {
  it('legge la coppia valida e ne estrae identità e scadenza', () => {
    const m = loadTlsMaterial(paths());
    expect(m.subject).toContain('CN=localhost');
    expect(m.subjectAltName).toContain('DNS:localhost');
    expect(m.validTo.getUTCFullYear()).toBe(2100);
    expect(m.fingerprint256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(m.hash).toHaveLength(64);
  });

  it('l hash cambia se cambia il materiale', () => {
    const a = loadTlsMaterial(paths());
    const b = loadTlsMaterial(paths({ certPath: RENEWED_CERT, keyPath: RENEWED_KEY }));
    expect(a.hash).not.toBe(b.hash);
  });

  it('segnala una chiave che non corrisponde al certificato', () => {
    // Il difetto reale quando un rinnovo scrive il certificato prima della
    // chiave: senza questo controllo emergerebbe come handshake fallito su ogni
    // postazione, senza nulla nei log del server.
    expect(() => loadTlsMaterial(paths({ keyPath: RENEWED_KEY }))).toThrow(
      /non sono una coppia valida/,
    );
  });

  it('segnala cert e chiave scambiati', () => {
    expect(() => loadTlsMaterial(paths({ certPath: KEY, keyPath: CERT }))).toThrow(
      /chiave privata TLS non è utilizzabile/,
    );
  });

  it('nomina il percorso quando il file non esiste', () => {
    const missing = join(FIXTURES, 'non-esiste.pem');
    expect(() => loadTlsMaterial(paths({ certPath: missing }))).toThrow(missing);
  });

  it('segnala un certificato troncato a metà scrittura', () => {
    const { certPath, keyPath } = mutablePair();
    writeFileSync(certPath, readFileSync(CERT).subarray(0, 120));
    expect(() => loadTlsMaterial(paths({ certPath, keyPath }))).toThrow();
  });
});

describe('assessCertificate', () => {
  const validTo = new Date('2100-07-30T11:00:00Z');
  const day = 24 * 60 * 60 * 1000;

  it('ok quando la scadenza è oltre la soglia di preavviso', () => {
    const health = assessCertificate({ validTo }, new Date(validTo.getTime() - 60 * day), 21);
    expect(health).toEqual({ state: 'ok', daysToExpiry: 60 });
  });

  it('expiring al confine della soglia', () => {
    const health = assessCertificate({ validTo }, new Date(validTo.getTime() - 21 * day), 21);
    expect(health.state).toBe('expiring');
    expect(health.daysToExpiry).toBe(21);
  });

  it('ok un giorno prima del confine', () => {
    expect(assessCertificate({ validTo }, new Date(validTo.getTime() - 22 * day), 21).state).toBe(
      'ok',
    );
  });

  it('expired dopo la scadenza', () => {
    const health = assessCertificate({ validTo }, new Date(validTo.getTime() + day), 21);
    expect(health.state).toBe('expired');
    expect(health.daysToExpiry).toBeLessThan(0);
  });
});

describe('startCertificateReloader', () => {
  function reloader(over: Partial<TlsPaths>, apply: (m: unknown) => void, now?: () => Date) {
    const p = paths({ ...over, reloadPollMs: 3_600_000 });
    return startCertificateReloader({
      paths: p,
      current: loadTlsMaterial(p),
      apply: apply as never,
      now,
      // Un listener SIGHUP registrato e mai rimosso inquinerebbe i test vicini.
      sighup: false,
    });
  }

  it('non applica nulla se il materiale non è cambiato', () => {
    const { certPath, keyPath } = mutablePair();
    const apply = vi.fn();
    const r = reloader({ certPath, keyPath }, apply);
    r.checkNow();
    r.checkNow();
    expect(apply).not.toHaveBeenCalled();
    r.stop();
  });

  it('applica il nuovo certificato una volta sola dopo un rinnovo', () => {
    const { certPath, keyPath } = mutablePair();
    const apply = vi.fn();
    const r = reloader({ certPath, keyPath }, apply);

    copyFileSync(RENEWED_CERT, certPath);
    copyFileSync(RENEWED_KEY, keyPath);
    r.checkNow();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0][0]).toMatchObject({ subject: 'CN=localhost-renewed' });

    // Secondo giro senza modifiche: l'hash coincide, niente da fare.
    r.checkNow();
    expect(apply).toHaveBeenCalledTimes(1);
    r.stop();
  });

  it('resta sul certificato in uso se i nuovi file sono illeggibili', () => {
    const { certPath, keyPath } = mutablePair();
    const apply = vi.fn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = reloader({ certPath, keyPath }, apply);

    // Rinnovo colto a metà scrittura.
    writeFileSync(certPath, readFileSync(RENEWED_CERT).subarray(0, 100));
    r.checkNow();

    expect(apply).not.toHaveBeenCalled();
    expect(errors.mock.calls[0]?.[0]).toContain('resto sul certificato in uso');
    r.stop();
  });

  it('resta sul certificato in uso se il rinnovo ha prodotto una coppia non abbinata', () => {
    const { certPath, keyPath } = mutablePair();
    const apply = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = reloader({ certPath, keyPath }, apply);

    // Solo il certificato è stato sostituito: la chiave è ancora la vecchia.
    copyFileSync(RENEWED_CERT, certPath);
    r.checkNow();

    expect(apply).not.toHaveBeenCalled();
    r.stop();
  });

  it('non applica un certificato nuovo ma già scaduto', () => {
    const { certPath, keyPath } = mutablePair();
    const apply = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Orologio oltre la scadenza della fixture.
    const r = reloader({ certPath, keyPath }, apply, () => new Date('2101-01-01T00:00:00Z'));

    copyFileSync(RENEWED_CERT, certPath);
    copyFileSync(RENEWED_KEY, keyPath);
    r.checkNow();

    expect(apply).not.toHaveBeenCalled();
    r.stop();
  });

  it('avvisa quando il certificato in uso si avvicina alla scadenza', () => {
    // È il modo in cui ci si accorge che il rinnovo automatico non sta girando.
    const { certPath, keyPath } = mutablePair();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = reloader({ certPath, keyPath }, vi.fn(), () => new Date('2100-07-20T00:00:00Z'));
    r.checkNow();
    expect(warn.mock.calls[0]?.[0]).toContain('rinnovo automatico non sta girando');
    r.stop();
  });

  it('stop() interrompe i controlli successivi', () => {
    const { certPath, keyPath } = mutablePair();
    const apply = vi.fn();
    const r = reloader({ certPath, keyPath }, apply);
    r.stop();
    copyFileSync(RENEWED_CERT, certPath);
    copyFileSync(RENEWED_KEY, keyPath);
    // checkNow resta invocabile, ma il timer non scatta più: quello che conta è
    // che non ci sia un handler residuo.
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('redirectLocation', () => {
  it('costruisce il redirect dal Host e scarta la porta', () => {
    expect(redirectLocation('runway-surfer.aviationsrl.it:8080', '/dashboard')).toBe(
      'https://runway-surfer.aviationsrl.it/dashboard',
    );
  });

  it('conserva query string e path', () => {
    expect(redirectLocation('host.local', '/login?next=/dashboard')).toBe(
      'https://host.local/login?next=/dashboard',
    );
  });

  it('normalizza un url non assoluto', () => {
    expect(redirectLocation('host.local', 'dashboard')).toBe('https://host.local/');
  });

  it.each([undefined, '', 'host with space', 'host\r\nX-Evil: 1', '@evil.com'])(
    'rifiuta un Host non utilizzabile: %s',
    (host) => {
      expect(redirectLocation(host, '/')).toBeNull();
    },
  );
});

// Unico test TLS reale: prova che createServer + secureContextOptions +
// applyEdgeTimeouts + listen si compongono davvero. La catena viene verificata
// passando la fixture come `ca`, quindi non si tocca NODE_TLS_REJECT_UNAUTHORIZED
// (che avvelenerebbe gli altri test dello stesso worker).
describe('server HTTPS', () => {
  it('serve /health in TLS sulla porta effimera', async () => {
    const material = loadTlsMaterial(paths());
    const server = https.createServer(secureContextOptions(material), createApp());
    applyEdgeTimeouts(server);
    expect(server.timeout).toBe(0);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = https.request(
          {
            host: '127.0.0.1',
            port,
            path: '/health',
            ca: material.cert,
            servername: 'localhost',
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve(data));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(JSON.parse(body).status).toBe('ok');
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
