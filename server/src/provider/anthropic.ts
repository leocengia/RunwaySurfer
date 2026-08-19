// AnthropicProvider — the real provider, used when AI_PROVIDER=anthropic and an
// ANTHROPIC_API_KEY is configured. Not exercised in the demo (mock is default);
// enabling it requires the purchased token plan to be in place.
//
// Latency techniques applied here:
//  - streaming (low time-to-first-token);
//  - prompt caching on the stable system prefix (cheap, fast follow-ups);
//  - thinking omitted (= disattivato sui modelli usati) + effort low dove supportato.
import Anthropic from '@anthropic-ai/sdk';
import type {
  AiProvider,
  GenerateInput,
  StreamResult,
  TokenUsage,
  RankInput,
  RankResult,
} from './shared.js';
import {
  buildRankPrompt,
  buildSystemPrompt,
  buildUserContent,
  maxOutputTokens,
  parseRankSelection,
  systemPromptOptionsFor,
  RANK_MAX_SELECTED,
} from './shared.js';

// Models that accept the `effort` parameter (Haiku 4.5 does not).
const EFFORT_MODELS = new Set(['claude-sonnet-4-6', 'claude-opus-4-8']);

/**
 * Strumento del reranker. `tool_choice` forzato su questo nome: il modello DEVE
 * chiamarlo, quindi la risposta è un oggetto e non prosa da interpretare.
 */
const SELECT_ARTICLES_TOOL: Anthropic.Tool = {
  name: 'select_articles',
  description:
    'Restituisce gli id degli articoli candidati pertinenti al quesito, dal più al meno pertinente.',
  input_schema: {
    type: 'object',
    properties: {
      selectedIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Id dei candidati scelti (c1, c2, ...). Lista vuota se nessuno è pertinente.',
      },
    },
    required: ['selectedIds'],
  },
};

/** Il primo blocco `tool_use` del messaggio, se presente. Pura, per i test. */
export function firstToolInput(message: Anthropic.Message): unknown {
  for (const block of message.content) {
    if (block.type === 'tool_use' && block.name === SELECT_ARTICLES_TOOL.name) return block.input;
  }
  return undefined;
}

/**
 * Estrae i token REALI dal `Message` finale dell'SDK (`message.usage`), quando
 * presenti. Degrada a `undefined` se il campo manca o non è numerico, così il
 * chiamante ricade sulle stime senza rompersi. Esportata (pura) per i test.
 */
export function usageFromMessage(message: {
  usage?: { input_tokens?: number | null; output_tokens?: number | null } | null;
}): TokenUsage | undefined {
  const usage = message.usage;
  if (!usage) return undefined;
  const inputTokens = usage.input_tokens;
  const outputTokens = usage.output_tokens;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return undefined;
  return { inputTokens, outputTokens };
}

/**
 * La risposta è stata tagliata dal tetto di output? Solo `max_tokens` conta come
 * taglio: `end_turn` è una risposta finita, `refusal` è un rifiuto (che ha già la
 * sua strada), e un valore sconosciuto non va interpretato come guasto. Pura, per
 * i test.
 */
export function truncatedFromMessage(message: { stop_reason?: string | null }): boolean {
  return message.stop_reason === 'max_tokens';
}

export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  private client = new Anthropic(); // reads ANTHROPIC_API_KEY from env

  async streamOutcome(
    input: GenerateInput,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<StreamResult> {
    // Parametri tipizzati contro l'SDK: se una futura major cambia la forma
    // della richiesta, `npm run compile` fallisce invece di rompersi a runtime.
    const params: Anthropic.MessageStreamParams = {
      model: input.model,
      max_tokens: maxOutputTokens(input),
      system: [
        {
          type: 'text',
          // Con storico o form il system prompt cambia, quindi il prefisso di
          // cache non è più costante: resta comunque stabile a parità di forma
          // della richiesta (stesse sezioni, stessa presenza di storico/form).
          text: buildSystemPrompt(systemPromptOptionsFor(input)),
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
    // Il messaggio finale porta `usage` (input/output token reali): lo leggiamo
    // per persistere i conteggi esatti accanto alle stime. Se l'SDK non lo
    // espone, usageFromMessage ritorna undefined e si tengono le stime.
    const finalMessage = await stream.finalMessage();
    return {
      usage: usageFromMessage(finalMessage),
      truncated: truncatedFromMessage(finalMessage),
    };
  }

  /**
   * Rerank guidato dall'AI: selezione sui soli METADATI dei candidati, a monte
   * della lettura dei corpi. È il pezzo che rende utile la ricerca su tutta la KB
   * — l'indice offre 2964 articoli, ma solo un giudizio semantico sa dire quale
   * risponde a un quesito posto in italiano su articoli scritti in inglese.
   *
   * `tool_choice` forzato: il modello deve chiamare `select_articles`, quindi la
   * risposta è strutturata invece di prosa. `parseRankSelection` scarta comunque
   * qualunque id non presente fra i candidati (anti-allucinazione), perciò un
   * modello che inventa non può far leggere una pagina non richiesta.
   *
   * Su qualunque intoppo si lascia propagare l'errore: la rotta /rank lo cattura
   * e risponde `{selectedUrls: []}`, e il client ricade sullo scoring locale.
   */
  async rankCandidates(input: RankInput, signal?: AbortSignal): Promise<RankResult> {
    if (!input.candidates.length) return { selectedUrls: [] };
    const { system, user } = buildRankPrompt(input);
    const message = await this.client.messages.create(
      {
        model: input.model,
        // La risposta è una lista di pochi id: un tetto largo servirebbe solo a
        // pagare token che non arriveranno.
        max_tokens: 256,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        messages: [{ role: 'user', content: user }],
        tools: [SELECT_ARTICLES_TOOL],
        tool_choice: { type: 'tool', name: SELECT_ARTICLES_TOOL.name },
      },
      { signal },
    );
    return {
      selectedUrls: parseRankSelection(
        firstToolInput(message),
        input.candidates,
        RANK_MAX_SELECTED,
      ),
      usage: usageFromMessage(message),
    };
  }
}
