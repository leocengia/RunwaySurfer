// Fase 2 — shortlist locale ampia per il reranker + rimappatura selezione→link.
// `shortlistCandidates` deve GARANTIRE il recall (l'articolo giusto in lista),
// non sceglierlo. `resolveFollowLinks` è puro e gestisce il fallback.
import { describe, expect, it, vi } from 'vitest';
import type { KbLink } from '../lib/outcome';

const BASE = 'https://kb.example.com/Runway/s/article';

function link(text: string, url: string, context?: string, order?: number): KbLink {
  return { text, url, context, order };
}

describe('shortlistCandidates', () => {
  it('unisce link di pagina + indice KB e tiene un articolo debole ma corretto (recall)', async () => {
    vi.resetModules();
    vi.doMock('../lib/kb-index.json', () => ({
      default: {
        origin: 'https://kb.example.com',
        count: 3,
        articles: [
          // Pertinente ma debole: solo lo slug tocca "refund" (1 hit URL).
          { u: `${BASE}/Refund-basics?language=en_US`, s: 'Refund-basics', l: 'Basics' },
          { u: `${BASE}/Baggage-allowance?language=en_US`, s: 'Baggage-allowance', l: 'Baggage' },
          { u: `${BASE}/Seat-selection?language=en_US`, s: 'Seat-selection', l: 'Seat' },
        ],
      },
    }));
    const { shortlistCandidates } = await import('../lib/crawl');
    const pageLinks = [link('Company history', `${BASE}/History`, 'about the company')];
    const shortlist = shortlistCandidates(pageLinks, 'come chiedo il rimborso del volo?');
    // L'articolo debole "Refund-basics" (label generica "Basics") è comunque presente:
    // niente gate MIN_SELECTED_SCORE che lo eliminerebbe.
    expect(shortlist.some((l) => l.url.includes('Refund-basics'))).toBe(true);
    vi.doUnmock('../lib/kb-index.json');
    vi.resetModules();
  });

  it('rispetta il cap di dimensione e ordina per score desc', async () => {
    vi.resetModules();
    const articles = Array.from({ length: 50 }, (_, i) => ({
      u: `${BASE}/Refund-topic-${i}?language=en_US`,
      s: `Refund-topic-${i}`,
      l: `Refund topic ${i}`,
    }));
    vi.doMock('../lib/kb-index.json', () => ({
      default: { origin: 'https://kb.example.com', count: articles.length, articles },
    }));
    const { shortlistCandidates } = await import('../lib/crawl');
    const shortlist = shortlistCandidates([], 'rimborso refund', 30);
    expect(shortlist.length).toBeLessThanOrEqual(30);
    const scores = shortlist.map((l) => l.score ?? 0);
    // Ordinamento non crescente.
    for (let i = 1; i < scores.length; i++) expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
    // Arricchiti: score presente.
    expect(shortlist.every((l) => typeof l.score === 'number')).toBe(true);
    vi.doUnmock('../lib/kb-index.json');
    vi.resetModules();
  });

  it('cross-lingua: una query IT porta in shortlist un articolo EN (refund)', async () => {
    vi.resetModules();
    vi.doMock('../lib/kb-index.json', () => ({
      default: {
        origin: 'https://kb.example.com',
        count: 2,
        articles: [
          { u: `${BASE}/Flight-refund-policy?language=en_US`, s: 'Flight-refund-policy', l: 'Flight refund policy' },
          { u: `${BASE}/Check-in-online?language=en_US`, s: 'Check-in-online', l: 'Online check-in' },
        ],
      },
    }));
    const { shortlistCandidates } = await import('../lib/crawl');
    const shortlist = shortlistCandidates([], 'come ottengo il rimborso di un volo cancellato?');
    expect(shortlist[0]?.url).toContain('Flight-refund-policy');
    vi.doUnmock('../lib/kb-index.json');
    vi.resetModules();
  });
});

describe('resolveFollowLinks', () => {
  const shortlist: KbLink[] = [
    { url: `${BASE}/A?language=en_US`, text: 'A', score: 9 },
    { url: `${BASE}/B?language=en_US`, text: 'B', score: 7 },
    { url: `${BASE}/C?language=en_US`, text: 'C', score: 5 },
  ];
  const fallback: KbLink[] = [{ url: `${BASE}/FB`, text: 'Fallback', score: 3 }];

  it('mappa gli URL scelti ai KbLink arricchiti della shortlist, in ordine', async () => {
    const { resolveFollowLinks } = await import('../lib/crawl');
    const out = resolveFollowLinks(shortlist, [`${BASE}/B?language=en_US`, `${BASE}/A?language=en_US`], fallback);
    expect(out.map((l) => l.text)).toEqual(['B', 'A']);
    expect(out.every((l) => typeof l.score === 'number')).toBe(true);
  });

  it('deduplica per identità (varianti ?language dello stesso articolo)', async () => {
    const { resolveFollowLinks } = await import('../lib/crawl');
    const out = resolveFollowLinks(shortlist, [`${BASE}/A?language=en_US`, `${BASE}/A?language=it`], fallback);
    expect(out.map((l) => l.text)).toEqual(['A']);
  });

  it('selezione vuota → fallback locale', async () => {
    const { resolveFollowLinks } = await import('../lib/crawl');
    expect(resolveFollowLinks(shortlist, [], fallback)).toBe(fallback);
  });

  it('URL tutti sconosciuti alla shortlist → fallback locale', async () => {
    const { resolveFollowLinks } = await import('../lib/crawl');
    expect(resolveFollowLinks(shortlist, ['https://evil.example.com/x'], fallback)).toBe(fallback);
  });
});
