// Streaming client for the backend `POST /ask` endpoint.
// Parses Server-Sent Events from a fetch ReadableStream and invokes `onEvent`
// for each AskEvent. Runs in the sidebar (content script) context; the backend
// returns permissive CORS for the demo so no host permission is required.
import type { AskRequest, AskEvent, RankRequest, RankResponse } from './outcome';

export async function streamAsk(
  proxyUrl: string,
  request: AskRequest,
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
  token?: string | null,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${proxyUrl.replace(/\/$/, '')}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(request),
      signal,
    });
  } catch (e) {
    onEvent({ type: 'error', message: `Impossibile contattare il backend: ${String(e)}` });
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
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
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
