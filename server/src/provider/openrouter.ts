// OpenRouterProvider — provider alternativo, usato quando AI_PROVIDER=openrouter
// e una OPENROUTER_API_KEY è configurata. Stessa struttura di anthropic.ts, ma
// sopra l'API Chat Completions (compatibile OpenAI) che OpenRouter espone per
// QUALUNQUE modello del suo catalogo (Anthropic, OpenAI, Google, Meta...) — il
// modello concreto per fascia/reranker arriva da model-registry.ts, non è
// cablato qui.
//
// Gap noto rispetto ad anthropic.ts: nessun equivalente universale di
// `cache_control` (prompt caching) o `effort` (sforzo del ragionamento) — sono
// meccanismi specifici Anthropic, non parte dell'API Chat Completions.
import OpenAI from 'openai';
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

/**
 * Strumento del reranker, forma OpenAI Chat Completions. `tool_choice` forzato
 * su questo nome: equivalente OpenAI del `tool_choice:{type:'tool',...}` di
 * Anthropic — il modello DEVE chiamarlo, la risposta è argomenti strutturati e
 * non prosa da interpretare.
 */
const SELECT_ARTICLES_TOOL: OpenAI.Chat.Completions.ChatCompletionFunctionTool = {
  type: 'function',
  function: {
    name: 'select_articles',
    description:
      'Restituisce gli id degli articoli candidati pertinenti al quesito, dal più al meno pertinente.',
    parameters: {
      type: 'object',
      properties: {
        selectedIds: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Id dei candidati scelti (c1, c2, ...). Lista vuota se nessuno è pertinente.',
        },
      },
      required: ['selectedIds'],
    },
  },
};

/**
 * Estrae i token REALI da un oggetto `usage` in forma Chat Completions
 * (`prompt_tokens`/`completion_tokens`), presente sia sulla risposta non-stream
 * sia sull'ultimo chunk di uno stream con `stream_options:{include_usage:true}`.
 * Degrada a `undefined` se assente o non numerico. Pura, per i test — nessun
 * mock dell'SDK necessario.
 */
export function usageFromCompletion(completion: {
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null } | null;
}): TokenUsage | undefined {
  const usage = completion.usage;
  if (!usage) return undefined;
  const inputTokens = usage.prompt_tokens;
  const outputTokens = usage.completion_tokens;
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number') return undefined;
  return { inputTokens, outputTokens };
}

/**
 * La risposta è stata tagliata dal tetto di output? Solo `finish_reason ===
 * 'length'` conta come taglio — stessa convenzione di `truncatedFromMessage`
 * in anthropic.ts, riletta sul vocabolario Chat Completions. Pura, per i test.
 */
export function truncatedFromCompletion(completion: {
  choices?: Array<{ finish_reason?: string | null }>;
}): boolean {
  return completion.choices?.[0]?.finish_reason === 'length';
}

/**
 * Argomenti (stringa JSON) della prima tool call `select_articles`, se
 * presente. Passata così com'è a `parseRankSelection` — che già tollera JSON
 * puro o prosa attorno, non serve un secondo parser qui. Pura, per i test.
 */
export function firstToolCallArguments(completion: {
  choices?: Array<{
    message?: {
      tool_calls?: Array<{ type?: string; function?: { name?: string; arguments?: string } }>;
    };
  }>;
}): string | undefined {
  const toolCalls = completion.choices?.[0]?.message?.tool_calls;
  const call = toolCalls?.find((tc) => tc.function?.name === SELECT_ARTICLES_TOOL.function.name);
  return call?.function?.arguments;
}

/**
 * Con un modello arbitrario del catalogo OpenRouter, `tool_choice` forzato può
 * essere semplicemente ignorato (non tutti i modelli dietro OpenRouter
 * rispettano la forzatura con la stessa affidabilità di Claude). Non è un
 * rischio di sicurezza — `parseRankSelection` scarta comunque ogni id non tra i
 * candidati — ma un modello che risponde senza tool call degraderebbe in
 * silenzio a `[]`, indistinguibile da "nessun candidato pertinente". Fail
 * visibile invece di whitelist: lancia, e chi chiama (routes/rank.ts) lo
 * registra come `status:'error'`, osservabile via `/requests?kind=rank&status=error`.
 */
export function assertToolCallPresent(completion: {
  choices?: Array<{ message?: { tool_calls?: unknown[] } }>;
}): void {
  const toolCalls = completion.choices?.[0]?.message?.tool_calls;
  if (!Array.isArray(toolCalls) || toolCalls.length === 0) {
    throw new Error(
      'il modello OpenRouter configurato per il rerank non ha chiamato lo strumento richiesto ' +
        '(tool_choice forzato ignorato dal modello): probabile inaffidabilità del tool-calling ' +
        'forzato per questo modello — considerarne uno diverso per MODEL_CHEAP/RANK_MODEL.',
    );
  }
}

export class OpenRouterProvider implements AiProvider {
  readonly name = 'openrouter' as const;
  private client = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY,
  });

  async streamOutcome(
    input: GenerateInput,
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<StreamResult> {
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model: input.model,
      max_tokens: maxOutputTokens(input),
      messages: [
        { role: 'system', content: buildSystemPrompt(systemPromptOptionsFor(input)) },
        { role: 'user', content: buildUserContent(input) },
      ],
      stream: true,
      // Senza questo, l'ultimo chunk NON porta `usage`: si perderebbero i token
      // reali e si ricadrebbe sempre sulla sola stima.
      stream_options: { include_usage: true },
    };
    const stream = await this.client.chat.completions.create(params, { signal });

    let usage: TokenUsage | undefined;
    let truncated = false;
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) onDelta(delta);
      if (truncatedFromCompletion(chunk)) truncated = true;
      const chunkUsage = usageFromCompletion(chunk);
      if (chunkUsage) usage = chunkUsage;
    }
    return { usage, truncated };
  }

  /**
   * Rerank guidato dall'AI, stessa filosofia di AnthropicProvider.rankCandidates:
   * selezione sui soli METADATI, `tool_choice` forzato, anti-allucinazione già
   * garantita da `parseRankSelection` a valle. Qui in più: `assertToolCallPresent`
   * rende visibile (non silenzioso) un modello che ignora la forzatura.
   */
  async rankCandidates(input: RankInput, signal?: AbortSignal): Promise<RankResult> {
    if (!input.candidates.length) return { selectedUrls: [] };
    const { system, user } = buildRankPrompt(input);
    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: input.model,
      // La risposta è una lista di pochi id: un tetto largo servirebbe solo a
      // pagare token che non arriveranno.
      max_tokens: 256,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      tools: [SELECT_ARTICLES_TOOL],
      tool_choice: { type: 'function', function: { name: SELECT_ARTICLES_TOOL.function.name } },
    };
    const completion = await this.client.chat.completions.create(params, { signal });
    assertToolCallPresent(completion);
    return {
      selectedUrls: parseRankSelection(
        firstToolCallArguments(completion),
        input.candidates,
        RANK_MAX_SELECTED,
      ),
      usage: usageFromCompletion(completion),
    };
  }
}
