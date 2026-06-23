// Provider factory: selects the AI provider from AI_PROVIDER (default 'mock').
// The rest of the backend depends only on the AiProvider interface, so flipping
// to the real provider is a one-line env change.
import type { AiProvider } from './shared.js';
import { MockProvider } from './mock.js';
import { AnthropicProvider } from './anthropic.js';

export type { AiProvider, GenerateInput } from './shared.js';
export { ANTHROPIC_EGRESS, ASSUMED_OUTPUT_TOKENS, buildSystemPrompt, buildUserContent } from './shared.js';

let cached: AiProvider | null = null;

export function getProvider(): AiProvider {
  if (cached) return cached;
  const kind = (process.env.AI_PROVIDER ?? 'mock').toLowerCase();
  cached = kind === 'anthropic' ? new AnthropicProvider() : new MockProvider();
  return cached;
}
