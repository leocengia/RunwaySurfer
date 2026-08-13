// Visual guided tour state.
//
// The "visual" mode is an IN-PAGE walk: the sidebar stays on the start page for
// the whole tour (no per-link navigation, no "back"), so the content script
// never reloads — no flash, React state survives naturally. The animations
// (spotlight, ghost cursor, click ripple, narrating banner, reading beam) run
// on the start page while the target pages' content is read via `fetch`
// (shallowFollow), prefetched in parallel. The ONLY navigation shown is the
// final one, toward the chosen source. Because there is no cross-navigation
// mid-tour, the tour state no longer needs to be persisted/rehydrated: this
// module only carries the runtime `TourState` and the final `TourResultState`
// that survives the single closing navigation.
//
// Storage note: we use storage.local (not storage.session) because storage.session
// is not reachable from a content-script context by default. To avoid a stale
// result resurrecting on an unrelated page days later, we stamp `startedAt` and
// discard results older than MAX_TOUR_AGE_MS on load.
import { browser } from 'wxt/browser';
import type { AiPlan, KbLink, KbPage } from './outcome';
import { extractCurrentPage, extractInternalLinks } from './extract';
import { pickRelevantLinks } from './crawl';

export type TourPhase =
  | 'idle'
  | 'scrolling' // on the start page: highlight targets[index] and read it in-page
  | 'asking' // all pages collected: stream the outcome
  | 'done'
  | 'error';

export interface TourState {
  phase: TourPhase;
  query: string;
  /** The page the walk runs on and where the AI request is issued. */
  startUrl: string;
  /** Relevant links chosen once on the start page. */
  targets: KbLink[];
  /** Which target we are on. */
  index: number;
  /** Accumulated pages: [startPage, ...visited targets]. */
  pages: KbPage[];
  /** Hover pause (ms) on the pulsing link after the cursor lands, before the click. */
  dwellMs: number;
  /** Duration (ms) of the reading-scan effect on each followed page. */
  scanMs: number;
  /** Epoch ms when the tour started, for staleness detection. */
  startedAt: number;
  error?: string;
}

export interface TourResultState {
  query: string;
  outcome: string;
  plan: AiPlan | null;
  pages: KbPage[];
  targetUrl: string;
  startedAt: number;
}

const KEY = 'rs:tour';
const RESULT_KEY = 'rs:tourResult';
const ABORT_KEY = 'rs:tourAbort';
// Hover-only: the cinematic scroll (~550ms) and cursor glide (~650ms) have
// their own durations in lib/fx, so the dwell is just the pause on the link.
export const DEFAULT_DWELL_MS = 400;
export const DEFAULT_SCAN_MS = 900;
/** A tour older than this is considered abandoned and discarded on load. */
const MAX_TOUR_AGE_MS = 5 * 60_000;

/** Strip the fragment so link matching and page-identity checks are stable. */
export function normalizeUrl(u: string): string {
  try {
    const url = new URL(u, location.href);
    url.hash = '';
    return url.href;
  } catch {
    return u;
  }
}

/** Build the initial tour state on the current (start) page. */
export function startTour(
  query: string,
  dwellMs = DEFAULT_DWELL_MS,
  scanMs = DEFAULT_SCAN_MS,
): TourState {
  const targets = pickRelevantLinks(extractInternalLinks(), query);
  return {
    // No relevant links to visit → go straight to asking on the current page.
    phase: targets.length ? 'scrolling' : 'asking',
    query,
    startUrl: location.href,
    targets,
    index: 0,
    pages: [extractCurrentPage(query)],
    dwellMs,
    scanMs,
    startedAt: Date.now(),
  };
}

/**
 * Cross-navigation abort flag: the banner stop button may be clicked while the
 * final navigation is committing (its DOM event dies with the page), so it also
 * stamps this key; loadTourResult() on the next page then discards the result so
 * a stopped tour never restores its answer after landing.
 */
export async function markTourAborted(): Promise<void> {
  try {
    await browser.storage.local.set({ [ABORT_KEY]: Date.now() });
  } catch {
    /* best-effort */
  }
}

/**
 * Defensive cleanup of any legacy `rs:tour` state left by an older build (the
 * in-page walk no longer persists the tour). Still called on run/reset/stop so
 * a stale key from a previous version can never resurrect.
 */
export async function clearTour(): Promise<void> {
  try {
    await browser.storage.local.remove(KEY);
  } catch {
    /* ignore */
  }
}

export async function loadTourResult(): Promise<TourResultState | null> {
  try {
    const stored = await browser.storage.local.get([RESULT_KEY, ABORT_KEY]);
    const result = stored[RESULT_KEY] as TourResultState | undefined;
    if (!result || typeof result !== 'object') return null;
    if (Date.now() - result.startedAt > MAX_TOUR_AGE_MS) {
      await clearTourResult();
      return null;
    }
    // Stop-during-final-navigation guard: the stop button stamps ABORT_KEY as
    // the closing navigation commits, so a result written just before the stop
    // must not restore its answer after landing. (Previously enforced by
    // loadTour, which no longer exists.) A fresh tour has startedAt > abortedAt.
    const abortedAt = stored[ABORT_KEY];
    if (typeof abortedAt === 'number' && abortedAt >= result.startedAt) {
      await clearTourResult();
      await clearTourAbort();
      return null;
    }
    // Il flag ha finito il suo compito: se resta, sopravvive indefinitamente su
    // disco (nessun codice lo rimuoveva) e al primo riavvio del browser può
    // scartare il risultato di un tour successivo con `startedAt` più basso.
    await clearTourAbort();
    return result;
  } catch {
    return null;
  }
}

/** Rimuove il flag di abort dopo che è stato consumato. */
export async function clearTourAbort(): Promise<void> {
  try {
    await browser.storage.local.remove(ABORT_KEY);
  } catch {
    /* ignore */
  }
}

export async function saveTourResult(state: TourResultState): Promise<void> {
  try {
    // Il TESTO INTEGRALE degli articoli non va su disco. Questo record serve
    // solo a ricomporre la risposta e l'elenco delle fonti dopo l'unica
    // navigazione finale: url e titolo bastano. Il corpo degli articoli, invece,
    // resterebbe in storage.local anche se l'agente chiude il tab prima di
    // atterrare — la scadenza di 5 minuti si applica solo in lettura.
    const lean: TourResultState = {
      ...state,
      pages: state.pages.map((page) => ({ ...page, text: '' })),
    };
    await browser.storage.local.set({ [RESULT_KEY]: lean });
  } catch {
    /* best-effort */
  }
}

export async function clearTourResult(): Promise<void> {
  try {
    await browser.storage.local.remove(RESULT_KEY);
  } catch {
    /* ignore */
  }
}
