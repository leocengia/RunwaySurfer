// Hook che incapsula la macchina a stati del tour visivo (driveTour), estratta
// da App.tsx. Il tour attraversa navigazioni di pagina: lo stato persistente
// vive in chrome.storage (lib/tour.ts), qui c'è solo l'orchestrazione runtime
// di scroll/spotlight/cursore e la ripartenza dopo ogni navigazione.
import { useCallback, type MutableRefObject } from 'react';
import { extractCurrentPage } from '../../lib/extract';
import type { AiPlan, KbLink, KbPage } from '../../lib/outcome';
import {
  clearTour,
  DEFAULT_SCAN_MS,
  normalizeUrl,
  saveTour,
  saveTourResult,
  type TourState,
} from '../../lib/tour';
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
      ensureFxStyles();
      installFxSafetyNet();
      const rightOffset = () => (openRef.current ? sidebarWidthRef.current : 0);
      try {
        let t = initial;
        setTour(t);
        setQuery(t.query);
        setPagesUsed(t.pages);
        setStatus(t.phase === 'asking' ? 'streaming' : 'reading');

        const here = normalizeUrl(location.href);
        const onStart = here === normalizeUrl(t.startUrl);

        while (true) {
          if (tourAbortRef.current) {
            teardownFx();
            return;
          }
          const total = t.targets.length;
          const units = total + 1; // targets + final analysis

          switch (t.phase) {
            case 'returning': {
              if (!onStart) {
                location.href = t.startUrl;
                return;
              }
              t = { ...t, phase: t.index < t.targets.length ? 'scrolling' : 'asking' };
              await saveTour(t);
              setTour(t);
              continue;
            }

            case 'scrolling': {
              const target = t.targets[t.index];
              if (!target) {
                t = { ...t, phase: 'asking' };
                await saveTour(t);
                continue;
              }
              const step = Math.min(t.index + 1, total);
              mountBanner({ step, total, rightOffsetPx: rightOffset() });
              setBannerProgress(t.index / units);
              const el = findLinkElement(target.url);
              const rect = el?.getBoundingClientRect();
              if (!el || ((rect?.width ?? 0) === 0 && (rect?.height ?? 0) === 0)) {
                // Link not on the page (or collapsed): no fx, keep today's
                // semantics and navigate anyway.
                void narrate(`Non trovo il link «${target.text}» in pagina, lo apro direttamente…`);
                await saveTour({ ...t, phase: 'navigating' });
                await abortableSleep(350, () => tourAbortRef.current);
                if (tourAbortRef.current) {
                  teardownFx();
                  return;
                }
                location.href = target.url;
                return;
              }
              void narrate(narrationOpen(target, step, total));
              const offSpotlight = spotlightOn(el);
              const shouldAbort = () => tourAbortRef.current;
              // Glide the bar forward across the approach so it advances
              // continuously instead of snapping at phase boundaries.
              setBannerProgress((t.index + 0.5) / units, false, 700);
              // Cinematic approach: the page glides while the ghost cursor
              // curves toward the link, landing just after the scroll settles.
              await Promise.all([
                smoothScrollTo(el, { shouldAbort }),
                cursorGlideTo(el, 650, shouldAbort),
              ]);
              if (tourAbortRef.current) {
                offSpotlight();
                teardownFx();
                return;
              }
              await saveTour({ ...t, phase: 'navigating' });
              await abortableSleep(t.dwellMs, shouldAbort);
              if (tourAbortRef.current) {
                offSpotlight();
                teardownFx();
                return;
              }
              await cursorClick(el);
              offSpotlight();
              location.href = target.url;
              return;
            }

            case 'navigating': {
              if (onStart) {
                t = { ...t, index: t.index + 1, phase: 'returning' };
                await saveTour(t);
                continue;
              }
              const idx = t.index;
              const visited = t.targets[idx];
              mountBanner({
                step: Math.min(idx + 1, total),
                total,
                rightOffsetPx: rightOffset(),
              });
              setBannerProgress((idx + 0.5) / units);
              void narrate(`Sto leggendo «${document.title}»…`);
              const page: KbPage = { ...extractCurrentPage(t.query), origin: 'followed' };
              const pages = [...t.pages, page];
              t = { ...t, pages, index: idx + 1, phase: 'returning' };
              setPagesUsed(pages);
              // Persist BEFORE the scan so a reload mid-scan resumes correctly.
              await saveTour(t);
              const scanMs = t.scanMs ?? DEFAULT_SCAN_MS;
              // Glide the bar toward the next step across the reading scan.
              setBannerProgress((idx + 1) / units, false, scanMs);
              await runReadingScan({
                keywords: visited?.matchedKeywords ?? [],
                durationMs: scanMs,
                shouldAbort: () => tourAbortRef.current,
              });
              if (tourAbortRef.current) {
                teardownFx();
                return;
              }
              void narrate('Torno alla pagina di partenza…');
              await abortableSleep(150, () => tourAbortRef.current);
              location.href = t.startUrl;
              return;
            }

            case 'asking': {
              setTour(t);
              mountBanner({ step: total, total, rightOffsetPx: rightOffset() });
              setBannerProgress(total / units, true);
              void narrate(
                t.pages.length > 1
                  ? `Analizzo le ${t.pages.length} pagine visitate e scrivo la risposta…`
                  : 'Analizzo la pagina e scrivo la risposta…',
              );
              const result = await runAsk(t.query, t.pages, t.targets);
              await clearTour();
              setTour(null);
              bannerComplete('Fatto! Risposta pronta nella sidebar.');
              await sleep(500);
              unmountBanner();
              teardownFx();
              const targetUrl = findTourTargetUrl(result.outcome, t.pages);
              if (targetUrl && normalizeUrl(targetUrl) !== normalizeUrl(location.href)) {
                await saveTourResult({
                  query: t.query,
                  outcome: result.outcome,
                  plan: result.plan,
                  pages: t.pages,
                  targetUrl,
                  startedAt: Date.now(),
                });
                location.href = targetUrl;
              }
              return;
            }

            default:
              teardownFx();
              return;
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
