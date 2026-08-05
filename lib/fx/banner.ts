// Tour progress banner injected at the top of the HOST page: brand mark, step
// pill, typewriter narration and a progress bar with its percentage. Visible
// even when the sidebar is closed, so the agent always knows what the tour is
// doing.
//
// Non porta il pulsante di stop: interrompere il tour si fa dalla timeline in
// sidebar (TourTimeline), dove vive anche il resto dello stato. Un solo posto da
// cui fermare, invece di due comandi identici su due superfici.
import { LOGO_SVG } from '../../shared/logo';
import type { KbLink } from '../outcome';
import { prefersReducedMotion } from './motion';

const BANNER_ID = 'rs-fx-banner';

export interface BannerOptions {
  step: number;
  total: number;
  /** Width (px) taken by the sidebar: il vetro della barra si ferma lì. */
  rightOffsetPx: number;
}

function bannerEl(): HTMLElement | null {
  return document.getElementById(BANNER_ID);
}

/**
 * Larghezza riservata alla sidebar. Vive come custom property su <html> (non
 * come padding del banner) così la sidebar può aggiornarla a ogni resize senza
 * rimontare la barra: prima l'offset veniva calcolato solo in mountBanner e
 * restava disallineato per tutto il passo successivo.
 */
export function setBannerOffset(rightOffsetPx: number): void {
  document.documentElement.style.setProperty('--rs-fx-right', `${Math.max(0, rightOffsetPx)}px`);
}

/** Mount (or update) the tour banner. Idempotent across driveTour iterations. */
export function mountBanner(options: BannerOptions): void {
  let banner = bannerEl();
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.innerHTML = `
      <span class="rs-fx-banner-mark">${LOGO_SVG}</span>
      <span class="rs-fx-banner-title">Runway Surfer · Immersiva</span>
      <span class="rs-fx-banner-step"></span>
      <span class="rs-fx-banner-narr" aria-live="polite"></span>
      <span class="rs-fx-banner-pct"></span>
      <div class="rs-fx-banner-bar"><div class="rs-fx-banner-fill"></div></div>
    `;
    document.documentElement.appendChild(banner);
  }
  setBannerOffset(options.rightOffsetPx);
  setBannerStep(options.step, options.total);
}

export function setBannerStep(step: number, total: number): void {
  const el = bannerEl()?.querySelector('.rs-fx-banner-step');
  if (el) el.textContent = total > 0 ? `passo ${step}/${total}` : 'analisi';
}

/**
 * Set the progress fill. When `durationMs` is given the fill glides toward the
 * target over that span (matching the phase's own duration), so the bar advances
 * continuously instead of snapping in coarse steps. Otherwise it uses the CSS
 * default transition.
 */
export function setBannerProgress(
  fraction: number,
  indeterminate = false,
  durationMs?: number,
): void {
  const banner = bannerEl();
  const fill = banner?.querySelector('.rs-fx-banner-fill') as HTMLElement | null;
  if (!fill) return;
  fill.classList.toggle('rs-fx-indeterminate', indeterminate && !prefersReducedMotion());
  if (typeof durationMs === 'number' && !prefersReducedMotion()) {
    fill.style.transitionDuration = `${durationMs}ms`;
    fill.style.transitionTimingFunction = 'linear';
  } else {
    fill.style.transitionDuration = '';
    fill.style.transitionTimingFunction = '';
  }
  const clamped = Math.min(1, Math.max(0, fraction));
  fill.style.width = `${Math.round(clamped * 100)}%`;
  const pct = banner?.querySelector('.rs-fx-banner-pct');
  // Con lo shimmer indeterminato la percentuale mentirebbe: meglio niente.
  if (pct) pct.textContent = indeterminate ? '' : `${Math.round(clamped * 100)}%`;
}

/** Fill the bar, flash the banner and show the closing message. */
export function bannerComplete(text: string): void {
  const banner = bannerEl();
  if (!banner) return;
  setBannerProgress(1);
  banner.classList.add('rs-fx-done-flash');
  void narrate(text);
}

export function unmountBanner(): void {
  cancelNarration?.();
  bannerEl()?.remove();
}

let cancelNarration: (() => void) | null = null;

/**
 * Cancel any running typewriter interval without touching the DOM. Called by
 * teardownFx (which removes the banner by id) so the interval does not keep
 * firing on a detached node after an abort/teardown.
 */
export function stopNarration(): void {
  cancelNarration?.();
}

/**
 * Typewriter narration into the banner. A new call cancels the previous one;
 * the returned promise resolves when the text is fully typed (or immediately
 * under reduced motion).
 */
export function narrate(text: string): Promise<void> {
  const narr = bannerEl()?.querySelector('.rs-fx-banner-narr');
  cancelNarration?.();
  if (!narr) return Promise.resolve();
  if (prefersReducedMotion()) {
    narr.textContent = text;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let i = 0;
    narr.textContent = '';
    const caret = document.createElement('span');
    caret.className = 'rs-fx-caret';
    narr.appendChild(caret);
    const timer = setInterval(() => {
      i = Math.min(text.length, i + 3);
      narr.textContent = text.slice(0, i);
      if (i < text.length) {
        narr.appendChild(caret);
      } else {
        clearInterval(timer);
        cancelNarration = null;
        resolve();
      }
    }, 12);
    cancelNarration = () => {
      clearInterval(timer);
      narr.textContent = text;
      cancelNarration = null;
      resolve();
    };
  });
}

/** Narration line for the hub phase: which link we open and why. */
export function narrationOpen(target: KbLink, step: number, total: number): string {
  const found = target.matchedKeywords?.length
    ? `trovato: ${target.matchedKeywords.slice(0, 3).join(', ')}`
    : target.reason || 'link rilevante';
  return `Passo ${step}/${total}: apro «${target.text}» — ${found}…`;
}
