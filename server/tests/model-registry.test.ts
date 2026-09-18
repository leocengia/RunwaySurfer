// resolveModelRegistry è pura (env esplicito, nessun process.env letto qui):
// nessun dynamic import né mutazione di process.env necessaria, a differenza di
// altri test di configurazione (vedi tests/cors.test.ts).
import { describe, expect, it } from 'vitest';
import { resolveModelRegistry } from '../src/model-registry.js';
import { ANTHROPIC_MODELS, chooseTier } from '../src/router.js';
import type { AskRequest } from '../src/types.js';

describe('resolveModelRegistry · default (mock/anthropic)', () => {
  it('senza nessuna env MODEL_*, i tre modelli sono esattamente ANTHROPIC_MODELS', () => {
    const { registry, errors } = resolveModelRegistry({}, 'anthropic');
    expect(errors).toEqual([]);
    expect(registry.cheap).toEqual(ANTHROPIC_MODELS.cheap);
    expect(registry.balanced).toEqual(ANTHROPIC_MODELS.balanced);
    expect(registry.capable).toEqual(ANTHROPIC_MODELS.capable);
  });

  it("il reranker eredita lo slot 'cheap' già risolto quando RANK_MODEL non è impostata", () => {
    const { registry, errors } = resolveModelRegistry({}, 'mock');
    expect(errors).toEqual([]);
    expect(registry.rerank).toEqual(registry.cheap);
  });

  it("provider 'mock' non richiede nessuna env MODEL_*", () => {
    const { errors } = resolveModelRegistry({}, 'mock');
    expect(errors).toEqual([]);
  });
});

describe('resolveModelRegistry · openrouter obbligatorio', () => {
  it('senza nessuna env MODEL_*, produce 3 errori nominati (uno per fascia)', () => {
    const { errors, registry } = resolveModelRegistry({}, 'openrouter');
    expect(errors).toHaveLength(3);
    expect(errors.some((e) => e.includes('MODEL_CHEAP'))).toBe(true);
    expect(errors.some((e) => e.includes('MODEL_BALANCED'))).toBe(true);
    expect(errors.some((e) => e.includes('MODEL_CAPABLE'))).toBe(true);
    // Anche in errore torna sempre un registro utilizzabile (i default Anthropic).
    expect(registry.cheap).toEqual(ANTHROPIC_MODELS.cheap);
  });

  it('con le tre fasce configurate per intero, nessun errore e i modelli sono quelli dichiarati', () => {
    const env = {
      MODEL_CHEAP: 'openai/gpt-5-mini',
      MODEL_CHEAP_INPUT_PER_MTOK: '0.25',
      MODEL_CHEAP_OUTPUT_PER_MTOK: '2',
      MODEL_BALANCED: 'google/gemini-3-pro',
      MODEL_BALANCED_INPUT_PER_MTOK: '1.25',
      MODEL_BALANCED_OUTPUT_PER_MTOK: '10',
      MODEL_CAPABLE: 'anthropic/claude-opus-4-8',
      MODEL_CAPABLE_INPUT_PER_MTOK: '5',
      MODEL_CAPABLE_OUTPUT_PER_MTOK: '25',
    };
    const { registry, errors } = resolveModelRegistry(env, 'openrouter');
    expect(errors).toEqual([]);
    expect(registry.cheap).toEqual({
      id: 'openai/gpt-5-mini',
      inputPerMTok: 0.25,
      outputPerMTok: 2,
    });
    expect(registry.balanced.id).toBe('google/gemini-3-pro');
    expect(registry.capable.id).toBe('anthropic/claude-opus-4-8');
    // RANK_MODEL non impostata → eredita 'cheap' GIÀ RISOLTO (il modello
    // OpenRouter scelto), non un Claude cablato.
    expect(registry.rerank).toEqual(registry.cheap);
  });

  it('id impostato senza i prezzi (o viceversa) è un errore: mezza configurazione non è un default', () => {
    const { errors: onlyId } = resolveModelRegistry(
      {
        MODEL_CHEAP: 'openai/gpt-5-mini',
        MODEL_BALANCED: 'x',
        MODEL_BALANCED_INPUT_PER_MTOK: '1',
        MODEL_BALANCED_OUTPUT_PER_MTOK: '1',
        MODEL_CAPABLE: 'x',
        MODEL_CAPABLE_INPUT_PER_MTOK: '1',
        MODEL_CAPABLE_OUTPUT_PER_MTOK: '1',
      },
      'openrouter',
    );
    expect(onlyId.some((e) => e.includes('MODEL_CHEAP') && e.includes('INSIEME'))).toBe(true);

    const { errors: onlyPrices } = resolveModelRegistry(
      {
        MODEL_CHEAP_INPUT_PER_MTOK: '1',
        MODEL_BALANCED: 'x',
        MODEL_BALANCED_INPUT_PER_MTOK: '1',
        MODEL_BALANCED_OUTPUT_PER_MTOK: '1',
        MODEL_CAPABLE: 'x',
        MODEL_CAPABLE_INPUT_PER_MTOK: '1',
        MODEL_CAPABLE_OUTPUT_PER_MTOK: '1',
      },
      'openrouter',
    );
    expect(onlyPrices.some((e) => e.includes('MODEL_CHEAP') && e.includes('INSIEME'))).toBe(true);
  });

  it('prezzo 0 è valido (modelli gratuiti del catalogo); negativo o non numerico è un errore', () => {
    const base = {
      MODEL_CHEAP: 'free/model',
      MODEL_BALANCED: 'x',
      MODEL_BALANCED_INPUT_PER_MTOK: '1',
      MODEL_BALANCED_OUTPUT_PER_MTOK: '1',
      MODEL_CAPABLE: 'x',
      MODEL_CAPABLE_INPUT_PER_MTOK: '1',
      MODEL_CAPABLE_OUTPUT_PER_MTOK: '1',
    };
    const zero = resolveModelRegistry(
      { ...base, MODEL_CHEAP_INPUT_PER_MTOK: '0', MODEL_CHEAP_OUTPUT_PER_MTOK: '0' },
      'openrouter',
    );
    expect(zero.errors).toEqual([]);
    expect(zero.registry.cheap).toEqual({ id: 'free/model', inputPerMTok: 0, outputPerMTok: 0 });

    const negative = resolveModelRegistry(
      { ...base, MODEL_CHEAP_INPUT_PER_MTOK: '-1', MODEL_CHEAP_OUTPUT_PER_MTOK: '0' },
      'openrouter',
    );
    expect(negative.errors.some((e) => e.includes('MODEL_CHEAP_INPUT_PER_MTOK'))).toBe(true);

    const notNumeric = resolveModelRegistry(
      { ...base, MODEL_CHEAP_INPUT_PER_MTOK: 'abc', MODEL_CHEAP_OUTPUT_PER_MTOK: '0' },
      'openrouter',
    );
    expect(notNumeric.errors.some((e) => e.includes('MODEL_CHEAP_INPUT_PER_MTOK'))).toBe(true);
  });

  it('RANK_MODEL può essere impostata da sola (slot lenient): id senza prezzi è tollerato', () => {
    const env = {
      MODEL_CHEAP: 'openai/gpt-5-mini',
      MODEL_CHEAP_INPUT_PER_MTOK: '0.25',
      MODEL_CHEAP_OUTPUT_PER_MTOK: '2',
      MODEL_BALANCED: 'x',
      MODEL_BALANCED_INPUT_PER_MTOK: '1',
      MODEL_BALANCED_OUTPUT_PER_MTOK: '1',
      MODEL_CAPABLE: 'x',
      MODEL_CAPABLE_INPUT_PER_MTOK: '1',
      MODEL_CAPABLE_OUTPUT_PER_MTOK: '1',
      RANK_MODEL: 'meta/llama-cheap-experiment',
    };
    const { registry, errors } = resolveModelRegistry(env, 'openrouter');
    expect(errors).toEqual([]);
    // Prezzo approssimato dal fallback (lo slot 'cheap' già risolto).
    expect(registry.rerank).toEqual({
      id: 'meta/llama-cheap-experiment',
      inputPerMTok: 0.25,
      outputPerMTok: 2,
    });
  });
});

describe('indipendenza chooseTier() / registro modelli', () => {
  it('la scelta della fascia non dipende in alcun modo dal registro modelli attivo', () => {
    const req: AskRequest = {
      query: 'breve',
      pages: [
        { url: 'https://kb.example.com/a', title: 'A', text: 'x'.repeat(2000), origin: 'current' },
      ],
      links: [],
    };
    // chooseTier() non prende il registro come argomento: qualunque MODEL_REGISTRY
    // sia stato risolto (Anthropic di default o OpenRouter via env), la fascia
    // scelta per la STESSA richiesta è sempre la stessa.
    const { tier } = chooseTier(req);
    expect(tier).toBe('cheap');
  });
});
