// Cattura token reali (Passa 7 / A2): il provider reale deve esporre `usage`
// dal messaggio finale dell'SDK; il mock non chiama alcun modello e non riporta
// token, e l'assenza di `usage` non deve rompere il flusso.
import { describe, expect, it } from 'vitest';
import { usageFromMessage } from '../src/provider/anthropic.js';
import { MockProvider } from '../src/provider/mock.js';
import type { GenerateInput } from '../src/provider/shared.js';

const input: GenerateInput = {
  query: 'come cambio indirizzo?',
  pages: [
    {
      url: 'https://kb.example.com/wiki/Indirizzi',
      title: 'Indirizzi',
      text: 'Procedura per il cambio indirizzo.',
      origin: 'current',
    },
  ],
  links: [],
  model: 'claude-haiku-4-5',
};

describe('usageFromMessage', () => {
  it('mappa input_tokens/output_tokens reali quando presenti', () => {
    expect(usageFromMessage({ usage: { input_tokens: 1200, output_tokens: 340 } })).toEqual({
      inputTokens: 1200,
      outputTokens: 340,
    });
  });

  it('degrada a undefined se usage manca o non è numerico', () => {
    expect(usageFromMessage({})).toBeUndefined();
    expect(usageFromMessage({ usage: null })).toBeUndefined();
    expect(usageFromMessage({ usage: { input_tokens: 10 } })).toBeUndefined();
    expect(
      usageFromMessage({ usage: { input_tokens: null, output_tokens: null } }),
    ).toBeUndefined();
  });
});

describe('MockProvider', () => {
  it('streamma testo ma non riporta token reali (usage assente)', async () => {
    const provider = new MockProvider();
    let streamed = '';
    const result = await provider.streamOutcome(input, (text) => {
      streamed += text;
    });
    expect(streamed.length).toBeGreaterThan(0);
    // Nessun modello reale chiamato → nessun token da riportare: il flusso regge.
    expect(result.usage).toBeUndefined();
  });

  it('si interrompe pulito su abort senza usage', async () => {
    const provider = new MockProvider();
    const controller = new AbortController();
    controller.abort();
    const result = await provider.streamOutcome(input, () => {}, controller.signal);
    expect(result.usage).toBeUndefined();
  });
});
