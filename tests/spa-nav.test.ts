import { describe, expect, it } from 'vitest';
import { waitForSpaRender, type SpaRenderProbe, type SpaRenderProgress } from '../lib/spa-nav';

const LONG = 'contenuto articolo '.repeat(5); // > 50 char

// Probe deterministico: a ogni poll il loop chiama identity() e poi text();
// text() avanza al frame successivo, così pilotiamo la sequenza di render.
function scriptedProbe(frames: Array<{ id: string; text: string }>): SpaRenderProbe {
  let i = 0;
  const at = () => frames[Math.min(i, frames.length - 1)];
  return {
    identity: () => at().id,
    text: () => {
      const f = at();
      i++;
      return f.text;
    },
  };
}

const opts = (probe: SpaRenderProbe) => ({ probe, pollMs: 1, stablePolls: 2, timeoutMs: 1000 });

describe('waitForSpaRender', () => {
  it('risolve true quando la route è arrivata e il testo è stabile', async () => {
    const probe = scriptedProbe([
      { id: 'other', text: '' }, // non ancora arrivato
      { id: 'want', text: LONG }, // arrivato, testo nuovo → stable=1
      { id: 'want', text: LONG }, // stesso testo → stable=2 → true
    ]);
    expect(await waitForSpaRender('want', () => false, opts(probe))).toBe(true);
  });

  it('risolve false se il testo non si stabilizza mai (timeout)', async () => {
    let n = 0;
    const probe: SpaRenderProbe = {
      identity: () => 'want',
      text: () => LONG + n++, // cambia a ogni poll → mai stabile
    };
    expect(await waitForSpaRender('want', () => false, { ...opts(probe), timeoutMs: 5 })).toBe(
      false,
    );
  });

  it('risolve false se la pagina resta vuota/troppo corta', async () => {
    const probe = scriptedProbe([{ id: 'want', text: 'x' }]); // < 50 char
    expect(await waitForSpaRender('want', () => false, { ...opts(probe), timeoutMs: 5 })).toBe(
      false,
    );
  });

  it('risolve false se non si arriva mai alla route attesa', async () => {
    const probe = scriptedProbe([{ id: 'altro', text: LONG }]);
    expect(await waitForSpaRender('want', () => false, { ...opts(probe), timeoutMs: 5 })).toBe(
      false,
    );
  });

  it('risolve false subito se abortito', async () => {
    const probe = scriptedProbe([{ id: 'want', text: LONG }]);
    expect(await waitForSpaRender('want', () => true, opts(probe))).toBe(false);
  });
});

// L'attesa dura ~1s nel caso tipico e fino a 9s nel peggiore, due volte per
// articolo. onProgress è ciò che permette di mostrarla come barra determinata
// invece di uno shimmer che non dice se stia succedendo qualcosa.
describe('waitForSpaRender · onProgress', () => {
  it('riporta arrivo, caratteri, stabilità e tempo trascorso monotono', async () => {
    const probe = scriptedProbe([
      { id: 'other', text: '' },
      { id: 'want', text: LONG },
      { id: 'want', text: LONG },
    ]);
    const seen: SpaRenderProgress[] = [];
    const ok = await waitForSpaRender('want', () => false, {
      ...opts(probe),
      onProgress: (p) => seen.push(p),
    });

    expect(ok).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(3);
    expect(seen[0]).toMatchObject({ arrived: false, chars: 0, stable: 0, elapsedMs: 0 });
    expect(seen[1]).toMatchObject({ arrived: true, stable: 1 });
    expect(seen[1].chars).toBeGreaterThan(50);
    // Il tempo trascorso non torna mai indietro, e il timeout è sempre in chiaro
    // (serve a calcolare la frazione di barra).
    const elapsed = seen.map((p) => p.elapsedMs);
    expect(elapsed).toEqual([...elapsed].sort((a, b) => a - b));
    expect(seen.every((p) => p.timeoutMs === 1000)).toBe(true);
  });

  it('riporta l’ultimo poll anche quando il render è riuscito', async () => {
    const probe = scriptedProbe([
      { id: 'want', text: LONG },
      { id: 'want', text: LONG },
    ]);
    const seen: SpaRenderProgress[] = [];
    await waitForSpaRender('want', () => false, {
      ...opts(probe),
      onProgress: (p) => seen.push(p),
    });
    expect(seen.at(-1)).toMatchObject({ arrived: true, stable: 2 });
  });

  it('una callback che lancia non rompe l’attesa', async () => {
    const probe = scriptedProbe([
      { id: 'want', text: LONG },
      { id: 'want', text: LONG },
    ]);
    const ok = await waitForSpaRender('want', () => false, {
      ...opts(probe),
      onProgress: () => {
        throw new Error('la UI non deve poter fermare il tour');
      },
    });
    expect(ok).toBe(true);
  });

  it('non viene chiamata se l’attesa è abortita prima del primo poll', async () => {
    const probe = scriptedProbe([{ id: 'want', text: LONG }]);
    const seen: SpaRenderProgress[] = [];
    await waitForSpaRender('want', () => true, { ...opts(probe), onProgress: (p) => seen.push(p) });
    expect(seen).toEqual([]);
  });
});
