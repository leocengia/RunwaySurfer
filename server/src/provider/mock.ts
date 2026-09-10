// MockProvider — the default for the demo. It does NOT call any AI model; it
// synthesizes a plausible, structured outcome from the provided KB pages and
// streams it word-by-word so the sidebar shows the real streaming UX.
//
// This lets the team demo the full architecture (and the CED see the backend's
// server/network requirements) before AI licenses/tokens are sorted out.
// Switching AI_PROVIDER=anthropic swaps in the real provider with no other
// changes.
import type { AiProvider, GenerateInput, StreamResult, RankInput, RankResult } from './shared.js';
import { outcomeSections, RANK_MAX_SELECTED } from './shared.js';
import { SOURCES_SECTION } from '../shared-assets.js';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Corpo simulato di una sezione. Il mock non chiama alcun modello: serve a far
 * vedere la forma della risposta e lo streaming, quindi ogni sezione dichiara
 * cosa ci sarebbe al posto suo col provider reale.
 */
function mockSection(name: string, input: GenerateInput): string[] {
  const primary = input.pages[0];
  const titles = input.pages.map((p) => p.title).join(', ');
  if (name === SOURCES_SECTION) {
    const sources = input.pages.map((p) => `- ${p.title}: ${p.url}`).join('\n');
    return [sources || '- (nessuna pagina fornita)'];
  }
  if (name === 'Procedura') {
    return [
      `[RISPOSTA SIMULATA] In base al contenuto di "${primary?.title ?? 'pagina corrente'}", ` +
        `ecco i passi per: "${input.query}". (Con il provider reale, qui Claude sintetizzerebbe ` +
        `la procedura dalle ${input.pages.length} pagina/e KB fornite: ${titles}.)`,
      '- Primo passo simulato dalla pagina letta.',
      '- Secondo passo, con **una condizione** da verificare.',
      '- Terzo passo e conferma al cliente.',
    ];
  }
  if (name === 'Eccezioni') {
    return [
      'Casi particolari e condizioni segnalate nelle pagine collegate verrebbero elencati qui.',
    ];
  }
  // Sezione richiesta dal form Schedule Change: nessun testo precotto.
  return [`[SIMULATO] Qui il provider reale riporterebbe «${name}» come risulta dalla KB.`];
}

function buildOutcome(input: GenerateInput): string {
  const lines: string[] = [];

  // Con uno storico, il mock lo cita: altrimenti la demo dei follow-up non
  // mostrerebbe alcuna differenza rispetto a una domanda isolata.
  const previous = input.history?.at(-1);
  if (previous) {
    lines.push(`_[SIMULATO] Tengo conto della domanda precedente: «${previous.query}»._`, '');
  }
  if (input.form) {
    lines.push(
      `_[SIMULATO] Richiesta strutturata: ${input.form.requestType} · ${input.form.airline} · ` +
        `${input.form.cityPair} · ${input.form.flightType} · ${input.form.originalDate}._`,
      '',
    );
  }

  for (const name of outcomeSections(input.form?.sections)) {
    lines.push(`## ${name}`, ...mockSection(name, input), '');
  }
  return lines.join('\n').trimEnd();
}

export class MockProvider implements AiProvider {
  readonly name = 'mock' as const;

  async streamOutcome(
    input: GenerateInput,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<StreamResult> {
    const text = buildOutcome(input);
    // Stream in small word groups to mimic token streaming.
    const tokens = text.match(/\S+\s*/g) ?? [text];
    for (let i = 0; i < tokens.length; i += 3) {
      if (signal?.aborted) return {};
      onDelta(tokens.slice(i, i + 3).join(''));
      await sleep(35);
    }
    // Il mock non chiama alcun modello: nessun token reale da riportare.
    return {};
  }

  /**
   * Rerank deterministico SENZA AI: ordina i candidati per lo `score` locale
   * (tie-break: `order`, poi indice, poi URL) e ritorna i primi K. In mock la
   * selezione COINCIDE con quella locale di oggi — è il comportamento corretto
   * quando non c'è una vera API. `usage` assente (nessun token reale).
   */
  async rankCandidates(input: RankInput): Promise<RankResult> {
    const selectedUrls = input.candidates
      .map((c, i) => ({ c, i }))
      .sort(
        (a, b) =>
          (b.c.score ?? 0) - (a.c.score ?? 0) ||
          (a.c.order ?? a.i) - (b.c.order ?? b.i) ||
          a.c.url.localeCompare(b.c.url),
      )
      .slice(0, RANK_MAX_SELECTED)
      .map((x) => x.c.url);
    return { selectedUrls };
  }
}
