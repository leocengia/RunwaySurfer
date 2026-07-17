import { describe, expect, it, vi } from 'vitest';
import type { KbLink } from '../lib/outcome';

const BASE = 'https://kb.example.com/Runway/s/article';

function link(text: string, url: string, context?: string, order?: number): KbLink {
  return { text, url, context, order };
}

describe('pickCandidatesWithKbIndex — indice vuoto (placeholder)', () => {
  it('ricade su pickRelevantLinks quando l’indice è vuoto', async () => {
    // Con il placeholder (articles: []) deve comportarsi come lo scorer base.
    const { pickCandidatesWithKbIndex, pickRelevantLinks } = await import('../lib/crawl');
    const links = [
      link('Flight refund policy', `${BASE}/Flight-refund-policy`, 'refund for cancelled flights'),
      link('Company history', `${BASE}/History`),
    ];
    const query = 'come chiedo il rimborso del volo?';
    expect(pickCandidatesWithKbIndex(links, query).map((l) => l.url)).toEqual(
      pickRelevantLinks(links, query).map((l) => l.url),
    );
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
