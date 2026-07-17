// Locate a tour target's anchor on the HOST page.
//
// This operates on the host document (Wikipedia in the demo), NOT the sidebar's
// shadow root. The visual effects that used to live here (highlight style,
// scroll, dwell) moved to lib/fx/.
import { linkIdentity } from './site-profile';

/**
 * Find the host-page anchor that points to the same page as `targetUrl`.
 * Matches by PATH IDENTITY (origin+pathname), non per URL pieno: sulla KB
 * Salesforce lo stesso articolo compare con param diversi (?language / ?nocache)
 * e il target memorizzato tiene solo ?language, quindi un confronto sull'URL
 * completo mancherebbe l'anchor. linkIdentity ignora query e fragment.
 */
export function findLinkElement(targetUrl: string): HTMLAnchorElement | null {
  let want: string;
  try {
    want = linkIdentity(new URL(targetUrl, location.href));
  } catch {
    return null;
  }
  for (const a of Array.from(document.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    try {
      if (linkIdentity(new URL(href, location.href)) === want) return a as HTMLAnchorElement;
    } catch {
      /* href non valido: salta */
    }
  }
  return null;
}
