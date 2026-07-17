import { describe, expect, it } from 'vitest';
import { waitForSpaRender, type SpaRenderProbe } from '../lib/spa-nav';

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
