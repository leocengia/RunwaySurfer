// Visual guided tour state machine.
//
// The "visual" mode navigates the current tab through the top-N relevant links
// one by one (hub-and-spoke: start → link → back to start → next link → …) so
// the agent visually sees which pages the AI reads. Because the content script
// RELOADS on every same-tab navigation (wiping React state), the tour is driven
// by this small state machine persisted in extension storage and rehydrated on
// each mount — that is what makes the sidebar appear fixed and continuous.
//
// Storage note: we use storage.local (not storage.session) because storage.session
// is not reachable from a content-script context by default. To avoid a stale
// tour resurrecting on an unrelated page days later, we stamp `startedAt` and
// discard tours older than MAX_TOUR_AGE_MS on load.
import { browser } from 'wxt/browser';
import type { KbLink, KbPage } from './outcome';
import { extractCurrentPage, extractInternalLinks } from './extract';
import { pickRelevantLinks } from './crawl';

export type TourPhase =
  | 'idle'
  | 'scrolling' // on the start page: highlight targets[index], then navigate to it
  | 'navigating' // just left start toward a target; on load we collect it
  | 'returning' // heading back to the start page (hub) for the next target
  | 'asking' // back on start with all pages collected: stream the outcome
  | 'done'
  | 'error';

export interface TourState {
  phase: TourPhase;
  query: string;
  /** The hub we return to between targets and where the AI request runs. */
  startUrl: string;
  /** Relevant links chosen once on the start page. */
  targets: KbLink[];
  /** Which target we are on. */
  index: number;
  /** Accumulated pages: [startPage, ...visited targets]. */
  pages: KbPage[];
  /** Pause (ms) so the scroll+highlight is visible before navigating. */
  dwellMs: number;
  /** Epoch ms when the tour started, for staleness detection. */
  startedAt: number;
  error?: string;
}

const KEY = 'rs:tour';
export const DEFAULT_DWELL_MS = 1500;
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
export function startTour(query: string, dwellMs = DEFAULT_DWELL_MS): TourState {
  const targets = pickRelevantLinks(extractInternalLinks(), query);
  return {
    // No relevant links to visit → go straight to asking on the current page.
    phase: targets.length ? 'scrolling' : 'asking',
    query,
    startUrl: location.href,
    targets,
    index: 0,
    pages: [extractCurrentPage()],
    dwellMs,
    startedAt: Date.now(),
  };
}

export async function loadTour(): Promise<TourState | null> {
  try {
    const stored = await browser.storage.local.get(KEY);
    const tour = stored[KEY] as TourState | undefined;
    if (!tour || typeof tour !== 'object') return null;
    if (Date.now() - tour.startedAt > MAX_TOUR_AGE_MS) {
      await clearTour();
      return null;
    }
    return tour;
  } catch {
    return null;
  }
}

export async function saveTour(state: TourState): Promise<void> {
  try {
    await browser.storage.local.set({ [KEY]: state });
  } catch {
    /* best-effort: a lost write only aborts the tour, never breaks the page */
  }
}

export async function clearTour(): Promise<void> {
  try {
    await browser.storage.local.remove(KEY);
  } catch {
    /* ignore */
  }
}
