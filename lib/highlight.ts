// Scroll-to + highlight a link on the HOST page during a visual tour.
//
// This operates on the host document (Wikipedia in the demo), NOT the sidebar's
// shadow root — so the highlight style is injected into `document.head` and the
// anchor is found via `document.querySelector`. Runs in the content-script
// context, where these globals are the host page.
import { normalizeUrl } from './tour';

const STYLE_ID = 'rs-tour-style';
const HL_CLASS = 'rs-tour-highlight';

/** Inject the highlight stylesheet into the host page once. */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${HL_CLASS} {
      outline: 3px solid #f59e0b !important;
      outline-offset: 2px !important;
      background: rgba(245, 158, 11, 0.28) !important;
      border-radius: 3px !important;
      box-shadow: 0 0 0 6px rgba(245, 158, 11, 0.18) !important;
      scroll-margin: 40vh !important;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Find the host-page anchor whose fragment-stripped href matches `targetUrl`.
 * Uses the same normalization as extractInternalLinks so the target captured on
 * the start page reliably matches its live anchor.
 */
export function findLinkElement(targetUrl: string): HTMLAnchorElement | null {
  const want = normalizeUrl(targetUrl);
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    if (normalizeUrl(href) === want) return a as HTMLAnchorElement;
  }
  return null;
}

/**
 * Scroll the element into view and highlight it. Returns a cleanup function that
 * removes the highlight.
 */
export function scrollAndHighlight(el: HTMLElement): () => void {
  ensureStyle();
  el.classList.add(HL_CLASS);
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  return () => el.classList.remove(HL_CLASS);
}

/** Promise-based pause; covers the smooth-scroll animation before navigating. */
export function dwell(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
