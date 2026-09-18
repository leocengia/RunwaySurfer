// Provider factory: selects the AI provider from AI_PROVIDER_KIND (config.ts,
// default 'mock'). The rest of the backend depends only on the AiProvider
// interface, so flipping provider is a one-line env change.
import type { AiProvider } from './shared.js';
import { ANTHROPIC_EGRESS, OPENROUTER_EGRESS } from './shared.js';
import { MockProvider } from './mock.js';
import { AnthropicProvider } from './anthropic.js';
import { OpenRouterProvider } from './openrouter.js';
import { AI_PROVIDER_KIND } from '../config.js';

export type {
  AiProvider,
  GenerateInput,
  StreamResult,
  SystemPromptOptions,
  TokenUsage,
} from './shared.js';
export {
  ANTHROPIC_EGRESS,
  OPENROUTER_EGRESS,
  ASSUMED_OUTPUT_TOKENS,
  buildSystemPrompt,
  buildUserContent,
  maxOutputTokens,
  outcomeSections,
  systemPromptOptionsFor,
} from './shared.js';

let cached: AiProvider | null = null;

export function getProvider(): AiProvider {
  if (cached) return cached;
  switch (AI_PROVIDER_KIND) {
    case 'anthropic':
      cached = new AnthropicProvider();
      break;
    case 'openrouter':
      cached = new OpenRouterProvider();
      break;
    default:
      cached = new MockProvider();
  }
  return cached;
}

/** Endpoint di rete raggiunto per il provider dato ('mock' non contatta nulla). */
export function egressFor(name: AiProvider['name']): string {
  if (name === 'anthropic') return ANTHROPIC_EGRESS;
  if (name === 'openrouter') return OPENROUTER_EGRESS;
  return 'none in mock mode';
}
