// Navigazione SPA verso un articolo "solo-indice" (estensione della Fase E4 → B2).
//
// PERCHÉ ESISTE: `extractInternalLinks` vede solo i link presenti nel DOM della
// pagina; l'indice KB (`kb-index`) propone anche articoli NON linkati qui. Sulla
// KB Salesforce (Aura, client-rendered) il fetch di quegli articoli riceve solo
// lo shell (`hasRenderedContent` → false), quindi `shallowFollow` non li legge:
// un articolo solo-indice può oggi arrivare all'AI solo come suggerimento senza
// corpo, mai come pagina letta.
//
// `openAndReadArticle` colma il gap: naviga client-side all'articolo SENZA
// dipendere da un anchor in pagina, attende il render, legge il DOM già
// renderizzato (dove sta il testo vero) e torna all'hub. Riusa i mattoni già
// testati — `waitForSpaRender` + `extractCurrentPage` — e degrada in silenzio a
// null se il render non arriva (l'articolo resta un suggerimento, come oggi:
// NON è un errore). Non fa mai un full reload: quello resterebbe al tour, che ha
// la rehydration (saveTourResult/loadTourResult); qui un reload perderebbe la
// sessione della sidebar.
import type { KbLink, KbPage } from './outcome';
import { extractCurrentPage } from './extract';
import { waitForSpaRender, type WaitForSpaRenderOptions } from './spa-nav';
import { linkIdentity } from './site-profile';

function idOf(url: string): string | null {
  try {
    return linkIdentity(new URL(url, location.href));
  } catch {
    return null;
  }
}

/**
 * Naviga client-side a `url` creando un <a> sintetico fuori schermo e
 * cliccandolo: fa scattare il router SPA (Aura) restando client-side (niente
 * reload → il content-script sopravvive), senza bisogno di un anchor già in
 * pagina. È il meccanismo preferito perché imita il click reale che il router
 * intercetta.
 */
function clickSyntheticAnchor(url: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.style.position = 'absolute';
  a.style.left = '-9999px';
  a.style.width = '1px';
  a.style.height = '1px';
  a.setAttribute('aria-hidden', 'true');
  document.body.appendChild(a);
  try {
    a.click();
  } finally {
    a.remove();
  }
}

/**
 * Fallback: pushState + evento popstate, per i router SPA che ascoltano la
 * history API invece del click. Non ricarica la pagina.
 */
function pushStateNavigate(url: string): void {
  try {
    history.pushState(null, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch {
    /* best-effort: se pushState fallisce si resta sull'hub */
  }
}

export interface OpenAndReadOptions {
  /** Interrompe attese/navigazione (es. reset sessione). */
  shouldAbort?: () => boolean;
  /** Opzioni inoltrate a waitForSpaRender (timeout, probe iniettabile per i test). */
  waitOptions?: WaitForSpaRenderOptions;
}

/** Torna all'hub via history.back() se ci siamo mossi, attendendone il render. */
async function returnToHub(
  hubId: string | null,
  shouldAbort: () => boolean,
  waitOptions?: WaitForSpaRenderOptions,
): Promise<void> {
  if (!hubId || idOf(location.href) === hubId) return;
  history.back();
  await waitForSpaRender(hubId, shouldAbort, waitOptions);
}

/**
 * Apre un articolo dell'indice (anche NON linkato in pagina) via navigazione
 * SPA, ne legge il DOM renderizzato e torna all'hub. Ritorna il KbPage letto,
 * oppure null se il render non arriva entro il timeout (degrada a suggerimento,
 * come oggi — NON è un errore).
 */
export async function openAndReadArticle(
  url: string,
  query: string,
  options: OpenAndReadOptions = {},
): Promise<KbPage | null> {
  const { shouldAbort = () => false, waitOptions } = options;
  const targetId = idOf(url);
  const hubId = idOf(location.href);
  if (!targetId || shouldAbort()) return null;

  // Già sulla pagina target: leggila e basta, nessuna navigazione.
  if (targetId === hubId) {
    return { ...extractCurrentPage(query), origin: 'followed' };
  }

  // Tentativo 1: anchor sintetico (click → router Aura, client-side).
  clickSyntheticAnchor(url);
  let rendered = await waitForSpaRender(targetId, shouldAbort, waitOptions);

  // Tentativo 2: pushState + popstate, se il click non ha innescato la route.
  if (!rendered && !shouldAbort()) {
    pushStateNavigate(url);
    rendered = await waitForSpaRender(targetId, shouldAbort, waitOptions);
  }

  if (!rendered) {
    // Render non arrivato: torna all'hub (se ci siamo mossi) e degrada a null.
    await returnToHub(hubId, shouldAbort, waitOptions);
    return null;
  }

  // Legge il DOM ORA renderizzato: qui c'è il testo vero dell'articolo.
  const page: KbPage = { ...extractCurrentPage(query), origin: 'followed' };
  await returnToHub(hubId, shouldAbort, waitOptions);
  return page;
}

/**
 * Legge in sequenza (una navigazione per volta) i candidati solo-indice via SPA,
 * fino a `max` pagine. Salta i target che non renderizzano. Sequenziale perché
 * la navigazione è single-threaded: non si può stare su due pagine insieme.
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
