// Lettura di un articolo "solo-indice" (estensione della Fase E4 → B2).
//
// PERCHÉ ESISTE: `extractInternalLinks` vede solo i link presenti nel DOM della
// pagina; l'indice KB (`kb-index`) propone anche articoli NON linkati qui. Sulla
// KB Salesforce (Aura, client-rendered) il fetch di quegli articoli riceve solo
// lo shell (`hasRenderedContent` → false), quindi `shallowFollow` non li legge:
// un articolo solo-indice arriverebbe all'AI solo come suggerimento senza corpo.
//
// MECCANISMO = IFRAME NASCOSTO (deciso su dati reali, probe recon-kb-verify.js
// 2026-07-28, check C7/C9):
//   - il click su un anchor sintetico NON è intercettato dal router Aura di
//     questa KB → nell'estensione causerebbe un FULL RELOAD del tab (uccide il
//     content-script). Scartato.
//   - un `<iframe>` nascosto same-origin invece CARICA e RENDERIZZA l'articolo
//     (`rendered:true`, ~1,3s) e il CSP lo consente (`frame-ancestors 'self'`).
//     Il tab dell'agente NON naviga mai: leggiamo dal `contentDocument` e
//     rimuoviamo l'iframe. Niente reload, niente race sul ritorno all'hub,
//     niente rischio per la sessione della sidebar.
// Degrada in silenzio a null se il render non arriva entro il timeout
// (l'articolo resta un suggerimento — NON è un errore).
import type { KbLink, KbPage } from './outcome';
import { extractCurrentPage } from './extract';
import { waitForSpaRender, type SpaRenderProbe, type WaitForSpaRenderOptions } from './spa-nav';
import { linkIdentity, withRetrievalLanguage } from './site-profile';

function idOf(url: string): string | null {
  try {
    return linkIdentity(new URL(url, location.href));
  } catch {
    return null;
  }
}

export interface OpenAndReadOptions {
  /** Interrompe attese/lettura (es. reset sessione). */
  shouldAbort?: () => boolean;
  /** Opzioni inoltrate a waitForSpaRender (timeout, ecc.); il probe è iniettato qui. */
  waitOptions?: WaitForSpaRenderOptions;
}

/** Boot Aura + render dell'articolo nell'iframe: default generoso, override via waitOptions. */
const IFRAME_RENDER_TIMEOUT_MS = 12_000;

/**
 * Apre un articolo dell'indice (anche NON linkato in pagina) in un **iframe
 * nascosto same-origin**, ne legge il DOM renderizzato e rimuove l'iframe.
 * Il tab dell'agente non naviga. Ritorna il KbPage letto, oppure null se il
 * render non arriva entro il timeout (degrada a suggerimento — NON è un errore).
 */
export async function openAndReadArticle(
  url: string,
  query: string,
  options: OpenAndReadOptions = {},
): Promise<KbPage | null> {
  const { shouldAbort = () => false, waitOptions } = options;
  const targetId = idOf(url);
  if (!targetId || shouldAbort()) return null;

  // Già sulla pagina target: leggila dal DOM corrente, nessun iframe.
  if (targetId === idOf(location.href)) {
    return { ...extractCurrentPage(query), origin: 'followed' };
  }

  // L'iframe è **solo same-origin** (il CSP `frame-ancestors 'self'` lo impone e
  // il contentDocument è leggibile solo same-origin). Un URL di altra origin
  // (es. dal demo Wikipedia) degrada a suggerimento.
  let target: URL;
  try {
    target = new URL(url, location.href);
  } catch {
    return null;
  }
  if (target.origin !== location.origin) return null;

  let frame: HTMLIFrameElement | null = null;
  try {
    frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText =
      'position:absolute;left:-9999px;top:0;width:1024px;height:768px;border:0;opacity:0;';

    // Probe iniettato: waitForSpaRender aspetta che l'iframe sia arrivato alla
    // route target e il testo sia stabile (non un tempo fisso → niente letture
    // parziali). Ogni accesso al contentDocument è guardato (about:blank iniziale).
    const contentEl = () => {
      const doc = frame?.contentDocument ?? null;
      return (doc?.querySelector('[role="main"]') ?? doc?.body ?? null) as HTMLElement | null;
    };
    const probe: SpaRenderProbe = {
      identity: () => {
        const href = frame?.contentDocument?.location?.href;
        if (!href) return '';
        try {
          return linkIdentity(new URL(href));
        } catch {
          return '';
        }
      },
      text: () => {
        const el = contentEl();
        return ((el?.innerText ?? el?.textContent ?? '') || '').replace(/\s+/g, ' ').trim();
      },
    };

    document.body.appendChild(frame);
    frame.src = withRetrievalLanguage(target.href);

    const rendered = await waitForSpaRender(targetId, shouldAbort, {
      timeoutMs: IFRAME_RENDER_TIMEOUT_MS,
      ...waitOptions,
      probe,
    });
    if (!rendered || shouldAbort()) return null;

    const doc = frame.contentDocument;
    if (!doc) return null;
    // Legge il DOM ORA renderizzato nell'iframe (stesso estrattore della pagina
    // corrente: content-root = c-runway-article-viewer, retrieval per-heading).
    return { ...extractCurrentPage(query, doc), origin: 'followed' };
  } catch {
    return null;
  } finally {
    frame?.remove();
  }
}

/**
 * Legge in sequenza i candidati solo-indice via iframe, fino a `max` pagine.
 * Salta i target che non renderizzano. Sequenziale per non tenere più iframe/boot
 * Aura aperti insieme (costo memoria).
 */
export async function readIndexOnlyArticles(
  candidates: KbLink[],
  query: string,
  max: number,
  options: OpenAndReadOptions = {},
): Promise<KbPage[]> {
  const out: KbPage[] = [];
  for (const candidate of candidates) {
    if (out.length >= max) break;
    if (options.shouldAbort?.()) break;
    const page = await openAndReadArticle(candidate.url, query, options);
    if (page) out.push(page);
  }
  return out;
}
