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
import { waitForSpaRender } from '../../lib/spa-nav';
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
  runReadingScan,
  setBannerProgress,
  sleep,
  smoothScrollTo,
  spotlightOn,
  teardownFx,
  unmountBanner,
} from '../../lib/fx';

export type AskResult = { outcome: string; plan: AiPlan | null };

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
}

const idOf = (url: string): string | null => {
  try {
    return linkIdentity(new URL(url, location.href));
  } catch {
    return null;
  }
};

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
          mountBanner({ step, total, rightOffsetPx: rightOffset() });
          setBannerProgress(i / units);

          const el = findLinkElement(target.url);
          const rect = el?.getBoundingClientRect();
          const visible = el && !((rect?.width ?? 0) === 0 && (rect?.height ?? 0) === 0);
          if (!el || !visible) {
            // Il link collegato non è (più) in pagina: non possiamo navigarci.
            void narrate(`Non trovo il link «${target.text}» in pagina, lo salto…`);
            continue;
          }

          // Avvicinamento cinematografico all'hub, poi click VERO che innesca la
          // route SPA (cursorClick è solo l'animazione del ripple).
          void narrate(narrationOpen(target, step, total));
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
          void narrate(`Apro e leggo «${target.text}»…`);
          setBannerProgress((i + 0.7) / units, true);
          const wantId = idOf(target.url);
          const rendered = wantId ? await waitForSpaRender(wantId, shouldAbort) : false;
          if (aborted()) return;

          if (rendered) {
            setBannerProgress((i + 1) / units, false, scanMs);
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
          }

          // Torna sempre all'hub (client-side), anche dopo l'ultimo target: così
          // l'analisi e la navigazione finale avvengono dove i link esistono.
          void narrate('Torno alla pagina di partenza…');
          history.back();
          const back = startIdentity ? await waitForSpaRender(startIdentity, shouldAbort) : false;
          if (aborted()) return;
          if (!back) {
            // Non siamo tornati all'hub in modo affidabile: interrompi la
            // camminata e passa comunque all'analisi con quanto raccolto.
            void narrate('Non torno alla pagina di partenza, procedo con l’analisi…');
            break;
          }
        }

        // Analisi sull'hub, con le pagine effettivamente lette.
        setPagesUsed([...pages]);
        setTour({ ...t, index: total, phase: 'asking', pages });
        mountBanner({ step: total, total, rightOffsetPx: rightOffset() });
        setBannerProgress(total / units, true);
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
          return;
        }
        setTour(null);
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
