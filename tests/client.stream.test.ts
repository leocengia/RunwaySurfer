// Resilienza dello stream SSE.
//
// Questo file copre il bug che bloccava la sidebar: il loop di lettura non aveva
// try/catch, quindi un calo di rete a metà risposta rigettava fino all'onClick
// del pulsante, `status` restava su 'streaming' e l'unica via d'uscita era
// ricaricare la pagina. La regola che i test fissano è una sola: `streamAsk` non
// rigetta MAI — comunica sempre con un evento.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { streamAsk } from '../lib/client';
import type { AskEvent, AskRequest } from '../lib/outcome';

const REQUEST: AskRequest = { query: 'test', pages: [], links: [] };

/**
 * Stream che consegna qualche frame e poi MUORE, come una rete che cade.
 *
 * I frame arrivano da `pull`, uno per lettura, e NON da `start`: per specifica
 * `controller.error()` scarta la coda, quindi enfilare tutto in `start` e poi
 * chiamare error() farebbe sparire anche i frame che nella realtà l'agente ha
 * già visto a schermo.
 */
function dyingStream(frames: string[], error = new TypeError('network error')): Response {
  const encoder = new TextEncoder();
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent < frames.length) {
        controller.enqueue(encoder.encode(frames[sent++]));
        return;
      }
      controller.error(error);
    },
  });
  return new Response(body, { status: 200 });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

async function collect(response: Response, signal?: AbortSignal): Promise<AskEvent[]> {
  const events: AskEvent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response),
  );
  await streamAsk('http://proxy.test', REQUEST, (e) => events.push(e), signal);
  return events;
}

describe('streamAsk · lo stream si interrompe', () => {
  it('non rigetta: emette un evento error', async () => {
    // Il cuore del bug. `await` che non lancia È l'asserzione.
    const events = await collect(dyingStream(['data: {"type":"delta","text":"ciao"}\n\n']));
    expect(events.map((e) => e.type)).toEqual(['delta', 'error']);
  });

  it('tiene i delta già arrivati prima della caduta', async () => {
    const events = await collect(
      dyingStream(['data: {"type":"delta","text":"primo "}\n\n', 'data: {"type":"delta"']),
    );
    const text = events
      .filter((e): e is Extract<AskEvent, { type: 'delta' }> => e.type === 'delta')
      .map((e) => e.text)
      .join('');
    expect(text).toBe('primo ');
    expect(events.at(-1)?.type).toBe('error');
  });

  it('il messaggio dice all’agente che può riprovare', async () => {
    const events = await collect(dyingStream([]));
    const error = events.find((e) => e.type === 'error');
    expect(error).toBeDefined();
    expect(error && 'message' in error && error.message).toMatch(/riprova/i);
  });

  it('cade anche subito, senza un solo frame', async () => {
    const events = await collect(dyingStream([]));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
  });
});

describe('streamAsk · stop premuto dall’agente', () => {
  it('non emette errori: interrompere non è un guasto', async () => {
    // Prima, un abort volontario produceva un evento error con dentro
    // "AbortError": l'agente vedeva un errore rosso per aver premuto Stop.
    const controller = new AbortController();
    controller.abort();
    const events = await collect(
      dyingStream([], new DOMException('aborted', 'AbortError')),
      controller.signal,
    );
    expect(events).toEqual([]);
  });

  it('nemmeno se la fetch iniziale viene interrotta', async () => {
    const controller = new AbortController();
    controller.abort();
    const events: AskEvent[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('aborted', 'AbortError');
      }),
    );
    await streamAsk(
      'http://proxy.test',
      REQUEST,
      (e) => events.push(e),
      controller.signal,
      'token',
    );
    expect(events).toEqual([]);
  });
});

describe('streamAsk · timeout di inattività', () => {
  it('interrompe uno stream che resta muto e lo dice', async () => {
    vi.useFakeTimers();
    try {
      // Backend che accetta la connessione e poi tace. Lo stub RISPETTA il
      // signal — come fa la fetch vera: senza questo collegamento l'abort del
      // timeout non arriverebbe mai al reader e il test misurerebbe nulla.
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = new ReadableStream<Uint8Array>({
            start(controller) {
              init.signal?.addEventListener('abort', () =>
                controller.error(new DOMException('aborted', 'AbortError')),
              );
            },
          });
          return new Response(body, { status: 200 });
        }),
      );
      const events: AskEvent[] = [];
      const done = streamAsk('http://proxy.test', REQUEST, (e) => events.push(e));
      await vi.advanceTimersByTimeAsync(31_000);
      await done;
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('error');
      expect(events[0] && 'message' in events[0] && events[0].message).toMatch(/second/i);
    } finally {
      vi.useRealTimers();
    }
  });

  it('una risposta lunga ma viva NON viene interrotta', async () => {
    // Il timeout è sull'inattività, non sulla durata: ogni delta riarma il
    // contatore. Senza questa distinzione una risposta articolata verrebbe
    // troncata a metà proprio quando serve di più.
    vi.useFakeTimers();
    try {
      let sent = 0;
      const encoder = new TextEncoder();
      vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: string, init: RequestInit) => {
          const body = new ReadableStream<Uint8Array>({
            async pull(controller) {
              if (sent >= 5) {
                controller.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
                controller.close();
                return;
              }
              sent += 1;
              // 20s fra un pezzo e l'altro: sotto la soglia, per cinque volte
              // di fila. Totale 100s, ben oltre il timeout se fosse assoluto.
              await vi.advanceTimersByTimeAsync(20_000);
              if (init.signal?.aborted) return;
              controller.enqueue(encoder.encode(`data: {"type":"delta","text":"p${sent}"}\n\n`));
            },
          });
          return new Response(body, { status: 200 });
        }),
      );
      const events: AskEvent[] = [];
      await streamAsk('http://proxy.test', REQUEST, (e) => events.push(e));
      expect(events.filter((e) => e.type === 'delta')).toHaveLength(5);
      expect(events.at(-1)?.type).toBe('done');
      expect(events.some((e) => e.type === 'error')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Contratto con il keep-alive del backend (ASK_PING_MS in server/src/config.ts).
// Senza reverse proxy davanti, il silenzio mentre il modello ragiona è l'unica
// cosa che può far scattare il timeout di inattività qui sopra: il server manda
// un commento SSE ogni 15s. Questi test fissano le due proprietà su cui quel
// meccanismo si appoggia, così un refactoring del parser non le rompe in
// silenzio.
describe('streamAsk · commenti SSE del keep-alive', () => {
  it('un frame di commento non diventa un evento', async () => {
    const encoder = new TextEncoder();
    const frames = [
      ': ping\n\n',
      'data: {"type":"delta","text":"ciao"}\n\n',
      ': ping\n\n',
      'data: {"type":"done"}\n\n',
    ];
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent < frames.length) controller.enqueue(encoder.encode(frames[sent++]));
        else controller.close();
      },
    });
    const events = await collect(new Response(body, { status: 200 }));
    expect(events.map((e) => e.type)).toEqual(['delta', 'done']);
  });

  it('un commento riarma il contatore di inattività', async () => {
    vi.useFakeTimers();
    try {
      const encoder = new TextEncoder();
      // Solo ping per 90s — tre volte il budget di 30s — e poi la risposta.
      // Senza il riarmo a ogni chunk, questo stream verrebbe interrotto.
      const frames = [': ping\n\n', ': ping\n\n', ': ping\n\n', 'data: {"type":"done"}\n\n'];
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (sent >= frames.length) {
            controller.close();
            return;
          }
          const frame = frames[sent++];
          await vi.advanceTimersByTimeAsync(25_000);
          controller.enqueue(encoder.encode(frame));
        },
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response(body, { status: 200 })),
      );
      const events: AskEvent[] = [];
      await streamAsk('http://proxy.test', REQUEST, (e) => events.push(e));
      expect(events.map((e) => e.type)).toEqual(['done']);
    } finally {
      vi.useRealTimers();
    }
  });
});
