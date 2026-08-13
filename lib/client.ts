// Streaming client for the backend `POST /ask` endpoint.
// Parses Server-Sent Events from a fetch ReadableStream and invokes `onEvent`
// for each AskEvent. Runs in the sidebar (content script) context; the backend
// returns permissive CORS for the demo so no host permission is required.
import { isAbortError, withTimeout } from './abort';
import type { AskRequest, AskEvent, RankRequest, RankResponse } from './outcome';

/**
 * Silenzio massimo tollerato sullo stream. È un timeout di INATTIVITÀ, non sulla
 * durata: una risposta lunga continua a produrre delta e quindi riarma il
 * contatore, mentre un backend appeso non manda nulla e viene interrotto.
 */
export const STREAM_IDLE_TIMEOUT_MS = 30_000;

/** Messaggio condiviso con lib/auth.ts: l'agente deve leggere sempre lo stesso. */
export const BACKEND_UNREACHABLE =
  'Backend non raggiungibile. Controlla di essere in rete (o in VPN) e riprova.';

const STREAM_TIMEOUT_MESSAGE = `Il backend non ha risposto per ${Math.round(
  STREAM_IDLE_TIMEOUT_MS / 1000,
)} secondi: richiesta interrotta. Riprova; se succede ancora, segnalalo.`;

const STREAM_DROPPED_MESSAGE =
  'Connessione interrotta mentre arrivava la risposta. Il testo ricevuto fin qui resta a schermo; riprova per averla completa.';

export async function streamAsk(
  proxyUrl: string,
  request: AskRequest,
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
  token?: string | null,
): Promise<void> {
  const deadline = withTimeout(STREAM_IDLE_TIMEOUT_MS, signal);
  // Stop premuto dall'agente: non è un errore, non va mostrato niente.
  const stoppedByUser = () => signal?.aborted === true;

  try {
    let res: Response;
    try {
      res = await fetch(`${proxyUrl.replace(/\/$/, '')}/ask`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(request),
        signal: deadline.signal,
      });
    } catch (e) {
      if (stoppedByUser()) return;
      if (deadline.expired()) onEvent({ type: 'error', message: STREAM_TIMEOUT_MESSAGE });
      else onEvent({ type: 'error', message: `${BACKEND_UNREACHABLE} (${describe(e)})` });
      return;
    }

    if (res.status === 401) {
      // Token missing/expired/revoked: the sidebar must show the login form.
      onEvent({ type: 'auth-required' });
      return;
    }
    if (!res.ok || !res.body) {
      onEvent({ type: 'error', message: `Backend ha risposto ${res.status}` });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    // Parse SSE frames separated by a blank line; each frame has `data: <json>`.
    // Il try/catch NON è decorativo: senza, un calo di rete a metà risposta
    // rigettava fin dentro l'onClick del pulsante, `status` restava su
    // 'streaming' e la sidebar rimaneva bloccata fino al reload della pagina.
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        deadline.touch();
        buffer += decoder.decode(value, { stream: true });

        let sep: number;
        while ((sep = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          const line = frame.split('\n').find((l) => l.startsWith('data:'));
          if (!line) continue;
          const payload = line.slice('data:'.length).trim();
          if (!payload) continue;
          try {
            onEvent(JSON.parse(payload) as AskEvent);
          } catch {
            // Frame malformato: lo stream continua, ma lascia traccia in console.
            console.warn('[rs] frame SSE malformato ignorato:', payload.slice(0, 120));
          }
        }
      }
    } catch (e) {
      if (stoppedByUser()) return;
      onEvent({
        type: 'error',
        message: deadline.expired() ? STREAM_TIMEOUT_MESSAGE : STREAM_DROPPED_MESSAGE,
      });
      if (!isAbortError(e)) console.warn('[rs] stream /ask interrotto:', e);
    }
  } finally {
    deadline.dispose();
  }
}

/** Testo corto e non spaventoso per la causa di rete, da mettere fra parentesi. */
function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Chiede al backend di riordinare/selezionare i candidati (POST /rank, JSON, non
 * streaming). Ritorna la RankResponse, oppure `null` su QUALUNQUE problema
 * (401, non-ok, errore di rete, timeout/abort): chi chiama interpreta `null` (o
 * una selezione vuota) come "usa lo scoring locale" → il rerank non è mai peggio
 * di oggi. NON emette `auth-required` qui: la successiva `/ask` gestisce il login.
 */
export async function rankCandidates(
  proxyUrl: string,
  request: RankRequest,
  signal?: AbortSignal,
  token?: string | null,
): Promise<RankResponse | null> {
  try {
    const res = await fetch(`${proxyUrl.replace(/\/$/, '')}/rank`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(request),
      signal,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as RankResponse;
    return Array.isArray(body?.selectedUrls) ? body : null;
  } catch {
    // Rete/timeout/abort: silenzioso, il chiamante fa fallback locale.
    return null;
  }
}
