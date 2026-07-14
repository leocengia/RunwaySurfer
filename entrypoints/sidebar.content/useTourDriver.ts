// Hook che incapsula il tour visivo (driveTour), estratto da App.tsx.
//
// Il tour è una "camminata in-page": la sidebar resta sulla pagina di partenza
// per tutta la durata, quindi NON ci sono navigazioni per-link né reload del
// content script. Le animazioni (spotlight, cursore fantasma, click, banner,
// beam di lettura) girano sulla pagina di partenza mentre il contenuto delle
// pagine target viene letto via fetch (shallowFollow), prefetchato in parallelo
// all'inizio. L'unica navigazione mostrata è quella finale verso la fonte
// scelta. Non essendoci più attraversamenti di pagina, non c'è stato da
// persistere/riprendere: il flusso è una singola funzione async lineare.
import { useCallback, type MutableRefObject } from 'react';
import { shallowFollow } from '../../lib/crawl';
import type { AiPlan, KbLink, KbPage } from '../../lib/outcome';
import { DEFAULT_SCAN_MS, normalizeUrl, saveTourResult, type TourState } from '../../lib/tour';
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
        const units = total + 1; // targets read in-page + final analysis
        const scanMs = t.scanMs ?? DEFAULT_SCAN_MS;

        // Prefetch every target's content NOW, in parallel, so the network work
        // overlaps the animations below and there is nothing to wait for later.
        // The targets already carry a `score` from pickRelevantLinks, so
        // shallowFollow uses them directly; failed fetches come back dropped
        // (skip-and-continue), never navigating away from the start page.
        const followedPromise = shallowFollow(t.targets, t.query, t.targets.length);

        // Walk the targets WITHOUT ever leaving the start page: spotlight the
        // link, glide the cursor, click, then run the reading beam — all in-page.
        for (let i = 0; i < total; i++) {
          if (tourAbortRef.current) {
            teardownFx();
            return;
          }
          const target = t.targets[i];
          const step = Math.min(i + 1, total);
          setTour({ ...t, index: i, phase: 'scrolling' });
          mountBanner({ step, total, rightOffsetPx: rightOffset() });
          setBannerProgress(i / units);

          const el = findLinkElement(target.url);
          const rect = el?.getBoundingClientRect();
          const visible = el && !((rect?.width ?? 0) === 0 && (rect?.height ?? 0) === 0);
          if (visible) {
            void narrate(narrationOpen(target, step, total));
            const offSpotlight = spotlightOn(el);
            // Glide the bar forward across the approach so it advances
            // continuously instead of snapping at step boundaries.
            setBannerProgress((i + 0.5) / units, false, 700);
            // Cinematic approach: the page glides while the ghost cursor curves
            // toward the link, landing just after the scroll settles.
            await Promise.all([
              smoothScrollTo(el, { shouldAbort }),
              cursorGlideTo(el, 650, shouldAbort),
            ]);
            if (tourAbortRef.current) {
              offSpotlight();
              teardownFx();
              return;
            }
            await abortableSleep(t.dwellMs, shouldAbort);
            if (tourAbortRef.current) {
              offSpotlight();
              teardownFx();
              return;
            }
            await cursorClick(el);
            offSpotlight();
          } else {
            // Link not on the page (or collapsed): skip the cursor animation but
            // DO NOT navigate — the page content is still gathered by the
            // parallel prefetch above.
            void narrate(`Non trovo il link «${target.text}» in pagina, lo leggo comunque…`);
          }

          // Reading beam on the CURRENT (start) page: the scan sweeps the start
          // page; target keywords simply aren't highlighted when absent (no-op,
          // visually identical). Glide the bar toward the next step across it.
          setBannerProgress((i + 1) / units, false, scanMs);
          await runReadingScan({
            keywords: target.matchedKeywords ?? [],
            durationMs: scanMs,
            shouldAbort,
          });
          if (tourAbortRef.current) {
            teardownFx();
            return;
          }
        }

        // Analysis: the prefetch is in practice already resolved by now.
        const followed = await followedPromise;
        const pages = [...t.pages, ...followed];
        setPagesUsed(pages);
        setTour({ ...t, index: total, phase: 'asking', pages });
        mountBanner({ step: total, total, rightOffsetPx: rightOffset() });
        setBannerProgress(total / units, true);
        void narrate(
          pages.length > 1
            ? `Analizzo le ${pages.length} pagine lette e scrivo la risposta…`
            : 'Analizzo la pagina e scrivo la risposta…',
        );
        const result = await runAsk(t.query, pages, t.targets);
        // The fetch may have returned a partial outcome because the user pressed
        // stop; without this guard the driver would still navigate the tab
        // (location.href below) after an abort.
        if (tourAbortRef.current) {
          setTour(null);
          teardownFx();
          return;
        }
        setTour(null);
        bannerComplete('Fatto! Risposta pronta nella sidebar.');
        await sleep(500);
        unmountBanner();
        teardownFx();

        // The only navigation the tour ever shows: toward the chosen source.
        const targetUrl = findTourTargetUrl(result.outcome, pages);
        if (targetUrl && normalizeUrl(targetUrl) !== normalizeUrl(location.href)) {
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
      } finally {
        drivingRef.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- i ref sono stabili per definizione
    [runAsk],
  );
}
