// MockProvider — the default for the demo. It does NOT call any AI model; it
// synthesizes a plausible, structured outcome from the provided KB pages and
// streams it word-by-word so the sidebar shows the real streaming UX.
//
// This lets the team demo the full architecture (and the CED see the backend's
// server/network requirements) before AI licenses/tokens are sorted out.
// Switching AI_PROVIDER=anthropic swaps in the real provider with no other
// changes.
import type { AiProvider, GenerateInput } from './shared.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildOutcome(input: GenerateInput): string {
  const primary = input.pages[0];
  const sources = input.pages.map((p) => `- ${p.title}: ${p.url}`).join('\n');
  const titles = input.pages.map((p) => p.title).join(', ');
  return [
    '## Procedura',
    `[RISPOSTA SIMULATA] In base al contenuto di "${primary?.title ?? 'pagina corrente'}", ` +
      `ecco i passi per: "${input.query}". (Con il provider reale, qui Claude sintetizzerebbe ` +
      `la procedura dalle ${input.pages.length} pagina/e KB fornite: ${titles}.)`,
    '',
    '## Eccezioni',
    'Casi particolari e condizioni segnalate nelle pagine collegate verrebbero elencati qui.',
    '',
    '## Risposta suggerita al cliente',
    `"Gentile cliente, riguardo a «${input.query}» possiamo procedere come segue…"`,
    '',
    '## Fonti',
    sources || '- (nessuna pagina fornita)',
  ].join('\n');
}

export class MockProvider implements AiProvider {
  readonly name = 'mock' as const;

  async streamOutcome(
    input: GenerateInput,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const text = buildOutcome(input);
    // Stream in small word groups to mimic token streaming.
    const tokens = text.match(/\S+\s*/g) ?? [text];
    for (let i = 0; i < tokens.length; i += 3) {
      if (signal?.aborted) return;
      onDelta(tokens.slice(i, i + 3).join(''));
      await sleep(35);
    }
  }
}
