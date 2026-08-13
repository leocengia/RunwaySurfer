// Hook che incapsula il tour visivo (driveTour), estratto da App.tsx.
//
// La KB reale (Salesforce Experience Cloud) è client-rendered: un fetch() vede
// solo lo shell, quindi i contenuti si leggono SOLO dal DOM renderizzato. La
// navigazione interna è però client-side (route SPA, niente full reload) e il
// content-script sopravvive (confermato dal recon-3). Quindi il tour è un
// hub-and-spoke via SPA: dalla pagina di partenza (hub) clicca un link
// collegato → attende il render → legge il DOM → torna all'hub con
// history.back() → prossimo target. Niente fetch, niente persistenza: lo stato
// React sopravvive alle route SPA. L'unica navigazione "finale" porta alla
// fonte scelta e, restando client-side, mantiene la risposta già in sidebar.
import { useCallback, type MutableRefObject } from 'react';
import { extractCurrentPage } from '../../lib/extract';
import type { AiPlan, KbLink, KbPage } from '../../lib/outcome';
import { DEFAULT_SCAN_MS, saveTourResult, type TourState } from '../../lib/tour';
import { linkIdentity } from '../../lib/site-profile';
import { waitForSpaRender, type SpaRenderProgress } from '../../lib/spa-nav';
import { findLinkElement } from '../../lib/highlight';
import { findTourTargetUrl } from '../../lib/tour-target';
import {
  abortableSleep,
  bannerComplete,
  cursorClick,
  cursorGlideTo,
  ensureFxStyles,
  installFxSafetyNet,
  mountBanner,
  narrate,
  narrationOpen,
  removeSpotlight,
  runReadingScan,
  setBannerProgress,
  sleep,
  smoothScrollTo,
  spotlightOn,
  teardownFx,
  unmountBanner,
} from '../../lib/fx';

export type AskResult = {
  outcome: string;
  plan: AiPlan | null;
  /**
   * Lo stream è finito male (errore di rete, timeout, sessione scaduta). Il tour
   * lo legge per fermarsi invece di proseguire verso una fonte che non esiste.
   */
  failed: boolean;
};

export interface TourDriverDeps {
  /** Avvia lo stream della risposta per le pagine raccolte (definito in App). */
  runAsk: (query: string, pages: KbPage[], links: KbLink[]) => Promise<AskResult>;
  /** Geometria live della sidebar: letta dai ref per non ricreare il driver a ogni resize. */
  openRef: MutableRefObject<boolean>;
  sidebarWidthRef: MutableRefObject<number>;
  tourAbortRef: MutableRefObject<boolean>;
  drivingRef: MutableRefObject<boolean>;
  setTour: (tour: TourState | null) => void;
  setQuery: (query: string) => void;
  setPagesUsed: (pages: KbPage[]) => void;
  setStatus: (status: 'reading' | 'streaming') => void;
  /** Dettaglio del passo corrente per la timeline in sidebar. */
  setTourDetail: (detail: string) => void;
}

const idOf = (url: string): string | null => {
  try {
    return linkIdentity(new URL(url, location.href));
  } catch {
    return null;
  }
};

/** "3.4k" invece di "3421": la cifra esatta non aggiunge nulla, la scala sì. */
function humanChars(chars: number): string {
  return chars >= 1000 ? `${(chars / 1000).toFixed(1)}k` : String(chars);
}

/** Riga leggibile per un poll di attesa SPA: dove siamo, non solo "attendo". */
function renderWaitDetail(p: SpaRenderProgress, what: string): string {
  const seconds = (p.elapsedMs / 1000).toFixed(1);
  if (!p.arrived) return `${what}: attendo la route · ${seconds}s`;
  if (p.stable > 0) return `${what}: stabilizzo · ${humanChars(p.chars)} caratteri · ${seconds}s`;
  return `${what}: contenuto in arrivo · ${humanChars(p.chars)} caratteri · ${seconds}s`;
}

/** Poll consecutivi identici che waitForSpaRender richiede per dire "stabile". */
const STABLE_POLLS = 4;

/**
 * Frazione di barra per un'attesa SPA, confinata alla fetta `span` del passo che
 * comincia a `base` (in unità di passo). Non è una stima del tempo residuo — non
 * ne esiste una onesta — ma una funzione monotona dei fatti osservati: prima
 * l'arrivo della route, poi la stabilizzazione del contenuto. Non torna mai
 * indietro e non raggiunge il fondo della fetta prima che l'attesa finisca.
 */
function waitFraction(base: number, span: number, units: number, p: SpaRenderProgress): number {
  if (!p.arrived) {
    // Prima dell'arrivo si può solo misurare il tempo: sale in fretta all'inizio
    // e poi si appiattisce, così un timeout lungo non sembra un blocco.
    const elapsed = Math.min(1, p.elapsedMs / Math.max(1, p.timeoutMs / 6));
    return (base + span * 0.5 * elapsed) / units;
  }
  const stability = Math.min(1, p.stable / STABLE_POLLS);
  return (base + span * (0.5 + 0.5 * stability)) / units;
}

export function useTourDriver(deps: TourDriverDeps): (initial: TourState) => Promise<void> {
  const {
    runAsk,
    openRef,
    sidebarWidthRef,
    tourAbortRef,
    drivingRef,
    setTour,
    setQuery,
    setPagesUsed,
    setStatus,
    setTourDetail,
  } = deps;

  return useCallback(
    async (initial: TourState) => {
      if (drivingRef.current) return;
      drivingRef.current = true;
      const rightOffset = () => (openRef.current ? sidebarWidthRef.current : 0);
      const shouldAbort = () => tourAbortRef.current;
      const aborted = (offSpotlight?: () => void): boolean => {
        if (!tourAbortRef.current) return false;
        offSpotlight?.();
        teardownFx();
        return true;
      };
      try {
        // Inside the try so a throw here still hits the finally that clears
        // drivingRef — otherwise the reentrancy guard would wedge on and every
        // later visual run would silently no-op.
        ensureFxStyles();
        installFxSafetyNet();
        const t = initial;
        setTour(t);
        setQuery(t.query);
        setPagesUsed(t.pages);
        setStatus('reading');

        const total = t.targets.length;
        const units = total + 1; // articoli collegati letti + analisi finale
        const scanMs = t.scanMs ?? DEFAULT_SCAN_MS;
        const startIdentity = idOf(location.href);
        // pages[0] è la pagina di partenza (già estratta da startTour).
        const pages: KbPage[] = [...t.pages];

        // Hub-and-spoke via SPA: per ogni target, naviga (client-side) all'articolo
        // collegato, leggi il DOM renderizzato, poi torna all'hub.
        for (let i = 0; i < total; i++) {
          if (aborted()) return;
          const target = t.targets[i];
          const step = Math.min(i + 1, total);
          setTour({ ...t, index: i, phase: 'scrolling' });
          setTourDetail('cerco il link in pagina...');
          mountBanner({ step, total, rightOffsetPx: rightOffset() });
          setBannerProgress(i / units);
          // Una route SPA precedente può aver ridisegnato la pagina lasciando
          // attaccato un velo la cui closure di cleanup non è più raggiungibile.
          removeSpotlight();

          const el = findLinkElement(target.url);
          const rect = el?.getBoundingClientRect();
          const visible = el && !((rect?.width ?? 0) === 0 && (rect?.height ?? 0) === 0);
          if (!el || !visible) {
            // Il link collegato non è (più) in pagina: non possiamo navigarci.
            void narrate(`Non trovo il link «${target.text}» in pagina, lo salto…`);
            setTourDetail('link non trovato in pagina');
            continue;
          }

          // Avvicinamento cinematografico all'hub, poi click VERO che innesca la
          // route SPA (cursorClick è solo l'animazione del ripple).
          void narrate(narrationOpen(target, step, total));
          setTourDetail('avvicino il cursore al link...');
          const offSpotlight = spotlightOn(el);
          setBannerProgress((i + 0.4) / units, false, 700);
          await Promise.all([
            smoothScrollTo(el, { shouldAbort }),
            cursorGlideTo(el, 650, shouldAbort),
          ]);
          if (aborted(offSpotlight)) return;
          await abortableSleep(t.dwellMs, shouldAbort);
          if (aborted(offSpotlight)) return;
          await cursorClick(el);
          offSpotlight();
          el.click();

          // Attendi che la SPA renderizzi l'articolo collegato (route + stabilità).
          // L'attesa è la parte lunga e imprevedibile del passo (~1s tipici, fino
          // a 9s): onProgress la rende determinata invece di uno shimmer che non
          // dice se stia succedendo qualcosa.
          void narrate(`Apro e leggo «${target.text}»…`);
          const wantId = idOf(target.url);
          const rendered = wantId
            ? await waitForSpaRender(wantId, shouldAbort, {
                onProgress: (p) => {
                  setTourDetail(renderWaitDetail(p, 'apro l’articolo'));
                  setBannerProgress(waitFraction(i + 0.4, 0.3, units, p), false, 150);
                },
              })
            : false;
          if (aborted()) return;

          if (rendered) {
            setBannerProgress((i + 0.85) / units, false, scanMs);
            setTourDetail('leggo il contenuto...');
            await runReadingScan({
              keywords: target.matchedKeywords ?? [],
              durationMs: scanMs,
              shouldAbort,
            });
            if (aborted()) return;
            // Legge il DOM ORA renderizzato: qui c'è il testo vero dell'articolo.
            pages.push({ ...extractCurrentPage(t.query), origin: 'followed' });
            setPagesUsed([...pages]);
          } else {
            void narrate('Render non riuscito, salto questo articolo…');
            setTourDetail('render non riuscito');
          }

          // Torna sempre all'hub (client-side), anche dopo l'ultimo target: così
          // l'analisi e la navigazione finale avvengono dove i link esistono.
          void narrate('Torno alla pagina di partenza…');
          history.back();
          const back = startIdentity
            ? await waitForSpaRender(startIdentity, shouldAbort, {
                onProgress: (p) => {
                  setTourDetail(renderWaitDetail(p, 'torno indietro'));
                  setBannerProgress(waitFraction(i + 0.85, 0.15, units, p), false, 150);
                },
              })
            : false;
          if (aborted()) return;
          if (!back) {
            // Non siamo tornati all'hub in modo affidabile: interrompi la
            // camminata e passa comunque all'analisi con quanto raccolto.
            void narrate('Non torno alla pagina di partenza, procedo con l’analisi…');
            setTourDetail('ritorno non riuscito, procedo con l’analisi');
            break;
          }
          setBannerProgress((i + 1) / units);
        }

        // Analisi sull'hub, con le pagine effettivamente lette.
        setPagesUsed([...pages]);
        setTour({ ...t, index: total, phase: 'asking', pages });
        mountBanner({ step: total, total, rightOffsetPx: rightOffset() });
        // Qui l'attesa dipende dal modello: nessuna stima onesta è possibile,
        // quindi la barra resta indeterminata. Il segnale concreto lo dà lo
        // stream (runAsk aggiorna il dettaglio coi caratteri ricevuti).
        setBannerProgress(total / units, true);
        setTourDetail(
          pages.length > 1 ? `analizzo ${pages.length} pagine lette...` : 'analizzo la pagina...',
        );
        void narrate(
          pages.length > 1
            ? `Analizzo le ${pages.length} pagine lette e scrivo la risposta…`
            : 'Analizzo la pagina e scrivo la risposta…',
        );
        const result = await runAsk(t.query, pages, t.targets);
        // Lo stream può essersi chiuso per uno stop dell'utente: senza questo
        // guard il driver navigherebbe comunque dopo l'abort.
        if (aborted()) {
          setTour(null);
          setTourDetail('');
          return;
        }
        // Stream finito male (rete caduta, timeout, sessione scaduta a metà
        // tour): la risposta non esiste. Navigare comunque verso la "fonte
        // scelta" porterebbe l'agente su un'altra pagina — dove trova il form di
        // login e nessuna spiegazione, dopo minuti di tour. Si chiude qui, dove
        // il messaggio d'errore è visibile nella sidebar.
        if (result.failed) {
          setTour(null);
          setTourDetail('');
          bannerComplete('Tour interrotto: vedi il messaggio nella sidebar.');
          await sleep(900);
          unmountBanner();
          teardownFx();
          return;
        }
        setTour(null);
        setTourDetail('');
        bannerComplete('Fatto! Risposta pronta nella sidebar.');
        await sleep(500);
        unmountBanner();
        teardownFx();

        // Navigazione finale verso la fonte scelta. Se il link è sull'hub, un
        // click resta client-side (niente reload) e la risposta resta in sidebar;
        // altrimenti fallback a una navigazione reale con ripristino all'atterraggio.
        const targetUrl = findTourTargetUrl(result.outcome, pages);
        if (targetUrl && idOf(targetUrl) !== startIdentity) {
          const el = findLinkElement(targetUrl);
          if (el) {
            el.click();
          } else {
            await saveTourResult({
              query: t.query,
              outcome: result.outcome,
              plan: result.plan,
              pages,
              targetUrl,
              startedAt: Date.now(),
            });
            location.href = targetUrl;
          }
        }
      } finally {
        drivingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i ref sono stabili per definizione
    [runAsk],
  );
}
