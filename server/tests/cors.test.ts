// CORS: quali origin il backend ammette davvero.
//
// Questo file esiste per un difetto concreto: la configurazione di produzione
// documentata era `ALLOWED_ORIGIN=chrome-extension://<id>`, ma la sidebar è un
// content script dentro la KB e in Manifest V3 le sue chiamate viaggiano con
// l'Origin della PAGINA ospite (Chrome ha rimosso il bypass CORS per i content
// script nella versione 85). Il risultato era che il pulsante «Test connessione»
// della pagina opzioni riusciva — gira da chrome-extension:// — mentre ogni
// chiamata degli agenti veniva bloccata dal browser con un messaggio che parla
// di rete. Il server non se ne accorgeva: vede solo OPTIONS 204.
//
// ALLOWED_ORIGIN si legge all'import di config.ts, quindi l'ambiente va
// impostato PRIMA di importare l'app: vitest isola il registro dei moduli per
// file, quindi qui si può fare (stesso schema di migration.test.ts).
import { describe, expect, it } from 'vitest';
import request from 'supertest';

const KB = 'https://traveler.my.site.com';
const EXT = 'chrome-extension://ihpknodkjnjcbdfmdneeeollnedbdcpd';

// Anche config.ts va importato in modo DINAMICO: un import statico viene
// valutato prima di questa riga (gli import sono issati in cima al modulo) e
// leggerebbe un ambiente in cui ALLOWED_ORIGIN non è ancora impostata.
process.env.ALLOWED_ORIGIN = `${KB},${EXT}`;
const { resolveAllowedOrigins } = await import('../src/config.js');
const { createApp } = await import('../src/app.js');
const app = createApp();

describe('resolveAllowedOrigins', () => {
  it('assente = demo aperta', () => {
    const r = resolveAllowedOrigins({});
    expect(r.origins).toBe('*');
    expect(r.errors).toEqual([]);
  });

  // Il buco chiuso da questa modifica: prima `?? '*'` non intercettava la
  // stringa vuota, `cors` riceveva '' e diventava un no-op — nessun header CORS,
  // ogni chiamata dal browser fallita — e la guardia di avvio non se ne
  // accorgeva perché '' non è '*'.
  it('stringa vuota vale come assente, non come lista vuota', () => {
    expect(resolveAllowedOrigins({ ALLOWED_ORIGIN: '' }).origins).toBe('*');
    expect(resolveAllowedOrigins({ ALLOWED_ORIGIN: '   ' }).origins).toBe('*');
  });

  it('legge una lista separata da virgole', () => {
    const r = resolveAllowedOrigins({ ALLOWED_ORIGIN: `${KB}, ${EXT}` });
    expect(r.origins).toEqual([KB, EXT]);
    expect(r.errors).toEqual([]);
    expect(r.display).toBe(`${KB}, ${EXT}`);
  });

  // Un Origin non ha mai lo slash finale: senza normalizzazione questa voce non
  // combacerebbe con nessuna richiesta, e il guasto sarebbe muto.
  it('togli lo slash finale', () => {
    expect(resolveAllowedOrigins({ ALLOWED_ORIGIN: `${KB}/` }).origins).toEqual([KB]);
  });

  it('deduplica', () => {
    expect(resolveAllowedOrigins({ ALLOWED_ORIGIN: `${KB},${KB}/` }).origins).toEqual([KB]);
  });

  it('accetta una porta esplicita', () => {
    expect(resolveAllowedOrigins({ ALLOWED_ORIGIN: 'http://localhost:8787' }).origins).toEqual([
      'http://localhost:8787',
    ]);
  });

  // `cors` confronta la voce '*' di un array per uguaglianza stringa: in una
  // lista non è un wildcard, è codice morto che sembra permissivo.
  it("rifiuta '*' mescolato ad altre origin", () => {
    const r = resolveAllowedOrigins({ ALLOWED_ORIGIN: `*,${KB}` });
    expect(r.errors.join(' ')).toContain('wildcard');
  });

  it.each(['traveler.my.site.com', 'ftp://host', `${KB}/Runway`, 'https://'])(
    'rifiuta una origin malformata: %s',
    (value) => {
      expect(resolveAllowedOrigins({ ALLOWED_ORIGIN: value }).errors).not.toEqual([]);
    },
  );
});

describe('preflight su /ask', () => {
  async function preflight(origin: string) {
    return request(app)
      .options('/ask')
      .set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');
  }

  it("ammette l'origin della KB, da cui chiama la sidebar", async () => {
    const res = await preflight(KB);
    expect(res.headers['access-control-allow-origin']).toBe(KB);
    expect(res.headers['access-control-allow-headers']).toContain('Authorization');
    // Con più origin ammesse la risposta dipende dalla richiesta: senza Vary un
    // qualunque cache intermedia servirebbe l'header di un'altra origin.
    expect(res.headers.vary).toContain('Origin');
  });

  it("ammette l'origin dell'estensione, da cui chiama la pagina opzioni", async () => {
    expect((await preflight(EXT)).headers['access-control-allow-origin']).toBe(EXT);
  });

  // Il comportamento che la stringa singola NON aveva: lì l'header veniva
  // emesso sempre, identico, qualunque Origin arrivasse.
  it('a una origin sconosciuta non risponde con nessun header ACAO', async () => {
    const res = await preflight('https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('richieste non-preflight', () => {
  it("echeggia l'origin ammessa anche sulla risposta vera", async () => {
    const res = await request(app).get('/health').set('Origin', KB);
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(KB);
  });

  // Il server risponde comunque: CORS non è un controllo d'accesso, decide solo
  // se il BROWSER lascia leggere la risposta al codice di pagina. Chi usa curl
  // non è mai stato fermato da qui, ed è per questo che l'autenticazione sta
  // altrove (requireAuth su ogni endpoint tranne /health e /auth/login).
  it("non blocca la richiesta di un'origin sconosciuta, non la espone al browser", async () => {
    const res = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
