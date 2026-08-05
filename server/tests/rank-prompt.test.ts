// Reranker — helper PURI (Fase 1): costruzione prompt, parsing avversariale
// della risposta del modello, chiave di replay stabile. Nessuna rete/AI.
import { describe, expect, it } from 'vitest';
import {
  buildRankPrompt,
  parseRankSelection,
  rankReplayKey,
  candidateId,
  RANK_MAX_SELECTED,
} from '../src/provider/shared.js';
import { firstToolInput } from '../src/provider/anthropic.js';
import type { KbLink } from '../src/types.js';

const CANDIDATES: KbLink[] = [
  {
    url: 'https://traveler.my.site.com/Runway/s/article/Lufthansa-LH-airline-policies-1?language=en_US',
    text: 'Flight | Policies | Lufthansa (LH)—Global',
    context: 'Refund and cancellation policy',
    score: 20,
    order: 0,
  },
  {
    url: 'https://traveler.my.site.com/Runway/s/article/United-Airlines-UA-policies-2?language=en_US',
    text: 'Flight | Policies | United Airlines (UA)—Global',
    context: 'Baggage and change policy',
    score: 12,
    order: 1,
  },
  {
    url: 'https://traveler.my.site.com/Runway/s/article/Hotel-cancellation-3?language=en_US',
    text: 'Lodging | Cancellation',
    score: 5,
    order: 2,
  },
];

describe('candidateId', () => {
  it('assegna id 1-based c1..cN', () => {
    expect(candidateId(0)).toBe('c1');
    expect(candidateId(2)).toBe('c3');
  });
});

describe('buildRankPrompt', () => {
  it('elenca ogni candidato con il suo id e cita il quesito', () => {
    const { system, user } = buildRankPrompt({
      query: 'rimborso volo cancellato Lufthansa',
      candidates: CANDIDATES,
      model: 'claude-haiku-4-5',
    });
    expect(system).toContain('select_articles');
    expect(system).toContain(String(RANK_MAX_SELECTED));
    expect(user).toContain('QUESITO: rimborso volo cancellato Lufthansa');
    expect(user).toContain('c1 · Flight | Policies | Lufthansa');
    expect(user).toContain('c2 ·');
    expect(user).toContain('c3 ·');
    // Lo slug leggibile è incluso per aiutare il match cross-lingua.
    expect(user).toContain('Lufthansa-LH-airline-policies-1');
  });

  it('gestisce una lista vuota senza rompersi', () => {
    const { user } = buildRankPrompt({ query: 'x', candidates: [], model: 'm' });
    expect(user).toContain('(nessuno)');
  });
});

describe('parseRankSelection', () => {
  it('mappa gli id scelti agli URL, in ordine', () => {
    const sel = parseRankSelection({ selectedIds: ['c2', 'c1'] }, CANDIDATES, RANK_MAX_SELECTED);
    expect(sel).toEqual([CANDIDATES[1].url, CANDIDATES[0].url]);
  });

  it('scarta gli id inventati non presenti tra i candidati (anti-allucinazione)', () => {
    const sel = parseRankSelection(
      { selectedIds: ['c9', 'c1', 'nope'] },
      CANDIDATES,
      RANK_MAX_SELECTED,
    );
    expect(sel).toEqual([CANDIDATES[0].url]);
  });

  it('deduplica id/URL che puntano allo stesso articolo', () => {
    // c1 e l'URL di c1 con un diverso ?language → stessa identità → una volta sola.
    const dupUrl = CANDIDATES[0].url.replace('en_US', 'it');
    const sel = parseRankSelection({ selectedIds: ['c1', dupUrl] }, CANDIDATES, RANK_MAX_SELECTED);
    expect(sel).toEqual([CANDIDATES[0].url]);
  });

  it('taglia al massimo consentito', () => {
    const sel = parseRankSelection({ selectedIds: ['c1', 'c2', 'c3'] }, CANDIDATES, 2);
    expect(sel).toHaveLength(2);
    expect(sel).toEqual([CANDIDATES[0].url, CANDIDATES[1].url]);
  });

  it('vuoto/garbage → lista vuota (il chiamante fa fallback)', () => {
    expect(parseRankSelection({ selectedIds: [] }, CANDIDATES, 3)).toEqual([]);
    expect(parseRankSelection(null, CANDIDATES, 3)).toEqual([]);
    expect(parseRankSelection('non è json', CANDIDATES, 3)).toEqual([]);
    expect(parseRankSelection(42, CANDIDATES, 3)).toEqual([]);
  });

  it('tollera prosa attorno al JSON e un array grezzo', () => {
    expect(
      parseRankSelection('Ecco la scelta: ["c2","c1"] spero sia utile', CANDIDATES, 3),
    ).toEqual([CANDIDATES[1].url, CANDIDATES[0].url]);
    expect(
      parseRankSelection('prima un po di testo {"selectedIds":["c3"]} fine', CANDIDATES, 3),
    ).toEqual([CANDIDATES[2].url]);
  });

  it('accetta URL diretti solo se tra i candidati', () => {
    const sel = parseRankSelection(
      { selectedUrls: [CANDIDATES[1].url, 'https://evil.example.com/x'] },
      CANDIDATES,
      3,
    );
    expect(sel).toEqual([CANDIDATES[1].url]);
  });
});

describe('rankReplayKey', () => {
  it('è stabile e indipendente dall’ordine della shortlist', () => {
    const k1 = rankReplayKey('rimborso volo', CANDIDATES);
    const k2 = rankReplayKey('rimborso volo', [...CANDIDATES].reverse());
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{16}$/);
  });

  it('normalizza la query (spazi/maiuscole)', () => {
    expect(rankReplayKey('  Rimborso   Volo  ', CANDIDATES)).toBe(
      rankReplayKey('rimborso volo', CANDIDATES),
    );
  });

  it('cambia se cambia l’insieme dei candidati', () => {
    expect(rankReplayKey('x', CANDIDATES)).not.toBe(rankReplayKey('x', CANDIDATES.slice(0, 2)));
  });
});

// Il reranker reale forza `tool_choice` su select_articles, quindi la risposta è
// un blocco tool_use e non prosa. Questo è il pezzo che estrae l'input del tool;
// il resto della catena (parseRankSelection) è già coperto sopra.
describe('firstToolInput', () => {
  const toolBlock = (name: string, input: unknown) =>
    ({ type: 'tool_use', id: 'tu_1', name, input }) as never;
  const message = (content: unknown[]) => ({ content }) as never;

  it('estrae l’input del blocco select_articles', () => {
    expect(
      firstToolInput(message([toolBlock('select_articles', { selectedIds: ['c1'] })])),
    ).toEqual({ selectedIds: ['c1'] });
  });

  it('salta i blocchi di testo che precedono il tool', () => {
    const msg = message([
      { type: 'text', text: 'ecco la selezione' },
      toolBlock('select_articles', { selectedIds: ['c2', 'c3'] }),
    ]);
    expect(firstToolInput(msg)).toEqual({ selectedIds: ['c2', 'c3'] });
  });

  it('ignora un tool con nome diverso', () => {
    expect(
      firstToolInput(message([toolBlock('altro_tool', { selectedIds: ['c1'] })])),
    ).toBeUndefined();
  });

  it('ritorna undefined senza blocchi tool (→ selezione vuota, fallback locale)', () => {
    expect(firstToolInput(message([{ type: 'text', text: 'nessun tool' }]))).toBeUndefined();
    expect(parseRankSelection(undefined, CANDIDATES, RANK_MAX_SELECTED)).toEqual([]);
  });
});
