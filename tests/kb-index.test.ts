import { describe, expect, it, vi } from 'vitest';
import type { KbLink } from '../lib/outcome';

const BASE = 'https://kb.example.com/Runway/s/article';

function link(text: string, url: string, context?: string, order?: number): KbLink {
  return { text, url, context, order };
}

describe('pickCandidatesWithKbIndex — indice vuoto', () => {
  it('ricade su pickRelevantLinks quando l’indice è vuoto', async () => {
    // Indice vuoto esplicito (mock): deve comportarsi come lo scorer base.
    // NB: l'asset reale lib/kb-index.json è popolato, quindi il caso "vuoto" va
    // simulato con un mock per restare deterministico.
    vi.resetModules();
    vi.doMock('../lib/kb-index.json', () => ({
      default: { origin: '', count: 0, articles: [] },
    }));
    const { pickCandidatesWithKbIndex, pickRelevantLinks } = await import('../lib/crawl');
    const links = [
      link('Flight refund policy', `${BASE}/Flight-refund-policy`, 'refund for cancelled flights'),
      link('Company history', `${BASE}/History`),
    ];
    const query = 'come chiedo il rimborso del volo?';
    expect(pickCandidatesWithKbIndex(links, query).map((l) => l.url)).toEqual(
      pickRelevantLinks(links, query).map((l) => l.url),
    );
    vi.doUnmock('../lib/kb-index.json');
    vi.resetModules();
  });
});

describe('pickCandidatesWithKbIndex — indice popolato', () => {
  it('propone un articolo della KB non presente fra i link di pagina', async () => {
    // Indice con un articolo che NON è linkato nella pagina corrente.
    vi.resetModules();
    vi.doMock('../lib/kb-index.json', () => ({
      default: {
        origin: 'https://kb.example.com',
        count: 1,
        articles: [
          {
            u: `${BASE}/Flight-refund-policy-for-cancelled-flights?language=en_US`,
            s: 'Flight-refund-policy-for-cancelled-flights',
            l: 'Flight refund policy for cancelled flights',
          },
        ],
      },
    }));
    const { pickCandidatesWithKbIndex } = await import('../lib/crawl');

    // La pagina corrente ha solo link fuori tema.
    const pageLinks = [link('Company history', `${BASE}/History`, 'about the company')];
    const picked = pickCandidatesWithKbIndex(
      pageLinks,
      'come chiedo il rimborso del volo cancellato?',
    );
    expect(picked.some((l) => l.url.includes('Flight-refund-policy-for-cancelled-flights'))).toBe(
      true,
    );
    vi.doUnmock('../lib/kb-index.json');
    vi.resetModules();
  });

  it('non duplica un articolo già presente nella pagina (dedup per identità)', async () => {
    vi.resetModules();
    vi.doMock('../lib/kb-index.json', () => ({
      default: {
        origin: 'https://kb.example.com',
        count: 1,
        articles: [
          {
            // stesso articolo del link di pagina, ma con ?language → stessa identità
            u: `${BASE}/Flight-refund-policy?language=en_US`,
            s: 'Flight-refund-policy',
            l: 'Flight refund policy',
          },
        ],
      },
    }));
    const { pickCandidatesWithKbIndex } = await import('../lib/crawl');

    const pageLinks = [
      link('Flight refund policy', `${BASE}/Flight-refund-policy`, 'refund for cancelled flights'),
    ];
    const picked = pickCandidatesWithKbIndex(pageLinks, 'rimborso del volo', 5);
    const matches = picked.filter((l) => l.url.includes('Flight-refund-policy'));
    expect(matches).toHaveLength(1);
    vi.doUnmock('../lib/kb-index.json');
    vi.resetModules();
  });
});

describe('indice KB reale (asset bundle-ato)', () => {
  it('carica i 2.964 articoli e li espone come candidati', async () => {
    const { kbIndexSize, kbIndexAsLinks } = await import('../lib/kb-index');
    expect(kbIndexSize()).toBeGreaterThan(2_000);
    const links = kbIndexAsLinks();
    expect(links.length).toBe(kbIndexSize());
    expect(links.every((l) => l.url.startsWith('http') && l.text.length > 0)).toBe(true);
  });

  it('normalizza ogni candidato alla lingua di retrieval (en_US)', async () => {
    // ~1 articolo su 5 nella sitemap ha ?language non inglese: i candidati
    // esposti devono comunque puntare tutti alla variante en_US, così la
    // navigazione B2 non apre l'articolo in tedesco/coreano/…
    const { kbIndexAsLinks } = await import('../lib/kb-index');
    const links = kbIndexAsLinks();
    for (const l of links) {
      expect(new URL(l.url).searchParams.get('language')).toBe('en_US');
    }
  });

  it('una query IT su una pagina fuori tema pesca un articolo refund dalla KB reale', async () => {
    const { pickCandidatesWithKbIndex } = await import('../lib/crawl');
    // Pagina corrente senza link pertinenti: il candidato viene solo dall'indice.
    const pageLinks = [link('Company history', `${BASE}/History`, 'about the company')];
    const picked = pickCandidatesWithKbIndex(pageLinks, 'come chiedo il rimborso di un volo?');
    expect(picked.length).toBeGreaterThan(0);
    expect(picked.some((l) => /refund|flight/i.test(l.url))).toBe(true);
  });
});
