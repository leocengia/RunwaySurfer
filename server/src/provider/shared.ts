// Shared pieces for AI providers: the prompt construction, the egress endpoint,
// and the provider interface. Both the mock and the real Anthropic provider
// build the same prompt, so the demo's "would-be request" is faithful.
import type { KbPage, KbLink } from '../types.js';

/** The network endpoint the backend contacts for a real call — shown to the CED. */
export const ANTHROPIC_EGRESS = 'api.anthropic.com:443';

/** Conservative assumed output size for cost estimation. */
export const ASSUMED_OUTPUT_TOKENS = 600;

export interface GenerateInput {
  query: string;
  pages: KbPage[];
  links: KbLink[];
  model: string;
}

export interface AiProvider {
  readonly name: 'mock' | 'anthropic';
  /** Stream the operational outcome as markdown, chunk by chunk. */
  streamOutcome(
    input: GenerateInput,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}

/** System prompt: grounded, structured, final-answer-only (latency). */
export function buildSystemPrompt(): string {
  return [
    'Sei un assistente per agenti di call center. Rispondi in italiano.',
    'Usa ESCLUSIVAMENTE il contenuto della Knowledge Base fornito qui sotto.',
    'Se l\'informazione non è presente, dillo esplicitamente e suggerisci quali link',
    'collegati consultare. Non inventare procedure.',
    'Struttura SEMPRE la risposta in queste quattro sezioni markdown:',
    '## Procedura',
    '## Eccezioni',
    '## Risposta suggerita al cliente',
    '## Fonti  (elenca gli URL delle pagine effettivamente usate)',
    'Dai SOLO la risposta finale, senza ragionamento esposto.',
  ].join('\n');
}

/** User content: the query plus the KB pages and the nested-link map. */
export function buildUserContent(input: GenerateInput): string {
  const pages = input.pages
    .map(
      (p, i) =>
        `### Pagina ${i + 1} [${p.origin}] — ${p.title}\nURL: ${p.url}\n${p.text}`,
    )
    .join('\n\n');
  const links = input.links
    .slice(0, 30)
    .map((l) => `- ${l.text} → ${l.url}`)
    .join('\n');
  return [
    `RICHIESTA AGENTE: ${input.query}`,
    '',
    '=== CONTENUTO KB ===',
    pages,
    '',
    '=== LINK ANNIDATI DISPONIBILI ===',
    links || '(nessuno)',
  ].join('\n');
}
