// Navigazione SPA per la KB Salesforce (Aura).
//
// Le pagine sono client-rendered e la navigazione interna è client-side
// (pushState, niente full reload): cliccare un link fa cambiare route e
// renderizzare il nuovo contenuto in ~1s, SENZA ricaricare il content-script
// (confermato dal recon-3). Quindi il tour può camminare tra gli articoli
// leggendo il DOM renderizzato, invece di fare fetch (che vedrebbe solo lo
// shell). waitForSpaRender è il cuore: attende che la route sia arrivata e che
// il contenuto sia renderizzato e STABILE (non un tempo fisso, che è fragile).
import { linkIdentity } from './site-profile';

export interface SpaRenderProbe {
  /** Identità (origin+path) della pagina attualmente mostrata. */
  identity(): string;
  /** Testo del content-root attualmente renderizzato. */
  text(): string;
}

const defaultProbe: SpaRenderProbe = {
  identity: () => linkIdentity(new URL(location.href)),
  text: () => {
    const el = document.querySelector('[role="main"]') ?? document.body;
    return (el instanceof HTMLElement ? el.innerText : (el?.textContent ?? '')) || '';
  },
};

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WaitForSpaRenderOptions {
  timeoutMs?: number;
  pollMs?: number;
  /** Poll consecutivi con testo identico richiesti per considerare stabile il render. */
  stablePolls?: number;
  /** Lunghezza minima del testo per considerare la pagina "renderizzata" (non vuota). */
  minChars?: number;
  probe?: SpaRenderProbe;
}

/**
 * Attende che la SPA sia arrivata a `wantIdentity` e il contenuto sia
 * renderizzato e stabile. Ritorna false su timeout o abort. Nessuna dipendenza
 * da tempi fissi: si basa sulla stabilità del testo del content-root.
 */
export async function waitForSpaRender(
  wantIdentity: string,
  shouldAbort: () => boolean = () => false,
  options: WaitForSpaRenderOptions = {},
): Promise<boolean> {
  const {
    timeoutMs = 9_000,
    pollMs = 100,
    stablePolls = 4,
    minChars = 50,
    probe = defaultProbe,
  } = options;
  const maxIter = Math.max(1, Math.ceil(timeoutMs / Math.max(1, pollMs)));
  let lastText: string | null = null;
  let stable = 0;

  for (let i = 0; i < maxIter; i++) {
    if (shouldAbort()) return false;
    const arrived = probe.identity() === wantIdentity;
    const text = probe.text().replace(/\s+/g, ' ').trim();
    if (arrived && text.length >= minChars) {
      if (text === lastText) {
        if (++stable >= stablePolls) return true;
      } else {
        lastText = text;
        stable = 1; // il poll corrente è la prima osservazione stabile
      }
    } else {
      lastText = null;
      stable = 0;
    }
    await delay(pollMs);
  }
  return false;
}
