// Locate a tour target's anchor on the HOST page.
//
// This operates on the host document (Wikipedia in the demo), NOT the sidebar's
// shadow root. The visual effects that used to live here (highlight style,
// scroll, dwell) moved to lib/fx/.
import { normalizeUrl } from './tour';

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
