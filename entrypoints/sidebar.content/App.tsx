import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { browser } from 'wxt/browser';
import { extractCurrentPage, extractInternalLinks } from '../../lib/extract';
import { pickRelevantLinks, shallowFollow } from '../../lib/crawl';
import { streamAsk } from '../../lib/client';
import { getProxyUrl } from '../../lib/messaging';
import { clearToken, fetchMe, getToken, logout, type AuthUser } from '../../lib/auth';
import type { AiPlan, KbPage } from '../../lib/outcome';
import {
  clearTour,
  clearTourResult,
  loadTourResult,
  markTourAborted,
  normalizeUrl,
  startTour,
  type TourState,
} from '../../lib/tour';
import { teardownFx, TOUR_ABORT_EVENT } from '../../lib/fx';
import { LoginForm, ChangePasswordForm } from './AuthForms';
import { useTourDriver, type AskResult } from './useTourDriver';

type Status = 'idle' | 'reading' | 'streaming' | 'done' | 'error';
type Mode = 'single' | 'follow' | 'visual';
type AuthPhase = 'checking' | 'loggedOut' | 'mustChange' | 'in';

const SIDEBAR_WIDTH_KEY = 'rs:sidebarWidth';
const DEFAULT_SIDEBAR_WIDTH = 360;
const MIN_SIDEBAR_WIDTH = 320;
const MIN_PAGE_WIDTH = 240;

function maxSidebarWidth(): number {
  return Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_PAGE_WIDTH);
}

function clampSidebarWidth(width: number): number {
  return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), maxSidebarWidth());
}

function statusLabel(status: Status, mode: Mode): string {
  if (status === 'reading') return mode === 'visual' ? 'Tour visivo' : 'Lettura';
  if (status === 'streaming') return 'Generazione';
  if (status === 'done') return 'Pronto';
  if (status === 'error') return 'Errore';
  return 'In attesa';
}

export default function App() {
  const [open, setOpen] = useState(true);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('checking');
  const [me, setMe] = useState<AuthUser | null>(null);
  const [query, setQuery] = useState('');
  // Default single-page: sulla KB Salesforce (client-rendered) le altre modalità
  // non possono leggere altre pagine via fetch (vedi hasRenderedContent), e la
  // pagina corrente è la più economica in token.
  const [mode, setMode] = useState<Mode>('single');
  const [status, setStatus] = useState<Status>('idle');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');
  const [pagesUsed, setPagesUsed] = useState<KbPage[]>([]);
  const [tour, setTour] = useState<TourState | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const abortRef = useRef<AbortController | null>(null);
  const tourAbortRef = useRef(false);
  const drivingRef = useRef(false);
  // Live sidebar geometry for the tour banner (driveTour must not re-create
  // on every resize, so it reads these refs instead of closing over state).
  const openRef = useRef(open);
  const sidebarWidthRef = useRef(sidebarWidth);
  const originalBodyStylesRef = useRef<{ marginRight: string; transition: string } | null>(null);

  // Validate the stored token at mount: decides login form vs main UI.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const user = await fetchMe(await getProxyUrl());
      if (cancelled) return;
      setMe(user);
      setAuthPhase(user ? (user.mustChangePassword ? 'mustChange' : 'in') : 'loggedOut');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onLoggedIn = useCallback((user: AuthUser) => {
    setMe(user);
    setAuthPhase(user.mustChangePassword ? 'mustChange' : 'in');
  }, []);

  const doLogout = useCallback(async () => {
    await logout(await getProxyUrl());
    setMe(null);
    setAuthPhase('loggedOut');
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await browser.storage.local.get(SIDEBAR_WIDTH_KEY);
        const width = stored[SIDEBAR_WIDTH_KEY];
        if (!cancelled && typeof width === 'number') {
          setSidebarWidth(clampSidebarWidth(width));
        }
      } catch {
        /* keep default */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    openRef.current = open;
    sidebarWidthRef.current = sidebarWidth;
  }, [open, sidebarWidth]);

  useEffect(() => {
    if (!open) return;
    browser.storage.local.set({ [SIDEBAR_WIDTH_KEY]: sidebarWidth }).catch(() => {
      /* best-effort */
    });
  }, [open, sidebarWidth]);

  useEffect(() => {
    if (!open) return;
    const onResize = () => setSidebarWidth((width) => clampSidebarWidth(width));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [open]);

  useEffect(() => {
    const body = document.body;
    if (!body) return;

    if (!open) {
      if (originalBodyStylesRef.current) {
        body.style.marginRight = originalBodyStylesRef.current.marginRight;
        body.style.transition = originalBodyStylesRef.current.transition;
        originalBodyStylesRef.current = null;
      }
      return;
    }

    if (!originalBodyStylesRef.current) {
      originalBodyStylesRef.current = {
        marginRight: body.style.marginRight,
        transition: body.style.transition,
      };
    }

    body.style.marginRight = `${sidebarWidth}px`;
    body.style.transition = body.style.transition || 'margin-right 120ms ease';

    return () => {
      if (originalBodyStylesRef.current) {
        body.style.marginRight = originalBodyStylesRef.current.marginRight;
        body.style.transition = originalBodyStylesRef.current.transition;
        originalBodyStylesRef.current = null;
      }
    };
  }, [open, sidebarWidth]);

  const resetSession = useCallback(async () => {
    abortRef.current?.abort();
    tourAbortRef.current = true;
    drivingRef.current = false;
    teardownFx();
    // Stamp the cross-navigation abort flag (like stopTour) so a tour whose
    // navigation is already committing does not resurrect on the next page.
    await markTourAborted();
    await clearTour();
    await clearTourResult();
    setQuery('');
    setPlan(null);
    setOutcome('');
    setError('');
    setPagesUsed([]);
    setTour(null);
    setStatus('idle');
  }, []);

  // Stream the outcome for a collected set of pages (shared by all modes).
  const runAsk = useCallback(
    async (
      q: string,
      pages: KbPage[],
      linksOverride = extractInternalLinks(),
    ): Promise<AskResult> => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      let accumulatedOutcome = '';
      let receivedPlan: AiPlan | null = null;

      setStatus('streaming');
      setOutcome('');
      setPlan(null);
      setError('');
      setPagesUsed(pages);

      const proxyUrl = await getProxyUrl();
      const token = await getToken();
      await streamAsk(
        proxyUrl,
        { query: q.trim(), pages, links: linksOverride },
        (event) => {
          switch (event.type) {
            case 'plan':
              receivedPlan = event.plan;
              setPlan(event.plan);
              break;
            case 'delta':
              accumulatedOutcome += event.text;
              setOutcome((prev) => prev + event.text);
              break;
            case 'done':
              setStatus('done');
              break;
            case 'error':
              setError(event.message);
              setStatus('error');
              break;
            case 'auth-required':
              // Session expired or revoked: back to the login form.
              void clearToken();
              setMe(null);
              setAuthPhase('loggedOut');
              setStatus('idle');
              break;
          }
        },
        controller.signal,
        token,
      );
      setStatus((s) => (s === 'streaming' ? 'done' : s));
      return { outcome: accumulatedOutcome, plan: receivedPlan };
    },
    [],
  );

  // Tour visivo: la macchina a stati vive in useTourDriver.ts.
  const driveTour = useTourDriver({
    runAsk,
    openRef,
    sidebarWidthRef,
    tourAbortRef,
    drivingRef,
    setTour,
    setQuery,
    setPagesUsed,
    setStatus,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadTourResult();
      if (cancelled || !result) return;
      // Tolerant match: normalizeUrl only strips the hash, so a redirect that
      // adds/removes a trailing slash would drop the answer. Also accept a very
      // fresh result (the tour just navigated here) even if the landing URL
      // differs slightly, so the generated answer is never silently lost.
      const stripSlash = (u: string) => normalizeUrl(u).replace(/\/+$/, '');
      const urlMatches = stripSlash(result.targetUrl) === stripSlash(location.href);
      const fresh = Date.now() - result.startedAt < 15_000;
      if (!urlMatches && !fresh) return;
      setOpen(true);
      setMode('visual');
      setQuery(result.query);
      setOutcome(result.outcome);
      setPlan(result.plan);
      setPagesUsed(result.pages);
      setError('');
      setStatus('done');
      setTour(null);
      await clearTourResult();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // The in-page walk never crosses a reload, so there is no tour to resume on
    // mount. Just sweep any FX leftover from a previous content-script life
    // (e.g. an aborted tour) and drop any legacy persisted tour state.
    teardownFx();
    void clearTour();
  }, []);

  const run = useCallback(async () => {
    if (!query.trim() || status === 'reading' || status === 'streaming') return;

    if (mode === 'visual') {
      teardownFx();
      // A user-initiated run is authoritative: reset the reentrancy guard and
      // drop any leftover/stale tour so a fresh visual run always starts, even
      // if a previous driveTour left drivingRef stuck (see Bug 0). Safe because
      // the button is disabled while busy, so no live loop can be running here.
      drivingRef.current = false;
      tourAbortRef.current = false;
      await clearTour();
      await clearTourResult();
      setStatus('reading');
      setOutcome('');
      setPlan(null);
      setError('');
      const t = startTour(query.trim());
      await driveTour(t);
      return;
    }

    setStatus('reading');
    const current = extractCurrentPage(query);
    const links = extractInternalLinks();
    const pages: KbPage[] = [current];
    const askLinks = mode === 'follow' ? pickRelevantLinks(links, query) : links;
    if (mode === 'follow') {
      const followed = await shallowFollow(askLinks, query, askLinks.length);
      pages.push(...followed);
    }
    await runAsk(query, pages, askLinks);
  }, [query, mode, status, driveTour, runAsk]);

  const stopTour = useCallback(async () => {
    tourAbortRef.current = true;
    drivingRef.current = false;
    abortRef.current?.abort();
    teardownFx();
    await markTourAborted();
    await clearTour();
    await clearTourResult();
    setTour(null);
    setStatus('idle');
  }, []);

  // The banner's stop button lives in the host DOM (outside React): it fires
  // this event for a live abort; the storage flag it also writes covers the
  // click-during-navigation race (see markTourAborted).
  useEffect(() => {
    const onAbort = () => void stopTour();
    window.addEventListener(TOUR_ABORT_EVENT, onAbort);
    return () => window.removeEventListener(TOUR_ABORT_EVENT, onAbort);
  }, [stopTour]);

  const startResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const move = (pointerEvent: PointerEvent) => {
      setSidebarWidth(clampSidebarWidth(window.innerWidth - pointerEvent.clientX));
    };
    const stop = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };

    move(event.nativeEvent);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, []);

  const busy = status === 'reading' || status === 'streaming';
  const tourActive = tour !== null && tour.phase !== 'done' && tour.phase !== 'error';
  const hasSession = Boolean(query || outcome || plan || pagesUsed.length);
  const currentStatusLabel = statusLabel(status, mode);

  if (!open) {
    return (
      <button
        className="rs-launcher"
        onClick={() => setOpen(true)}
        title="Riapri RunwaySurfer: il contenuto resta stabile fino al reload"
      >
        <span className="rs-launcher-mark">RS</span>
        <span>{hasSession ? 'Riprendi' : 'RunwaySurfer'}</span>
      </button>
    );
  }

  return (
    <div className="rs-panel" style={{ width: `${sidebarWidth}px` }}>
      <div
        className="rs-resize"
        onPointerDown={startResize}
        role="separator"
        aria-orientation="vertical"
        aria-label="Ridimensiona sidebar"
        title="Ridimensiona sidebar"
      />
      <header className="rs-header">
        <div className="rs-brand">
          <span className="rs-title">RunwaySurfer</span>
          <span className="rs-subtitle">KB copilot</span>
        </div>
        <div className="rs-header-actions">
          <span className={`rs-status rs-status-${status}`}>{currentStatusLabel}</span>
          <button
            className="rs-close"
            onClick={() => setOpen(false)}
            title="Nascondi sidebar: il contenuto resta stabile fino al reload"
          >
            x
          </button>
        </div>
      </header>

      <div className="rs-body">
        {authPhase === 'checking' && <div className="rs-auth-note">Verifica sessione...</div>}
        {authPhase === 'loggedOut' && <LoginForm onLoggedIn={onLoggedIn} />}
        {authPhase === 'mustChange' && <ChangePasswordForm onChanged={onLoggedIn} />}
        {authPhase === 'in' && (
          <>
            <div className="rs-whoami">
              <span>{me?.name || me?.username}</span>
              <button
                className="rs-logout"
                type="button"
                onClick={() => {
                  void resetSession();
                  void doLogout();
                }}
              >
                Logout
              </button>
            </div>
            <div className="rs-provider-note">
              <strong>Demo mock.</strong> I link sono scelti con scoring locale; il provider AI
              reale si collega lato backend senza esporre chiavi nell'estensione.
            </div>

            <label className="rs-label" htmlFor="rs-query">
              Cosa ti serve?
            </label>
            <textarea
              id="rs-query"
              className="rs-input"
              rows={3}
              placeholder="es. cliente vuole cambiare indirizzo ordine"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) run();
              }}
            />

            <label className="rs-label" htmlFor="rs-mode">
              Modalita lettura
            </label>
            <select
              id="rs-mode"
              className="rs-select"
              value={mode}
              disabled={busy}
              onChange={(e) => setMode(e.target.value as Mode)}
            >
              <option value="visual">Tour visivo (automatico)</option>
              <option value="follow">Pagine collegate in background</option>
              <option value="single">Solo pagina corrente</option>
            </select>

            <div className="rs-actions">
              <button className="rs-submit" onClick={run} disabled={busy || !query.trim()}>
                {status === 'reading'
                  ? mode === 'visual'
                    ? 'Tour in corso...'
                    : 'Lettura pagina...'
                  : status === 'streaming'
                    ? 'Generazione...'
                    : 'Chiedi'}
              </button>
              <button
                className="rs-secondary"
                onClick={() => void resetSession()}
                disabled={busy || !hasSession}
              >
                Nuova
              </button>
            </div>

            {tourActive && (
              <div className="rs-tour">
                <span>
                  {tour.phase === 'asking'
                    ? 'Analisi delle pagine visitate...'
                    : `Tour visivo - passo ${Math.min(tour.index + 1, tour.targets.length)}/${
                        tour.targets.length
                      }: apro "${tour.targets[Math.min(tour.index, tour.targets.length - 1)]?.text}"`}
                </span>
                <button className="rs-abort" onClick={stopTour}>
                  Interrompi tour
                </button>
              </div>
            )}

            {plan && (
              <div className="rs-plan" title="Richiesta che il backend invierebbe al modello AI">
                <div className="rs-plan-row">
                  <span>Modello</span>
                  <strong>{plan.model}</strong>
                </div>
                <div className="rs-plan-row">
                  <span>Stima token</span>
                  <strong>
                    {plan.estimatedInputTokens} in / {plan.estimatedOutputTokens} out
                  </strong>
                </div>
                <div className="rs-plan-row">
                  <span>Stima costo</span>
                  <strong>${plan.estimatedCostUsd.toFixed(4)}</strong>
                </div>
                <div className="rs-plan-row">
                  <span>Egress</span>
                  <code>{plan.egress}</code>
                </div>
                <div className="rs-plan-reason">
                  {plan.provider === 'mock' ? 'Risposta MOCK - ' : 'Provider reale - '}
                  {plan.routingReason}
                </div>
              </div>
            )}

            {error && <div className="rs-error">{error}</div>}

            {outcome && (
              <article className="rs-outcome">
                {outcome.split('\n').map((line, i) => (
                  <p key={i} className={line.startsWith('## ') ? 'rs-h' : ''}>
                    {line.replace(/^##\s*/, '')}
                  </p>
                ))}
              </article>
            )}

            {pagesUsed.length > 0 && (
              <details className="rs-pages">
                <summary>{pagesUsed.length} pagina/e lette</summary>
                <ul>
                  {pagesUsed.map((p) => (
                    <li key={p.url}>
                      <span className={`rs-badge rs-${p.origin}`}>{p.origin}</span> {p.title}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
