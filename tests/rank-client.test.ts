// Fase 4 — client `rankCandidates`: parsing della selezione + fallback silenzioso
// (null) su 401 / non-ok / errore di rete, così App ricade sullo scoring locale.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { rankCandidates } from '../lib/client';
import type { RankRequest } from '../lib/outcome';

const REQUEST: RankRequest = {
  query: 'rimborso volo',
  candidates: [
    { url: 'https://kb.example.com/Runway/s/article/A?language=en_US', text: 'A', score: 9 },
    { url: 'https://kb.example.com/Runway/s/article/B?language=en_US', text: 'B', score: 4 },
  ],
};

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('rankCandidates', () => {
  it('ritorna la RankResponse con gli URL scelti', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          selectedUrls: [REQUEST.candidates[0].url],
          model: 'claude-haiku-4-5',
          provider: 'mock',
        }),
      ),
    );
    const res = await rankCandidates('http://proxy.test/', REQUEST);
    expect(res?.selectedUrls).toEqual([REQUEST.candidates[0].url]);
    expect(res?.provider).toBe('mock');
  });

  it('null su 401 (il login lo gestisce la /ask successiva)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'unauthorized' }, { status: 401 })),
    );
    expect(await rankCandidates('http://proxy.test/', REQUEST)).toBeNull();
  });

  it('null su status non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    expect(await rankCandidates('http://proxy.test/', REQUEST)).toBeNull();
  });

  it('null se il backend è irraggiungibile (errore di rete)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    expect(await rankCandidates('http://proxy.test/', REQUEST)).toBeNull();
  });

  it('null se il corpo non ha selectedUrls (forma inattesa)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ nope: true })),
    );
    expect(await rankCandidates('http://proxy.test/', REQUEST)).toBeNull();
  });

  it('POSTa su /rank e invia il bearer token', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ selectedUrls: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await rankCandidates('http://proxy.test', REQUEST, undefined, 'tok123');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://proxy.test/rank');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
    expect(init.method).toBe('POST');
  });
});
