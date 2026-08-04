// Cattura token reali (Passa 7 / A2): il provider reale deve esporre `usage`
// dal messaggio finale dell'SDK; il mock non chiama alcun modello e non riporta
// token, e l'assenza di `usage` non deve rompere il flusso.
import { describe, expect, it } from 'vitest';
import { usageFromMessage } from '../src/provider/anthropic.js';
import { MockProvider } from '../src/provider/mock.js';
import type { GenerateInput, RankInput } from '../src/provider/shared.js';
import type { KbLink } from '../src/types.js';

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

describe('MockProvider.rankCandidates', () => {
  const candidates: KbLink[] = [
    { url: 'https://kb.example.com/a?language=en_US', text: 'A', score: 8, order: 2 },
    { url: 'https://kb.example.com/b?language=en_US', text: 'B', score: 20, order: 0 },
    { url: 'https://kb.example.com/c?language=en_US', text: 'C', score: 14, order: 1 },
    { url: 'https://kb.example.com/d?language=en_US', text: 'D', score: 3, order: 3 },
  ];
  const rankInput: RankInput = { query: 'q', candidates, model: 'claude-haiku-4-5' };

  it('ordina per score locale desc e ritorna i primi K (deterministico, no AI)', async () => {
    const provider = new MockProvider();
    const { selectedUrls, usage } = await provider.rankCandidates(rankInput);
    // B(20) > C(14) > A(8) > D(3) → i primi 3.
    expect(selectedUrls).toEqual([candidates[1].url, candidates[2].url, candidates[0].url]);
    expect(usage).toBeUndefined();
  });

  it('è stabile (stesso input → stesso output)', async () => {
    const provider = new MockProvider();
    const a = await provider.rankCandidates(rankInput);
    const b = await provider.rankCandidates(rankInput);
    expect(a.selectedUrls).toEqual(b.selectedUrls);
  });
});
