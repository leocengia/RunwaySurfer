// AnthropicProvider — the real provider, used when AI_PROVIDER=anthropic and an
// ANTHROPIC_API_KEY is configured. Not exercised in the demo (mock is default);
// enabling it requires the purchased token plan to be in place.
//
// Latency techniques applied here:
//  - streaming (low time-to-first-token);
//  - prompt caching on the stable system prefix (cheap, fast follow-ups);
//  - thinking omitted (= disattivato sui modelli usati) + effort low dove supportato.
import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, GenerateInput } from './shared.js';
import { buildSystemPrompt, buildUserContent } from './shared.js';

// Models that accept the `effort` parameter (Haiku 4.5 does not).
const EFFORT_MODELS = new Set(['claude-sonnet-4-6', 'claude-opus-4-8']);

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  async streamOutcome(
    input: GenerateInput,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    // Parametri tipizzati contro l'SDK: se una futura major cambia la forma
    // della richiesta, `npm run compile` fallisce invece di rompersi a runtime.
    const params: Anthropic.MessageStreamParams = {
      model: input.model,
      max_tokens: Math.min(900, Math.max(400, 320 + input.pages.length * 120)),
      system: [
        {
          type: 'text',
          text: buildSystemPrompt(),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [{ role: 'user', content: buildUserContent(input) }],
      // `thinking` omesso di proposito: sui modelli usati dal router il default
      // è "nessun thinking", che è ciò che vogliamo per la latenza.
    };
    if (EFFORT_MODELS.has(input.model)) {
      params.output_config = { effort: 'low' };
    }

    const stream = this.client.messages.stream(params);
    stream.on('text', (delta: string) => onDelta(delta));
    signal?.addEventListener('abort', () => stream.abort());
    await stream.finalMessage();
  }
}
