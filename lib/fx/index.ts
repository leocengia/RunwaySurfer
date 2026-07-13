// Visual-tour FX orchestration entry point.
//
// All effects live in the HOST page DOM (not the sidebar shadow root): one
// injected <style id="rs-fx-style"> holds every rule/keyframe, and every
// element uses the rs-fx- prefix so teardownFx() can sweep everything away.
//
// z-index ladder (sidebar stays on top at 2147483647):
//   spotlight 2147483640 < beam 2147483641 < banner 2147483645 < cursor 2147483646

import { stopNarration } from './banner';

export const FX_STYLE_ID = 'rs-fx-style';
const LEGACY_STYLE_ID = 'rs-tour-style';

const FX_CSS = `
  .rs-tour-highlight {
    outline: 2px solid #0b1f3a !important;
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

  #rs-fx-spotlight {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 2147483640;
    background: radial-gradient(
      circle at var(--rs-spot-x, 50%) var(--rs-spot-y, 50%),
      transparent var(--rs-spot-r, 80px),
      rgba(4, 16, 34, 0.32) calc(var(--rs-spot-r, 80px) + 50px)
    );
    animation: rs-fx-fade-in 250ms ease-out;
  }
  @keyframes rs-fx-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
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
    border: 3px solid #ffcc00;
    border-radius: 50%;
    pointer-events: none;
    z-index: 2147483646;
    animation: rs-fx-ripple 450ms ease-out forwards;
  }
  @keyframes rs-fx-ripple {
    from { transform: scale(1); opacity: 0.95; }
    to { transform: scale(1.9); opacity: 0; }
  }

  #rs-fx-banner {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: 44px;
    z-index: 2147483645;
    pointer-events: none;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    box-sizing: border-box;
    background: linear-gradient(90deg, rgba(11, 31, 58, 0.72), rgba(0, 53, 95, 0.72));
    -webkit-backdrop-filter: blur(12px) saturate(160%);
    backdrop-filter: blur(12px) saturate(160%);
    border-bottom: 1px solid rgba(255, 255, 255, 0.14);
    color: #fff;
    font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
    font-size: 13px;
    box-shadow: 0 2px 12px rgba(4, 16, 34, 0.4);
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
    border-radius: 50%;
    background: #ffcc00;
    color: #0b1f3a;
    font-weight: 900;
    font-size: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rs-fx-banner-title { flex-shrink: 0; font-weight: 800; white-space: nowrap; }
  .rs-fx-banner-step {
    flex-shrink: 0;
    background: #ffcc00;
    color: #0b1f3a;
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
    border-bottom: 2px solid #ffcc00;
    animation: rs-fx-blink 700ms step-end infinite;
  }
  @keyframes rs-fx-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  .rs-fx-banner-stop {
    flex-shrink: 0;
    pointer-events: auto;
    border: 1px solid rgba(255, 255, 255, 0.35);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.1);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    color: #fff;
    font: inherit;
    font-size: 11px;
    font-weight: 800;
    padding: 4px 10px;
    cursor: pointer;
  }
  .rs-fx-banner-stop:hover { background: rgba(255, 255, 255, 0.18); }
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
    background: #ffcc00;
    transition: width 400ms ease;
  }
  .rs-fx-banner-fill.rs-fx-indeterminate {
    width: 100% !important;
    background: linear-gradient(90deg, transparent, #ffcc00 40%, #ffe680 50%, #ffcc00 60%, transparent);
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
    0% { box-shadow: 0 2px 12px rgba(4, 16, 34, 0.4); }
    40% { box-shadow: 0 2px 26px rgba(255, 204, 0, 0.8); }
    100% { box-shadow: 0 2px 12px rgba(4, 16, 34, 0.4); }
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
    background: #ffcc00 !important;
    color: #0b1f3a !important;
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

/** Inject the FX stylesheet into the host page once. */
export function ensureFxStyles(): void {
  if (document.getElementById(FX_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = FX_STYLE_ID;
  style.textContent = FX_CSS;
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
