// Locate and click a tour target's anchor on the HOST page.
//
// This operates on the host document (the KB), NOT the sidebar's shadow root.
// The visual effects that used to live here (highlight style, scroll, dwell)
// moved to lib/fx/.
import { pickLinkRoot } from './extract';
import { linkIdentity } from './site-profile';

/**
 * Il più "grande" fra gli anchor candidati, che in pratica è quello davvero
 * visibile: lo stesso articolo può essere linkato due volte nella stessa colonna
 * (una nel corpo, una nel pannello Suggested) e un anchor nascosto ha rect a zero.
 * Se nessuno è misurabile si tiene il primo in ordine di documento.
 */
function largestVisible(anchors: HTMLAnchorElement[]): HTMLAnchorElement | null {
  let best: HTMLAnchorElement | null = null;
  let bestArea = -1;
  for (const a of anchors) {
    const rect = a.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      best = a;
    }
  }
  return best;
}

/**
 * Find the host-page anchor that points to the same page as `targetUrl`.
 *
 * Matches by PATH IDENTITY (origin+pathname), non per URL pieno: sulla KB
 * Salesforce lo stesso articolo compare con param diversi (?language / ?nocache)
 * e il target memorizzato tiene solo ?language, quindi un confronto sull'URL
 * completo mancherebbe l'anchor. linkIdentity ignora query e fragment.
 *
 * PERCHÉ IL ROOT CONTA: la ricerca è limitata allo stesso root da cui vengono i
 * target (`pickLinkRoot`, cioè `[role="main"]` sulla KB). Prima si scandiva tutto
 * `document` e si prendeva il PRIMO match in ordine di documento — che sulla KB è
 * l'intestazione o il menu, dove gli stessi articoli sono duplicati con
 * `target="_blank"`. Risultato osservato: il tour apriva una scheda nuova, il tab
 * originale non navigava, e il driver tornava indietro da una pagina che non si
 * era mossa, portando l'agente via dalla pagina di partenza.
 *
 * Ritorna `null` se l'anchor non è nel root: chi chiama ha una via alternativa
 * (navigazione esplicita) più sicura del click su un elemento di menu.
 */
export function findLinkElement(
  targetUrl: string,
  root: ParentNode = pickLinkRoot(document),
): HTMLAnchorElement | null {
  let want: string;
  try {
    want = linkIdentity(new URL(targetUrl, location.href));
  } catch {
    return null;
  }
  const matches: HTMLAnchorElement[] = [];
  for (const a of Array.from(root.querySelectorAll('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    try {
      if (linkIdentity(new URL(href, location.href)) === want) {
        matches.push(a as HTMLAnchorElement);
      }
    } catch {
      /* href non valido: salta */
    }
  }
  return largestVisible(matches);
}

/**
 * Clicca un anchor forzandolo a restare NELLA STESSA SCHEDA.
 *
 * `target="_blank"` su un link della KB manda il tour in una scheda nuova: la
 * pagina di partenza non cambia route, l'attesa del render scade a vuoto, e
 * l'agente si ritrova con una scheda in più che non ha chiesto. Qui l'attributo
 * (e il `rel` che lo accompagna) viene rimosso per la durata del click e
 * ripristinato in un `finally`, così la pagina host resta esattamente come era.
 *
 * LIMITE NOTO: se la KB apre la finestra da un proprio handler JavaScript
 * (`window.open`) invece che con l'attributo, questo non basta — un content
 * script MV3 vive in un mondo isolato e non può sostituire `window.open` della
 * pagina. Il difetto osservato però era l'attributo, e `findLinkElement` ora evita
 * comunque gli anchor di menu che lo portano.
 */
export function clickInSameTab(el: HTMLAnchorElement): void {
  const target = el.getAttribute('target');
  const rel = el.getAttribute('rel');
  try {
    if (target !== null) el.removeAttribute('target');
    if (rel !== null) el.removeAttribute('rel');
    el.click();
  } finally {
    if (target !== null) el.setAttribute('target', target);
    if (rel !== null) el.setAttribute('rel', rel);
  }
}
