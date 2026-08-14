// Spotlight ("riflettore") on the tour target: a fixed overlay with a radial-
// gradient hole dims the page around the link while a pulsing brand halo
// (class rs-tour-highlight, styled in fx/index.ts) marks the link itself.
//
// The overlay technique is robust on arbitrary pages: a box-shadow with a huge
// spread on the element would get clipped by ancestor overflow/stacking
// contexts. The hole is transparent, so the link stays fully readable with no
// z-index games, and rAF-throttled scroll/resize listeners keep the hole glued
// to the target while the eased scroll (or the user) moves the page.
import { prefersReducedMotion } from './motion';

const SPOTLIGHT_ID = 'rs-fx-spotlight';
const HL_CLASS = 'rs-tour-highlight';

/**
 * Dim the page around `el` and pulse its halo. Returns a cleanup closure.
 * No-op (highlight only) under reduced motion; full no-op on a 0x0 target.
 */
/**
 * Rimuove il velo, se presente. Idempotente: il driver la chiama a ogni giro del
 * tour, perché una route SPA può ridisegnare la pagina lasciando attaccato un
 * overlay la cui closure di cleanup non è più raggiungibile.
 */
export function removeSpotlight(): void {
  document.getElementById(SPOTLIGHT_ID)?.remove();
}

export function spotlightOn(el: HTMLElement): () => void {
  const rect = el.getBoundingClientRect();
  // `||` e non `&&`: un rect 0×20 non ha un centro utilizzabile più di uno 0×0,
  // e il buco del riflettore finirebbe fuori posto.
  if (rect.width === 0 || rect.height === 0) return () => {};

  el.classList.add(HL_CLASS);
  if (prefersReducedMotion()) {
    return () => el.classList.remove(HL_CLASS);
  }

  document.getElementById(SPOTLIGHT_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = SPOTLIGHT_ID;

  let frame = 0;
  const track = () => {
    frame = 0;
    // Il bersaglio può essere stato staccato da una route SPA dopo il mount:
    // in quel caso il buco resta dov'era invece di migrare in alto a sinistra.
    if (!el.isConnected) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    overlay.style.setProperty('--rs-spot-x', `${r.left + r.width / 2}px`);
    overlay.style.setProperty('--rs-spot-y', `${r.top + r.height / 2}px`);
    overlay.style.setProperty('--rs-spot-r', `${Math.max(r.width, r.height) / 2 + 50}px`);
  };
  // Posiziona PRIMA di attaccare: con i default del gradiente (50%/50%) il velo
  // comparirebbe come un alone luminoso al centro della pagina, indistinguibile
  // da un caricamento. La classe rs-fx-ready fa poi la dissolvenza in entrata.
  track();
  document.documentElement.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('rs-fx-ready'));

  const requestTrack = () => {
    if (!frame) frame = requestAnimationFrame(track);
  };
  window.addEventListener('scroll', requestTrack, { passive: true });
  window.addEventListener('resize', requestTrack);

  return () => {
    window.removeEventListener('scroll', requestTrack);
    window.removeEventListener('resize', requestTrack);
    if (frame) cancelAnimationFrame(frame);
    overlay.remove();
    el.classList.remove(HL_CLASS);
  };
}
