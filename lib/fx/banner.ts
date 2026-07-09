// Tour progress banner injected at the top of the HOST page: brand mark,
// step pill, typewriter narration, stop button and a progress bar. Visible
// even when the sidebar is closed, so the agent always knows what the tour
// is doing and can stop it.
import type { KbLink } from '../outcome';
import { markTourAborted } from '../tour';
import { prefersReducedMotion } from './motion';

const BANNER_ID = 'rs-fx-banner';
/** DOM event the sidebar listens to for a live abort (see App.tsx). */
export const TOUR_ABORT_EVENT = 'rs-tour-abort';

export interface BannerOptions {
  step: number;
  total: number;
  /** Width (px) taken by the sidebar so the stop button is never covered. */
  rightOffsetPx: number;
}

function bannerEl(): HTMLElement | null {
  return document.getElementById(BANNER_ID);
}

/** Mount (or update) the tour banner. Idempotent across driveTour iterations. */
export function mountBanner(options: BannerOptions): void {
  let banner = bannerEl();
  if (!banner) {
    banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.innerHTML = `
      <span class="rs-fx-banner-mark">RS</span>
      <span class="rs-fx-banner-title">RunwaySurfer · Tour visivo</span>
      <span class="rs-fx-banner-step"></span>
      <span class="rs-fx-banner-narr" aria-live="polite"></span>
      <button class="rs-fx-banner-stop" type="button">Interrompi</button>
      <div class="rs-fx-banner-bar"><div class="rs-fx-banner-fill"></div></div>
    `;
    banner.querySelector('.rs-fx-banner-stop')?.addEventListener('click', () => {
      // Live layer: wake the sidebar's stopTour. Cross-navigation layer: the
      // storage stamp survives even if this page dies mid-click.
      window.dispatchEvent(new CustomEvent(TOUR_ABORT_EVENT));
      void markTourAborted();
    });
    document.documentElement.appendChild(banner);
  }
  banner.style.paddingRight = `${options.rightOffsetPx + 16}px`;
  setBannerStep(options.step, options.total);
}

export function setBannerStep(step: number, total: number): void {
  const el = bannerEl()?.querySelector('.rs-fx-banner-step');
  if (el) el.textContent = total > 0 ? `passo ${step}/${total}` : 'analisi';
}

export function setBannerProgress(fraction: number, indeterminate = false): void {
  const fill = bannerEl()?.querySelector('.rs-fx-banner-fill') as HTMLElement | null;
  if (!fill) return;
  fill.classList.toggle('rs-fx-indeterminate', indeterminate && !prefersReducedMotion());
  fill.style.width = `${Math.round(Math.min(1, Math.max(0, fraction)) * 100)}%`;
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
      i = Math.min(text.length, i + 2);
      narr.textContent = text.slice(0, i);
      if (i < text.length) {
        narr.appendChild(caret);
      } else {
        clearInterval(timer);
        cancelNarration = null;
        resolve();
      }
    }, 24);
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
