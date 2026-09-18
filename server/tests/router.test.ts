import { describe, expect, it } from 'vitest';
import { ANTHROPIC_MODELS, chooseTier, estimateTokens, estimateCostUsd } from '../src/router.js';
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

describe('chooseTier', () => {
  it('sceglie la fascia economica per 1 pagina piccola e query corta', () => {
    const { tier, reason } = chooseTier(req([{ chars: 2000 }]));
    expect(tier).toBe('cheap');
    expect(ANTHROPIC_MODELS[tier].id).toBe(ANTHROPIC_MODELS.cheap.id);
    expect(reason).toContain('semplice');
  });

  it('sceglie la fascia bilanciata per 2 pagine di contesto medio', () => {
    const { tier } = chooseTier(req([{ chars: 6000 }, { chars: 6000 }]));
    expect(tier).toBe('balanced');
  });

  it('sceglie la fascia più capace per contesti grandi/multi-pagina', () => {
    const { tier } = chooseTier(req([{ chars: 9000 }, { chars: 9000 }, { chars: 2000 }]));
    expect(tier).toBe('capable');
  });

  it('un follow di più pagine ma con contesto piccolo NON va sulla fascia capace (profilo KB post-E2)', () => {
    // Baseline reale Passa 7: dopo E2 anche un follow di 3-4 pagine porta solo
    // ~8-12k char (~2-3k token). Non è "sintesi grande" → resta balanced, non capable.
    const { tier } = chooseTier(
      req([{ chars: 3000 }, { chars: 3000 }, { chars: 3000 }, { chars: 3000 }]),
    );
    expect(tier).toBe('balanced');
  });

  it('una pagina singola piena (fino al cap ~6k char) resta sulla fascia economica', () => {
    // MAX_PAGE_CHARS = 6.000: una pagina piena non deve scattare su balanced
    // solo perché sfiora il vecchio limite di 6.000.
    const { tier } = chooseTier(req([{ chars: 6000 }]));
    expect(tier).toBe('cheap');
  });

  it('una query lunga esclude la fascia economica anche su pagina singola', () => {
    const longQuery = 'parola '.repeat(40); // > 40 token stimati
    const { tier } = chooseTier(req([{ chars: 1000 }], longQuery));
    expect(tier).toBe('balanced');
  });

  it("l'euristica di difficoltà non dipende dal registro modelli attivo", () => {
    // chooseTier() non guarda MAI ANTHROPIC_MODELS/MODEL_REGISTRY: decide solo la
    // fascia dalla forma della richiesta. Questa è l'invarianza che rende sicuro
    // sostituire il modello concreto (env MODEL_*) senza toccare il router.
    const a = chooseTier(req([{ chars: 2000 }]));
    const b = chooseTier(req([{ chars: 2000 }]));
    expect(a.tier).toBe(b.tier);
    expect(a.tier).toBe('cheap');
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
