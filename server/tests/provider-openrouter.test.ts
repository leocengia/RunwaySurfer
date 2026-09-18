// Pure helpers di OpenRouterProvider — nessun mock dell'SDK: stesso stile di
// tests/provider.test.ts (anthropic), riletto sul vocabolario Chat Completions
// (prompt_tokens/completion_tokens, finish_reason, tool_calls[].function.arguments).
import { describe, expect, it } from 'vitest';
import {
  assertToolCallPresent,
  firstToolCallArguments,
  truncatedFromCompletion,
  usageFromCompletion,
  OpenRouterProvider,
} from '../src/provider/openrouter.js';
import { parseRankSelection } from '../src/provider/shared.js';
import type { KbLink } from '../src/types.js';

// L'SDK `openai` valida la presenza di apiKey al COSTRUTTORE (a differenza di
// @anthropic-ai/sdk, che è più permissivo): serve una chiave, anche finta, per
// poter istanziare OpenRouterProvider nei test senza fare rete.
process.env.OPENROUTER_API_KEY ??= 'sk-or-test-fake-key';

describe('usageFromCompletion', () => {
  it('mappa prompt_tokens/completion_tokens reali quando presenti', () => {
    expect(usageFromCompletion({ usage: { prompt_tokens: 1200, completion_tokens: 340 } })).toEqual(
      { inputTokens: 1200, outputTokens: 340 },
    );
  });

  it('degrada a undefined se usage manca o non è numerico', () => {
    expect(usageFromCompletion({})).toBeUndefined();
    expect(usageFromCompletion({ usage: null })).toBeUndefined();
    expect(usageFromCompletion({ usage: { prompt_tokens: 10 } })).toBeUndefined();
    expect(
      usageFromCompletion({ usage: { prompt_tokens: null, completion_tokens: null } }),
    ).toBeUndefined();
  });
});

describe('truncatedFromCompletion', () => {
  it("riconosce il taglio: solo finish_reason === 'length' è un taglio", () => {
    expect(truncatedFromCompletion({ choices: [{ finish_reason: 'length' }] })).toBe(true);
  });

  it('una risposta finita non è tagliata', () => {
    expect(truncatedFromCompletion({ choices: [{ finish_reason: 'stop' }] })).toBe(false);
  });

  it('una tool call non è un taglio', () => {
    expect(truncatedFromCompletion({ choices: [{ finish_reason: 'tool_calls' }] })).toBe(false);
  });

  it('assente o senza scelte non viene interpretato come guasto', () => {
    expect(truncatedFromCompletion({})).toBe(false);
    expect(truncatedFromCompletion({ choices: [] })).toBe(false);
  });
});

describe('firstToolCallArguments', () => {
  it('estrae gli argomenti (stringa JSON) della tool call select_articles', () => {
    const completion = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: { name: 'select_articles', arguments: '{"selectedIds":["c1","c2"]}' },
              },
            ],
          },
        },
      ],
    };
    expect(firstToolCallArguments(completion)).toBe('{"selectedIds":["c1","c2"]}');
  });

  it('undefined se non ci sono tool call, o se sono di un altro strumento', () => {
    expect(firstToolCallArguments({})).toBeUndefined();
    expect(firstToolCallArguments({ choices: [{ message: {} }] })).toBeUndefined();
    expect(
      firstToolCallArguments({
        choices: [
          {
            message: {
              tool_calls: [{ type: 'function', function: { name: 'altro', arguments: '{}' } }],
            },
          },
        ],
      }),
    ).toBeUndefined();
  });

  it('ignora una tool call custom (nessun campo function)', () => {
    expect(
      firstToolCallArguments({
        choices: [{ message: { tool_calls: [{ type: 'custom' }] } }],
      }),
    ).toBeUndefined();
  });

  it('gli argomenti estratti sono utilizzabili direttamente da parseRankSelection', () => {
    const candidates: KbLink[] = [
      { url: 'https://kb.example.com/a', text: 'A' },
      { url: 'https://kb.example.com/b', text: 'B' },
    ];
    const completion = {
      choices: [
        {
          message: {
            tool_calls: [
              {
                type: 'function',
                function: { name: 'select_articles', arguments: '{"selectedIds":["c2"]}' },
              },
            ],
          },
        },
      ],
    };
    const urls = parseRankSelection(firstToolCallArguments(completion), candidates, 3);
    expect(urls).toEqual(['https://kb.example.com/b']);
  });
});

describe('assertToolCallPresent', () => {
  it('non lancia quando è presente almeno una tool call', () => {
    expect(() =>
      assertToolCallPresent({
        choices: [{ message: { tool_calls: [{}] } }],
      }),
    ).not.toThrow();
  });

  it('lancia quando il modello ignora il tool_choice forzato (nessuna tool call)', () => {
    expect(() => assertToolCallPresent({})).toThrow();
    expect(() => assertToolCallPresent({ choices: [{ message: {} }] })).toThrow();
    expect(() => assertToolCallPresent({ choices: [{ message: { tool_calls: [] } }] })).toThrow();
  });
});

describe('OpenRouterProvider', () => {
  it('si costruisce senza contattare la rete (nessuna chiamata alla sola istanziazione)', () => {
    expect(() => new OpenRouterProvider()).not.toThrow();
  });

  it("espone name === 'openrouter'", () => {
    expect(new OpenRouterProvider().name).toBe('openrouter');
  });

  it('rankCandidates senza candidati ritorna subito lista vuota, senza chiamare il client', async () => {
    const provider = new OpenRouterProvider();
    const result = await provider.rankCandidates({ query: 'q', candidates: [], model: 'x' });
    expect(result).toEqual({ selectedUrls: [] });
  });
});

describe('getProvider() factory · AI_PROVIDER=openrouter', () => {
  // AI_PROVIDER si legge all'import di config.ts: l'ambiente va impostato PRIMA
  // di importare provider/index.js (stesso schema di tests/cors.test.ts).
  it('sceglie OpenRouterProvider senza contattare la rete alla sola costruzione', async () => {
    process.env.AI_PROVIDER = 'openrouter';
    process.env.OPENROUTER_API_KEY = 'sk-or-test-fake-key';
    const { getProvider } = await import('../src/provider/index.js');
    const provider = getProvider();
    expect(provider).toBeInstanceOf(OpenRouterProvider);
    expect(provider.name).toBe('openrouter');
  });
});
