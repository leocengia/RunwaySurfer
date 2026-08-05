// Visual-tour FX orchestration entry point.
//
// All effects live in the HOST page DOM (not the sidebar shadow root): one
// injected <style id="rs-fx-style"> holds every rule/keyframe, and every
// element uses the rs-fx- prefix so teardownFx() can sweep everything away.
// The shared design tokens ride along in the same <style> (shared/theme.css,
// whose `:root` block matches the host page's <html>), so the tour uses the
// same palette as the sidebar and the dashboard instead of its own literals.
//
// z-index ladder (sidebar stays on top at 2147483647):
//   spotlight 2147483640 < beam 2147483641 < banner 2147483645 < cursor 2147483646

import themeTokensCss from '../../shared/theme.css?inline';
import { stopNarration } from './banner';

export const FX_STYLE_ID = 'rs-fx-style';
const LEGACY_STYLE_ID = 'rs-tour-style';
/** Classe su <html> attiva per l'intera durata del tour. */
export const FX_TOUR_CLASS = 'rs-fx-tour';

const FX_CSS = `
  /* La KB Salesforce mostra il proprio spinner Lightning al centro della pagina
     a ogni route Aura. Durante il tour l'avanzamento lo raccontano già la barra
     in alto e la timeline in sidebar: un terzo indicatore, centrato e slegato
     dagli altri, dice solo "aspetta" senza dire quanto. Nascosto solo mentre il
     tour è in corso (classe su <html>), quindi la KB resta intatta fuori dal tour. */
  html.${FX_TOUR_CLASS} #auraLoadingBox,
  html.${FX_TOUR_CLASS} .slds-spinner,
  html.${FX_TOUR_CLASS} .slds-spinner_container,
  html.${FX_TOUR_CLASS} lightning-spinner {
    display: none !important;
  }

  .rs-tour-highlight {
    outline: 2px solid var(--rs-primary, #000099) !important;
    outline-offset: 2px !important;
    background: rgba(255, 204, 0, 0.22) !important;
    border-radius: 4px !important;
    scroll-margin: 40vh !important;
    animation: rs-fx-pulse 1.2s ease-in-out infinite;
  }
  @keyframes rs-fx-pulse {
    0%, 100% { box-shadow: 0 0 0 3px rgba(255, 204, 0, 0.7), 0 0 10px 3px rgba(255, 204, 0, 0.25); }
    50% { box-shadow: 0 0 0 5px rgba(255, 204, 0, 0.35), 0 0 18px 7px rgba(255, 204, 0, 0.35); }
  }

  /* Parte invisibile e compare solo quando spotlight.ts l'ha agganciato al
     bersaglio (classe rs-fx-ready). Senza questo, il gradiente coi default
     --rs-spot-* disegnava un cerchio luminoso al CENTRO di una pagina scurita:
     letto come un caricamento centrale, in competizione con la barra in alto. */
  #rs-fx-spotlight {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483640;
    opacity: 0;
    background: radial-gradient(
      circle at var(--rs-spot-x, 50%) var(--rs-spot-y, 50%),
      transparent var(--rs-spot-r, 80px),
      rgba(2, 2, 40, 0.34) calc(var(--rs-spot-r, 80px) + 50px)
    );
    transition: opacity 250ms ease-out;
  }
  #rs-fx-spotlight.rs-fx-ready {
    opacity: 1;
  }

  #rs-fx-cursor {
    position: fixed;
    width: 28px;
    height: 28px;
    pointer-events: none;
    z-index: 2147483646;
    filter: drop-shadow(0 0 4px rgba(255, 204, 0, 0.8));
    transition: none;
  }
  #rs-fx-cursor.rs-fx-hidden { opacity: 0; }
  #rs-fx-cursor::after {
    content: '';
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    background: radial-gradient(circle, rgba(255, 204, 0, 0.22), transparent 70%);
  }
  #rs-fx-cursor.rs-fx-press svg { animation: rs-fx-press 200ms ease-in-out; }
  @keyframes rs-fx-press {
    0%, 100% { transform: scale(1); }
    50% { transform: scale(0.82); }
  }
  .rs-fx-ripple {
    position: fixed;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border: 3px solid var(--rs-yellow, #ffcc00);
    border-radius: 50%;
    pointer-events: none;
    z-index: 2147483646;
    animation: rs-fx-ripple 450ms ease-out forwards;
  }
  @keyframes rs-fx-ripple {
    from { transform: scale(1); opacity: 0.95; }
    to { transform: scale(1.9); opacity: 0; }
  }

  /* --rs-fx-right è la larghezza occupata dalla sidebar: il vetro della barra si
     ferma al bordo del pannello invece di correrci sotto. La sidebar la aggiorna
     a ogni resize/apertura (App.tsx), quindi non può più desincronizzarsi. */
  /* L'altezza segue la banda blu della KB (--rs-host-header-h, misurata da
     lib/host-chrome.ts e scritta su <html> dalla sidebar): così la barra si
     sovrappone esattamente a quella del sito invece di tagliarla a metà. */
  #rs-fx-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: var(--rs-fx-right, 0px);
    height: var(--rs-host-header-h, 44px);
    min-height: 44px;
    z-index: 2147483645;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    box-sizing: border-box;
    background: linear-gradient(90deg, rgba(0, 0, 153, 0.78), rgba(22, 104, 227, 0.7));
    -webkit-backdrop-filter: blur(14px) saturate(170%);
    backdrop-filter: blur(14px) saturate(170%);
    border-bottom: 1px solid rgba(255, 255, 255, 0.16);
    color: #fff;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    font-size: 13px;
    box-shadow: 0 2px 12px rgba(2, 2, 40, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.22);
    transition: right 140ms ease;
    animation: rs-fx-banner-in 350ms ease-out;
  }
  @keyframes rs-fx-banner-in {
    from { transform: translateY(-100%); }
    to { transform: translateY(0); }
  }
  .rs-fx-banner-mark {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    line-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    filter: drop-shadow(0 1px 3px rgba(2, 2, 40, 0.45));
  }
  .rs-fx-banner-title { flex-shrink: 0; font-weight: 800; white-space: nowrap; letter-spacing: 0.02em; }
  .rs-fx-banner-step {
    flex-shrink: 0;
    background: var(--rs-yellow, #ffcc00);
    color: var(--rs-navy, #191e3b);
    font-weight: 800;
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 999px;
    white-space: nowrap;
  }
  .rs-fx-banner-narr {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    opacity: 0.95;
  }
  .rs-fx-caret {
    display: inline-block;
    width: 7px;
    margin-left: 2px;
    border-bottom: 2px solid var(--rs-yellow, #ffcc00);
    animation: rs-fx-blink 700ms step-end infinite;
  }
  @keyframes rs-fx-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  /* Percentuale accanto alla barra: durante un'attesa lunga un numero che sale
     è l'unica cosa che distingue "sta lavorando" da "è piantato". */
  .rs-fx-banner-pct {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    opacity: 0.9;
    min-width: 30px;
    text-align: right;
  }
  .rs-fx-banner-bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    background: rgba(255, 255, 255, 0.12);
    overflow: hidden;
  }
  .rs-fx-banner-fill {
    height: 100%;
    width: 0%;
    background: var(--rs-yellow, #ffcc00);
    transition: width 400ms ease;
  }
  .rs-fx-banner-fill.rs-fx-indeterminate {
    width: 100% !important;
    background: linear-gradient(
      90deg,
      transparent,
      var(--rs-yellow, #ffcc00) 40%,
      var(--rs-yellow-lite, #ffe680) 50%,
      var(--rs-yellow, #ffcc00) 60%,
      transparent
    );
    background-size: 50% 100%;
    background-repeat: no-repeat;
    animation: rs-fx-shimmer 1.1s linear infinite;
  }
  @keyframes rs-fx-shimmer {
    from { background-position: -60% 0; }
    to { background-position: 160% 0; }
  }
  #rs-fx-banner.rs-fx-done-flash { animation: rs-fx-done 600ms ease-out; }
  @keyframes rs-fx-done {
    0% { box-shadow: 0 2px 12px rgba(2, 2, 40, 0.4); }
    40% { box-shadow: 0 2px 26px rgba(255, 204, 0, 0.8); }
    100% { box-shadow: 0 2px 12px rgba(2, 2, 40, 0.4); }
  }

  #rs-fx-beam {
    position: fixed;
    left: 0;
    right: 0;
    top: -60px;
    height: 40px;
    pointer-events: none;
    z-index: 2147483641;
    background: linear-gradient(180deg, transparent, rgba(255, 204, 0, 0.08) 70%, rgba(255, 204, 0, 0.16));
    border-bottom: 1px solid rgba(255, 214, 51, 0.7);
  }
  @keyframes rs-fx-scan {
    from { top: -60px; }
    to { top: 105vh; }
  }

  .rs-scan-hit {
    background: var(--rs-yellow, #ffcc00) !important;
    color: var(--rs-navy, #191e3b) !important;
    padding: 0 !important;
    display: inline;
    border-radius: 2px;
    animation: rs-fx-hit 500ms ease-out both;
  }
  @keyframes rs-fx-hit {
    0% { background-color: transparent; box-shadow: none; }
    35% { background-color: #ffe14d; box-shadow: 0 0 9px 3px rgba(255, 204, 0, 0.7); }
    100% { background-color: rgba(255, 204, 0, 0.55); box-shadow: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    #rs-fx-banner, #rs-fx-spotlight, #rs-fx-cursor, #rs-fx-beam,
    .rs-fx-ripple, .rs-fx-caret, .rs-fx-banner-fill,
    .rs-tour-highlight, .rs-scan-hit {
      animation: none !important;
      transition: none !important;
    }
  }
`;

/**
 * Inject the FX stylesheet into the host page once and flag <html> for the whole
 * tour (the flag is what suppresses the host KB's own centered spinner).
 */
export function ensureFxStyles(): void {
  document.documentElement.classList.add(FX_TOUR_CLASS);
  if (document.getElementById(FX_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FX_STYLE_ID;
  // I token condivisi vanno per primi: le regole sotto li leggono con var().
  style.textContent = `${themeTokensCss}\n${FX_CSS}`;
  document.head.appendChild(style);
}

/**
 * Remove every FX artifact from the host page. Idempotent — safe to call from
 * abort, completion, re-init and the bfcache safety net.
 */
export function teardownFx(): void {
  // Stop the typewriter interval before detaching the banner, otherwise it
  // keeps firing on a now-removed node until the text finishes.
  stopNarration();
  document.documentElement.classList.remove(FX_TOUR_CLASS);
  document.documentElement.style.removeProperty('--rs-fx-right');
  for (const id of ['rs-fx-banner', 'rs-fx-spotlight', 'rs-fx-cursor', 'rs-fx-beam']) {
    document.getElementById(id)?.remove();
  }
  document.querySelectorAll('.rs-fx-ripple').forEach((el) => el.remove());
  document
    .querySelectorAll('.rs-tour-highlight')
    .forEach((el) => el.classList.remove('rs-tour-highlight'));
  document.querySelectorAll('.rs-scan-hit').forEach((mark) => {
    const parent = mark.parentNode;
    mark.replaceWith(...Array.from(mark.childNodes));
    parent?.normalize();
  });
  document.getElementById(FX_STYLE_ID)?.remove();
  document.getElementById(LEGACY_STYLE_ID)?.remove();
}

let safetyNetInstalled = false;

/**
 * bfcache back-navigation restores the host DOM (with any live FX elements)
 * without re-running the content-script mount — sweep on pageshow.
 */
export function installFxSafetyNet(): void {
  if (safetyNetInstalled) return;
  safetyNetInstalled = true;
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) teardownFx();
  });
}

export * from './motion';
export * from './banner';
export * from './spotlight';
export * from './cursor';
export * from './scan';
