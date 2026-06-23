// Streaming client for the backend `POST /ask` endpoint.
// Parses Server-Sent Events from a fetch ReadableStream and invokes `onEvent`
// for each AskEvent. Runs in the sidebar (content script) context; the backend
// returns permissive CORS for the demo so no host permission is required.
import type { AskRequest, AskEvent } from './outcome';

export async function streamAsk(
  proxyUrl: string,
  request: AskRequest,
  onEvent: (event: AskEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${proxyUrl.replace(/\/$/, '')}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (e) {
    onEvent({ type: 'error', message: `Impossibile contattare il backend: ${String(e)}` });
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
        // ignore malformed frame
      }
    }
  }
}
