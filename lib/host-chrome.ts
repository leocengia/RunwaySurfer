// Misura la banda superiore della pagina host (l'header blu del sito KB), così
// l'header della sidebar e la barra del tour possono allinearsi a essa.
//
// Perché a runtime e non con un selettore fisso: di quell'header non esiste
// nessuna traccia nel repo — la recon della KB ha catturato solo il sottoalbero
// da `[role="main"]` in giù, quindi la chrome del sito non è mai stata mappata.
// E il tema Aura è responsive (vedi docs/MAPPA-KB.md), quindi l'altezza cambia
// col viewport. Da qui: candidati per nome, sonda geometrica di riserva,
// osservazione continua, e un override manuale per il caso in cui l'euristica
// scelga l'elemento sbagliato.
//
// Logica pura sul DOM, nessuna dipendenza dall'estensione: testabile in happy-dom.

/** Altezze accettabili per una banda di testata: fuori da qui è un altro elemento. */
const MIN_HEIGHT = 32;
const MAX_HEIGHT = 160;
/** Tolleranza sul bordo alto: un header sticky può stare a 1-2px da 0. */
const TOP_TOLERANCE = 2;
/** Quota di larghezza sotto la quale non è una banda ma un widget. */
const MIN_WIDTH_RATIO = 0.6;

/**
 * Candidati del tema Salesforce Experience Cloud, dal più specifico al più
 * generico.
 *
 * MISURATO sulla KB reale (pagina articolo, 2026-08-14): il primo candidato
 * combacia — `[data-region-name="themeHeader"]`, altezza **64px**. Nella stessa
 * pila esistono anche `.themeHeader forceCommunityThemeHeaderBase`, `.a11y-banner`
 * e `.header`, tutti alti 64: qualunque di essi darebbe la stessa misura.
 * I candidati successivi restano come rete se il tema viene ristilizzato.
 */
const HEADER_SELECTORS = [
  '[data-region-name="themeHeader"]',
  '.themeHeader',
  '.forceCommunityThemeHeader',
  '.siteforceThemeLayoutStarter > :first-child',
  '.slds-context-bar',
  'header[role="banner"]',
];

/** Altezza reale misurata sulla KB: è anche il fallback nel CSS. */
export const MEASURED_KB_HEADER_HEIGHT = 64;

function viewportWidth(): number {
  return window.innerWidth || 1024;
}

/** Una banda plausibile: attaccata in alto, larga, e di altezza da testata. */
function isHeaderBand(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  // Due modi di stare "in alto", e servono entrambi. L'header della KB reale è
  // `position: static`, quindi scorrendo esce dal viewport (misurato: top -800
  // dopo 800px di scroll): col solo controllo sul viewport la misura tornerebbe 0
  // ogni volta che la sidebar si monta su una pagina già scrollata, e l'header
  // collasserebbe al fallback. Il secondo controllo lo riconosce comunque, perché
  // resta in cima al DOCUMENTO. Il primo serve invece a un header sticky, che
  // resta in cima al viewport ma non a quello del documento.
  const atViewportTop = Math.abs(rect.top) <= TOP_TOLERANCE;
  const atDocumentTop = Math.abs(rect.top + window.scrollY) <= TOP_TOLERANCE;
  if (!atViewportTop && !atDocumentTop) return false;
  if (rect.height < MIN_HEIGHT || rect.height > MAX_HEIGHT) return false;
  if (rect.width < viewportWidth() * MIN_WIDTH_RATIO) return false;
  // Un elemento invisibile occupa spazio nel layout ma non dipinge nulla.
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
    return false;
  }
  return true;
}

/** Primo candidato per nome che superi i controlli geometrici. */
function findBySelector(): HTMLElement | null {
  for (const selector of HEADER_SELECTORS) {
    let found: Element | null = null;
    try {
      found = document.querySelector(selector);
    } catch {
      continue; // selettore non supportato dal browser: passa al prossimo
    }
    if (found instanceof HTMLElement && isHeaderBand(found)) return found;
  }
  return null;
}

/**
 * Ripiego geometrico: si guarda cosa c'è davvero dipinto vicino al bordo alto e
 * si sceglie il contenitore più esterno che sia una banda. Indipendente da
 * qualunque nome di classe, quindi sopravvive a un restyling della KB.
 */
function findByProbe(): HTMLElement | null {
  const x = Math.round(viewportWidth() * 0.25);
  const stack = document.elementsFromPoint?.(x, 8) ?? [];
  // elementsFromPoint va dal più interno al più esterno: l'ultimo che passa i
  // controlli è il contenitore della banda, non un suo figlio.
  let best: HTMLElement | null = null;
  for (const el of stack) {
    if (el === document.body || el === document.documentElement) continue;
    if (el instanceof HTMLElement && isHeaderBand(el)) best = el;
  }
  return best;
}

/** L'elemento della banda superiore della pagina host, se identificabile. */
export function findHostHeader(): HTMLElement | null {
  return findBySelector() ?? findByProbe();
}

/**
 * Altezza della banda superiore in px, arrotondata. `0` significa "non
 * identificabile": chi chiama tiene il proprio default invece di collassare
 * l'header a zero.
 */
export function measureHostHeaderHeight(): number {
  const el = findHostHeader();
  if (!el) return 0;
  const height = Math.round(el.getBoundingClientRect().height);
  // La pagina può essere in un momento di transizione (Aura che rimonta il
  // tema): un valore fuori forbice va scartato, non propagato.
  return height >= MIN_HEIGHT && height <= MAX_HEIGHT ? height : 0;
}

export interface ObserveOptions {
  /** Valore imposto a mano: se presente, si notifica quello e non si misura. */
  override?: number | null;
}

/**
 * Notifica l'altezza della banda e la rimisura quando cambia. Copre tre sorgenti
 * di cambiamento: il resize della finestra, il re-render responsive del tema
 * (ResizeObserver sull'elemento) e la comparsa tardiva dell'header, perché la KB
 * è client-rendered e al mount del content script il tema può non esistere
 * ancora (MutationObserver, staccato appena l'header si trova).
 *
 * Ritorna il disposer.
 */
export function observeHostHeader(
  onChange: (px: number) => void,
  options: ObserveOptions = {},
): () => void {
  if (typeof options.override === 'number' && options.override > 0) {
    onChange(Math.round(options.override));
    return () => {};
  }

  let last = -1;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let watched: HTMLElement | null = null;

  const emit = () => {
    const px = measureHostHeaderHeight();
    if (px !== last) {
      last = px;
      onChange(px);
    }
    return px;
  };

  /** Aggancia il ResizeObserver all'elemento trovato (una volta sola per elemento). */
  const attach = () => {
    const el = findHostHeader();
    if (!el || el === watched) return;
    watched = el;
    resizeObserver?.disconnect();
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => emit());
      resizeObserver.observe(el);
    }
  };

  const onResize = () => {
    attach();
    emit();
  };

  attach();
  const initial = emit();
  window.addEventListener('resize', onResize);

  // Header non ancora renderizzato: resta in ascolto sul body finché compare.
  if (!initial && typeof MutationObserver !== 'undefined' && document.body) {
    mutationObserver = new MutationObserver(() => {
      attach();
      if (emit()) {
        mutationObserver?.disconnect();
        mutationObserver = null;
      }
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  return () => {
    window.removeEventListener('resize', onResize);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    resizeObserver = null;
    mutationObserver = null;
    watched = null;
  };
}
