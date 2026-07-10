import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamAsk } from '../lib/client';
import type { AskEvent, AskRequest } from '../lib/outcome';

const REQUEST: AskRequest = { query: 'test', pages: [], links: [] };

function sseResponse(frames: string[], init: ResponseInit = { status: 200 }): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(body, init);
}

async function collectEvents(response: Response | Error): Promise<AskEvent[]> {
  const events: AskEvent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      if (response instanceof Error) throw response;
      return response;
    }),
  );
  await streamAsk('http://proxy.test/', REQUEST, (e) => events.push(e));
  return events;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('streamAsk', () => {
  it('fa il parse dei frame SSE in AskEvent', async () => {
    const events = await collectEvents(
      sseResponse([
        'data: {"type":"plan","plan":{"model":"m","routingReason":"r","estimatedInputTokens":1,"estimatedOutputTokens":2,"estimatedCostUsd":0.1,"egress":"e","provider":"mock"}}\n\n',
        'data: {"type":"delta","text":"ciao "}\n\n',
        'data: {"type":"delta","text":"mondo"}\n\ndata: {"type":"done"}\n\n',
      ]),
    );
    expect(events.map((e) => e.type)).toEqual(['plan', 'delta', 'delta', 'done']);
  });

  it('ricompone i frame spezzati su chunk diversi', async () => {
    const events = await collectEvents(
      sseResponse(['data: {"type":"del', 'ta","text":"abc"}\n\ndata: {"type":"done"}\n\n']),
    );
    expect(events).toEqual([{ type: 'delta', text: 'abc' }, { type: 'done' }]);
  });

  it('ignora i frame malformati senza interrompere lo stream', async () => {
    const events = await collectEvents(
      sseResponse(['data: {json rotto}\n\n', 'data: {"type":"done"}\n\n']),
    );
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('sintetizza auth-required su una risposta 401', async () => {
    const events = await collectEvents(new Response('{"error":"unauthorized"}', { status: 401 }));
    expect(events).toEqual([{ type: 'auth-required' }]);
  });

  it('emette un errore leggibile su status non-ok', async () => {
    const events = await collectEvents(new Response('errore', { status: 500 }));
    expect(events).toEqual([{ type: 'error', message: 'Backend ha risposto 500' }]);
  });

  it('emette un errore leggibile se il backend è irraggiungibile', async () => {
    const events = await collectEvents(new TypeError('fetch failed'));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });

  it('manda il bearer token quando fornito', async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: {"type":"done"}\n\n']));
    vi.stubGlobal('fetch', fetchMock);
    await streamAsk('http://proxy.test', REQUEST, () => {}, undefined, 'tok123');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123');
  });
});
