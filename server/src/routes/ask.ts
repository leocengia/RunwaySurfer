// POST /ask — l'endpoint principale: sanificazione dell'input, routing del
// modello, stima token/costo, guardrail e streaming SSE dell'outcome.
import { Router, type Request, type Response } from 'express';
import { asyncRoute } from '../http.js';
import { countCitedSources } from '../outcome-audit.js';
import type { AskRequest, AskEvent, AiPlan, AskTurn, ScheduleChangeRequest } from '../types.js';
import { chooseModel, estimateTokens, estimateCostUsd } from '../router.js';
import {
  getProvider,
  buildSystemPrompt,
  buildUserContent,
  maxOutputTokens,
  systemPromptOptionsFor,
  ANTHROPIC_EGRESS,
  ASSUMED_OUTPUT_TOKENS,
} from '../provider/index.js';
import { SCHEDULE_CHANGE_FIELDS } from '../shared-assets.js';
import {
  getSettings,
  insertRequestHistory,
  type RequestHistoryInput,
  type SettingsRecord,
} from '../db.js';
import { requireAuth, type AuthContext } from '../auth.js';
import {
  metrics,
  recordMetric,
  canAcceptRequest,
  beginActive,
  endActive,
  noteRequestForRateLimit,
} from '../metrics.js';
import { truncate, newRequestId } from '../util.js';
import { MAX_QUERY_CHARS } from '../config.js';

/** Caratteri massimi per la risposta di un turno precedente rimandato al modello. */
export const MAX_HISTORY_ANSWER_CHARS = 1_200;
/** Caratteri massimi per la domanda di un turno precedente. */
export const MAX_HISTORY_QUERY_CHARS = 300;

const REQUEST_TYPES: ScheduleChangeRequest['requestType'][] = [
  'Schedule Change',
  'Name Correction',
];
const FLIGHT_TYPES: ScheduleChangeRequest['flightType'][] = ['Online', 'Codeshare'];
const SECTION_LABELS = new Set(SCHEDULE_CHANGE_FIELDS.map((f) => f.label));

/**
 * Storico normalizzato: solo gli ultimi `max_history_turns` turni, con domanda e
 * risposta troncate. Senza questo tetto ogni follow-up rimanderebbe tutto il
 * pregresso e il costo crescerebbe col quadrato dei turni sullo stesso budget
 * giornaliero.
 */
function sanitizeHistory(raw: unknown, maxTurns: number): AskTurn[] | undefined {
  if (!Array.isArray(raw) || maxTurns <= 0) return undefined;
  const turns = raw
    .slice(-maxTurns)
    .map((turn) => ({
      query: truncate((turn as Partial<AskTurn>)?.query, MAX_HISTORY_QUERY_CHARS),
      answer: truncate((turn as Partial<AskTurn>)?.answer, MAX_HISTORY_ANSWER_CHARS),
    }))
    .filter((turn) => turn.query && turn.answer);
  return turns.length ? turns : undefined;
}

/**
 * Form strutturato normalizzato. I valori enumerati passano da una WHITELIST, non
 * da un troncamento: `requestType`, `flightType` e i nomi delle sezioni finiscono
 * dentro le istruzioni di sistema, quindi una stringa libera dell'agente lì
 * sarebbe una via d'ingresso per l'injection.
 */
function sanitizeForm(raw: unknown): ScheduleChangeRequest | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const f = raw as Partial<ScheduleChangeRequest>;
  const requestType = REQUEST_TYPES.find((t) => t === f.requestType);
  const flightType = FLIGHT_TYPES.find((t) => t === f.flightType);
  if (!requestType || !flightType) return undefined;
  const sections = Array.isArray(f.sections)
    ? f.sections.filter((s): s is string => typeof s === 'string' && SECTION_LABELS.has(s))
    : [];
  return {
    kind: 'schedule-change',
    requestType,
    flightType,
    airline: truncate(f.airline, 8).toUpperCase(),
    cityPair: truncate(f.cityPair, 80),
    // Solo `YYYY-MM-DD`: è ciò che produce <input type="date">.
    originalDate: /^\d{4}-\d{2}-\d{2}$/.test(String(f.originalDate ?? ''))
      ? String(f.originalDate)
      : '',
    sections,
  };
}

/** Esportata per i test: normalizza e tronca il payload non fidato di /ask. */
export function sanitizeRequest(body: Partial<AskRequest>, settings: SettingsRecord): AskRequest {
  const pages = Array.isArray(body.pages)
    ? body.pages.slice(0, settings.max_request_pages).map((page, index) => {
        const origin: 'current' | 'followed' = page?.origin === 'followed' ? 'followed' : 'current';
        return {
          url: truncate(page?.url, 2_000),
          title: truncate(page?.title, 240) || `Pagina ${index + 1}`,
          text: truncate(page?.text, settings.max_page_text_chars),
          origin,
        };
      })
    : [];
  const links = Array.isArray(body.links)
    ? body.links.slice(0, settings.max_request_links).map((link) => ({
        url: truncate(link?.url, 2_000),
        text: truncate(link?.text, 180),
        context: truncate(link?.context, 260) || undefined,
        order: typeof link?.order === 'number' ? link.order : undefined,
        reason: truncate(link?.reason, 160) || undefined,
        score: typeof link?.score === 'number' ? link.score : undefined,
        matchedKeywords: Array.isArray(link?.matchedKeywords)
          ? link.matchedKeywords.slice(0, 8).map((kw) => truncate(kw, 40))
          : undefined,
      }))
    : [];
  return {
    query: truncate(body.query, MAX_QUERY_CHARS),
    pages,
    links: links.filter((link) => link.url && link.text),
    history: sanitizeHistory(body.history, settings.max_history_turns),
    form: sanitizeForm(body.form),
  };
}

function persistRequest(input: RequestHistoryInput): void {
  try {
    insertRequestHistory(input);
  } catch (e) {
    console.error(`[history] failed to persist request ${input.id}:`, e);
  }
}

export const askRoutes = Router();

/** Main endpoint: model routing + cost estimate + streamed outcome (SSE). */
const handleAsk = async (req: Request, res: Response): Promise<void> => {
  const settings = getSettings();
  const { user } = res.locals.auth as AuthContext;
  const agentId = user.external_id;
  const body = req.body as Partial<AskRequest>;
  if (!body || typeof body.query !== 'string' || !Array.isArray(body.pages)) {
    res.status(400).json({ error: 'invalid request: expected {query, pages, links}' });
    return;
  }
  const request = sanitizeRequest(body, settings);
  // Con un form compilato la prosa libera è opzionale (i campi SONO la domanda),
  // e la richiesta può partire anche da una pagina non leggibile: l'articolo
  // giusto lo si cerca in tutta la KB.
  if (!request.form && (!request.query || request.pages.length === 0)) {
    res.status(400).json({ error: 'invalid request: non-empty query and pages are required' });
    return;
  }
  const rejectedBase = {
    userId: user.id,
    agentId,
    teamId: user.team_id,
    query: request.query,
    provider: getProvider().name,
    model: 'none',
    pagesCount: request.pages.length,
    linksCount: request.links.length,
    estimatedInputTokens: 0,
    estimatedOutputTokens: 0,
    estimatedCostUsd: 0,
    durationMs: 0,
    status: 'rejected' as const,
    selectedLinks: request.links,
    sources: request.pages.map((p) => ({ title: p.title, url: p.url, origin: p.origin })),
  };
  if (user.status === 'disabled') {
    metrics.rejectedRequests += 1;
    persistRequest({ ...rejectedBase, id: newRequestId(), error: 'user disabled' });
    res.status(403).json({ error: 'user disabled' });
    return;
  }
  const capacity = canAcceptRequest(agentId, settings);
  if (!capacity.ok) {
    metrics.rejectedRequests += 1;
    persistRequest({ ...rejectedBase, id: newRequestId(), error: capacity.message });
    res.status(capacity.status).json({ error: capacity.message });
    return;
  }
  // Conta solo le richieste ACCETTATE: un 429 non deve allungare la punizione.
  noteRequestForRateLimit(agentId);

  const provider = getProvider();
  const { spec, reason } = chooseModel(request);

  // Il prompt viene renderizzato qui SOLO per la stima: essendo composto dalle
  // stesse funzioni che usa il provider, storico e form ci finiscono dentro da
  // soli e la stima resta esatta senza duplicare logica.
  const generateInput = { ...request, model: spec.id };
  const promptText =
    buildSystemPrompt(systemPromptOptionsFor(generateInput)) +
    '\n' +
    buildUserContent(generateInput);
  const estimatedInputTokens = estimateTokens(promptText);
  // Conservativo: mai sotto la costante storica, ma se il form chiede più sezioni
  // il tetto reale è più alto e il budget deve saperlo.
  const estimatedOutputTokens = Math.max(ASSUMED_OUTPUT_TOKENS, maxOutputTokens(generateInput));
  const estimatedCostUsd = estimateCostUsd(spec, estimatedInputTokens, estimatedOutputTokens);

  // Per-request usage log (cost visibility for the CED / FinOps).
  // Generato PRIMA del plan: l'id viaggia nel plan fino alla sidebar, che lo
  // riusa per legare un eventuale feedback dell'agente a questa richiesta.
  const requestId = newRequestId();
  const plan: AiPlan = {
    requestId,
    model: spec.id,
    routingReason: reason,
    estimatedInputTokens,
    estimatedOutputTokens,
    estimatedCostUsd,
    egress: ANTHROPIC_EGRESS,
    provider: provider.name,
    // Post-taglio: è il numero di turni davvero in contesto, non quello inviato.
    historyTurnsUsed: request.history?.length ?? 0,
  };

  const startedAt = Date.now();
  // Increment the live counter and release it in the finally below, so a throw
  // during SSE setup (e.g. flushHeaders/write on an already-closed socket) can
  // never leak it and eventually trip the concurrency guardrail (429).
  beginActive(agentId);
  try {
    // NIENTE query nel log. La tabella `requests` è volutamente
    // privacy-minimised (hash + preview) e stampare il testo su stdout
    // vanificava la scelta: i log finiscono in file, backup e ticket. Qui resta
    // tutto ciò che serve a diagnosticare una richiesta: id, agente, modello,
    // pagine, token e costo.
    console.log(
      `[ask:${requestId}] agent=${agentId} provider=${provider.name} model=${spec.id} pages=${request.pages.length} ` +
        `queryChars=${request.query.length} inTok≈${estimatedInputTokens} cost≈$${estimatedCostUsd.toFixed(4)}`,
    );

    // SSE setup.
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Dice ai reverse proxy (nginx e derivati) di NON bufferizzare la risposta.
    // Senza, il proxy accumula lo stream e lo consegna tutto alla fine: per
    // l'agente la sidebar sembra piantata e poi stampa il testo di colpo. Non
    // sostituisce `proxy_buffering off;` su tutti i proxy, ma è la metà che
    // possiamo garantire noi.
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const send = (event: AskEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    // Abort the provider stream if the *client* disconnects. Use res 'close'
    // (not req 'close', which fires as soon as the already-parsed body stream ends).
    const ac = new AbortController();
    res.on('close', () => ac.abort());

    const historyBase = {
      userId: user.id,
      agentId,
      teamId: user.team_id,
      query: request.query,
      provider: provider.name,
      model: spec.id,
      pagesCount: request.pages.length,
      linksCount: request.links.length,
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedCostUsd,
      selectedLinks: request.links,
      sources: request.pages.map((p) => ({ title: p.title, url: p.url, origin: p.origin })),
    };
    const metricBase = {
      id: requestId,
      at: new Date(startedAt).toISOString(),
      agentId,
      provider: provider.name,
      model: spec.id,
      pages: request.pages.length,
      links: request.links.length,
      inputTokens: estimatedInputTokens,
      outputTokens: estimatedOutputTokens,
      estimatedCostUsd,
    };

    send({ type: 'plan', plan });
    // La risposta si accumula per la SOLA durata dello stream, per contare le
    // fonti citate (vedi outcome-audit.ts). In tabella finisce il numero, non il
    // testo: la riga di audit resta privacy-minimised. Il tetto è 1400 token,
    // quindi questa stringa non supera i ~6 KB.
    let answer = '';
    try {
      const { usage } = await provider.streamOutcome(
        { ...request, model: spec.id },
        (text) => {
          answer += text;
          send({ type: 'delta', text });
        },
        ac.signal,
      );
      if (ac.signal.aborted) {
        // Client disconnected mid-stream: the mock provider resolves normally
        // on abort (unlike the real one, which throws), so without this branch
        // the request would be logged as a successful completion it never was.
        const message = 'client disconnected';
        recordMetric({ ...metricBase, ms: Date.now() - startedAt, ok: false, error: message });
        persistRequest({
          ...historyBase,
          id: requestId,
          durationMs: Date.now() - startedAt,
          status: 'error',
          error: message,
        });
      } else {
        send({ type: 'done' });
        recordMetric({ ...metricBase, ms: Date.now() - startedAt, ok: true });
        persistRequest({
          ...historyBase,
          id: requestId,
          durationMs: Date.now() - startedAt,
          status: 'ok',
          // Token reali dal provider (mock: undefined → resta solo la stima).
          actualInputTokens: usage?.inputTokens ?? null,
          actualOutputTokens: usage?.outputTokens ?? null,
          // 0 qui significa «il modello non ha citato nessun articolo»: è così che
          // dice di non aver trovato la risposta, e la dashboard lo segnala.
          citedSources: countCitedSources(answer),
        });
      }
    } catch (e) {
      const message = String(e);
      send({ type: 'error', message });
      recordMetric({ ...metricBase, ms: Date.now() - startedAt, ok: false, error: message });
      persistRequest({
        ...historyBase,
        id: requestId,
        durationMs: Date.now() - startedAt,
        status: 'error',
        error: message,
      });
    }
  } finally {
    endActive(agentId);
    try {
      res.end();
    } catch {
      /* socket already closed */
    }
  }
};

askRoutes.post('/ask', requireAuth('agent'), asyncRoute(handleAsk));
