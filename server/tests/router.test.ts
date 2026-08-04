import { describe, expect, it } from 'vitest';
import { MODELS, chooseModel, estimateTokens, estimateCostUsd } from '../src/router.js';
import type { AskRequest } from '../src/types.js';

function req(pages: Array<{ chars: number }>, query = 'come cambio indirizzo?'): AskRequest {
  return {
    query,
    pages: pages.map((p, i) => ({
      url: `https://kb.example.com/p${i}`,
      title: `Pagina ${i}`,
      text: 'x'.repeat(p.chars),
      origin: i === 0 ? 'current' : 'followed',
    })),
    links: [],
  };
}

describe('estimateTokens', () => {
  it('usa ~4 caratteri per token, arrotondando per eccesso', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('x'.repeat(4000))).toBe(1000);
  });
});

describe('chooseModel', () => {
  it('sceglie il modello economico per 1 pagina piccola e query corta', () => {
    const { spec, reason } = chooseModel(req([{ chars: 2000 }]));
    expect(spec.id).toBe(MODELS.haiku.id);
    expect(reason).toContain('semplice');
  });

  it('sceglie il modello bilanciato per 2 pagine di contesto medio', () => {
    const { spec } = chooseModel(req([{ chars: 6000 }, { chars: 6000 }]));
    expect(spec.id).toBe(MODELS.sonnet.id);
  });

  it('sceglie il modello più capace per contesti grandi/multi-pagina', () => {
    const { spec } = chooseModel(req([{ chars: 9000 }, { chars: 9000 }, { chars: 2000 }]));
    expect(spec.id).toBe(MODELS.opus.id);
  });

  it('un follow di più pagine ma con contesto piccolo NON va su opus (profilo KB post-E2)', () => {
    // Baseline reale Passa 7: dopo E2 anche un follow di 3-4 pagine porta solo
    // ~8-12k char (~2-3k token). Non è "sintesi grande" → resta sonnet, non opus.
    const { spec } = chooseModel(req([{ chars: 3000 }, { chars: 3000 }, { chars: 3000 }, { chars: 3000 }]));
    expect(spec.id).toBe(MODELS.sonnet.id);
  });

  it('una pagina singola piena (fino al cap ~6k char) resta sul modello economico', () => {
    // MAX_PAGE_CHARS = 6.000: una pagina piena non deve scattare su sonnet solo
    // perché sfiora il vecchio limite di 6.000.
    const { spec } = chooseModel(req([{ chars: 6000 }]));
    expect(spec.id).toBe(MODELS.haiku.id);
  });

  it('una query lunga esclude il modello economico anche su pagina singola', () => {
    const longQuery = 'parola '.repeat(40); // > 40 token stimati
    const { spec } = chooseModel(req([{ chars: 1000 }], longQuery));
    expect(spec.id).toBe(MODELS.sonnet.id);
  });
});

describe('estimateCostUsd', () => {
  it('somma costo input e output alle tariffe per milione di token', () => {
    const spec = { id: 'm', inputPerMTok: 1, outputPerMTok: 5 };
    expect(estimateCostUsd(spec, 1_000_000, 0)).toBeCloseTo(1);
    expect(estimateCostUsd(spec, 0, 1_000_000)).toBeCloseTo(5);
    expect(estimateCostUsd(spec, 500_000, 100_000)).toBeCloseTo(0.5 + 0.5);
  });
});
