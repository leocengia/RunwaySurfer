// Il tour visivo è una "camminata in-page": driveTour legge il contenuto dei
// target via shallowFollow(targets, query, targets.length) SENZA navigare. Qui
// verifichiamo l'invariante centrale di quella lettura — pagine marcate
// `followed`, una fetch per target con la sessione inclusa, target falliti
// saltati e nessuna navigazione — con fetch stubato (pattern di client.test.ts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shallowFollow } from '../lib/crawl';
import type { KbLink } from '../lib/outcome';

const BASE = 'https://kb.example.com/wiki';

/** Target come li passa driveTour: già dotati di `score` da pickRelevantLinks. */
function target(text: string, url: string, score: number, matchedKeywords: string[] = []): KbLink {
  return { text, url, score, matchedKeywords };
}

// Pagina server-rendered: il body ha un vero content-root (<main>), così
// hasRenderedContent la considera valida (a differenza di uno shell client-side).
function htmlResponse(title: string, body: string): Response {
  return new Response(
    `<!doctype html><html><head><title>${title}</title></head><body><main>${body}</main></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html' } },
  );
}

// Shell di un'app client-rendered (es. Salesforce Aura): niente content-root,
// solo script di bootstrap. hasRenderedContent → false, va scartata.
function shellResponse(): Response {
  return new Response(
    `<!doctype html><html><head><title>App</title></head><body><div id="app"></div><script>/* aura boot */</script></body></html>`,
    { status: 200, headers: { 'content-type': 'text/html' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('shallowFollow — lettura in-page del tour', () => {
  it('legge in parallelo i target e li restituisce marcati followed', async () => {
    const targets = [
      target('Cambio indirizzo', `${BASE}/Cambio_indirizzo`, 12, ['indirizzo']),
      target('Rimborso ordine', `${BASE}/Rimborso`, 9, ['rimborso']),
    ];
    const fetchMock = vi.fn(async (url: string) =>
      url === targets[0].url
        ? htmlResponse('Cambio indirizzo', '<p>come cambiare indirizzo di consegna</p>')
        : htmlResponse('Rimborso ordine', '<p>procedura di rimborso</p>'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pages = await shallowFollow(targets, 'cambiare indirizzo', targets.length);

    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.origin === 'followed')).toBe(true);
    expect(pages.map((p) => p.title).sort()).toEqual(['Cambio indirizzo', 'Rimborso ordine']);
    // Una fetch per target, ciascuna con la sessione del browser inclusa.
    expect(fetchMock).toHaveBeenCalledTimes(targets.length);
    for (const [, init] of fetchMock.mock.calls as unknown as Array<[string, RequestInit]>) {
      expect(init.credentials).toBe('include');
    }
  });

  it('salta il target il cui fetch fallisce senza far cadere gli altri', async () => {
    const targets = [target('Buona', `${BASE}/Buona`, 12), target('Rotta', `${BASE}/Rotta`, 10)];
    const fetchMock = vi.fn(async (url: string) =>
      url === targets[1].url
        ? new Response('errore', { status: 500 })
        : htmlResponse('Buona', '<p>contenuto</p>'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pages = await shallowFollow(targets, 'qualcosa di utile', targets.length);

    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe(`${BASE}/Buona`);
  });

  it('scarta le pagine client-rendered (solo shell, niente content-root)', async () => {
    const targets = [
      target('Rendered', `${BASE}/Rendered`, 12),
      target('Shell', `${BASE}/Shell`, 10),
    ];
    const fetchMock = vi.fn(async (url: string) =>
      url === targets[1].url ? shellResponse() : htmlResponse('Rendered', '<p>contenuto vero</p>'),
    );
    vi.stubGlobal('fetch', fetchMock);

    const pages = await shallowFollow(targets, 'contenuto', targets.length);

    expect(pages).toHaveLength(1);
    expect(pages[0].url).toBe(`${BASE}/Rendered`);
  });

  it('legge senza mai navigare: location.href resta invariato', async () => {
    const before = location.href;
    const targets = [target('Pagina', `${BASE}/Pagina`, 12)];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => htmlResponse('Pagina', '<p>testo</p>')),
    );

    await shallowFollow(targets, 'pagina rilevante', targets.length);

    expect(location.href).toBe(before);
  });
});
