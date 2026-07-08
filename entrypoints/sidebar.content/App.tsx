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
import {
  changePassword,
  clearToken,
  fetchMe,
  getToken,
  login,
  logout,
  type AuthUser,
} from '../../lib/auth';
import type { AiPlan, KbPage } from '../../lib/outcome';
import {
  clearTour,
  clearTourResult,
  DEFAULT_SCAN_MS,
  loadTour,
  loadTourResult,
  markTourAborted,
  normalizeUrl,
  saveTour,
  saveTourResult,
  startTour,
  type TourState,
} from '../../lib/tour';
import { findLinkElement } from '../../lib/highlight';
import {
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
  TOUR_ABORT_EVENT,
  unmountBanner,
} from '../../lib/fx';

type Status = 'idle' | 'reading' | 'streaming' | 'done' | 'error';
type Mode = 'single' | 'follow' | 'visual';
type AskResult = { outcome: string; plan: AiPlan | null };
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

function trimUrl(raw: string): string {
  return raw.replace(/[),.;\]]+$/g, '');
}

function urlsIn(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>)\]]+/g), (match) => trimUrl(match[0]));
}

function sourceSection(markdown: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^##\s*fonti\b/i.test(line.trim()));
  if (start === -1) return '';
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

function matchingReadPage(url: string, pages: KbPage[], preferFollowed: boolean): KbPage | null {
  const want = normalizeUrl(url);
  const candidates = preferFollowed ? pages.filter((p) => p.origin === 'followed') : pages;
  return candidates.find((page) => normalizeUrl(page.url) === want) ?? null;
}

function findTourTargetUrl(markdown: string, pages: KbPage[]): string | null {
  const fromSources = urlsIn(sourceSection(markdown));
  const fromAll = urlsIn(markdown);
  for (const url of fromSources) {
    const page = matchingReadPage(url, pages, true);
    if (page) return page.url;
  }
  for (const url of fromSources) {
    const page = matchingReadPage(url, pages, false);
    if (page) return page.url;
  }
  for (const url of fromAll) {
    const page = matchingReadPage(url, pages, true) ?? matchingReadPage(url, pages, false);
    if (page) return page.url;
  }
  return null;
}

function statusLabel(status: Status, mode: Mode): string {
  if (status === 'reading') return mode === 'visual' ? 'Tour visivo' : 'Lettura';
  if (status === 'streaming') return 'Generazione';
  if (status === 'done') return 'Pronto';
  if (status === 'error') return 'Errore';
  return 'In attesa';
}

function LoginForm({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const submit = async () => {
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setAuthError('');
    try {
      const user = await login(await getProxyUrl(), username.trim(), password);
      onLoggedIn(user);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="rs-auth"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="rs-auth-note">
        Accedi con le credenziali fornite dal tuo amministratore per usare RunwaySurfer.
      </div>
      <label className="rs-label" htmlFor="rs-username">
        Username
      </label>
      <input
        id="rs-username"
        className="rs-field"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <label className="rs-label" htmlFor="rs-password">
        Password
      </label>
      <input
        id="rs-password"
        className="rs-field"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {authError && <div className="rs-error">{authError}</div>}
      <button className="rs-submit" type="submit" disabled={busy || !username.trim() || !password}>
        {busy ? 'Accesso...' : 'Accedi'}
      </button>
    </form>
  );
}

function ChangePasswordForm({ onChanged }: { onChanged: (user: AuthUser) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const submit = async () => {
    if (busy) return;
    if (next !== confirm) {
      setAuthError('Le nuove password non coincidono.');
      return;
    }
    setBusy(true);
    setAuthError('');
    try {
      const user = await changePassword(await getProxyUrl(), current, next);
      onChanged(user);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="rs-auth"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="rs-auth-note">
        Devi impostare una nuova password prima di continuare.
      </div>
      <label className="rs-label" htmlFor="rs-current-password">
        Password attuale
      </label>
      <input
        id="rs-current-password"
        className="rs-field"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <label className="rs-label" htmlFor="rs-new-password">
        Nuova password (min 8 caratteri)
      </label>
      <input
        id="rs-new-password"
        className="rs-field"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <label className="rs-label" htmlFor="rs-confirm-password">
        Conferma nuova password
      </label>
      <input
        id="rs-confirm-password"
        className="rs-field"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {authError && <div className="rs-error">{authError}</div>}
      <button
        className="rs-submit"
        type="submit"
        disabled={busy || !current || next.length < 8 || !confirm}
      >
        {busy ? 'Salvataggio...' : 'Cambia password'}
      </button>
    </form>
  );
}

export default function App() {
  const [open, setOpen] = useState(true);
  const [authPhase, setAuthPhase] = useState<AuthPhase>('checking');
  const [me, setMe] = useState<AuthUser | null>(null);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('visual');
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
    teardownFx();
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
    async (q: string, pages: KbPage[], linksOverride = extractInternalLinks()): Promise<AskResult> => {
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

  const driveTour = useCallback(
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

        // eslint-disable-next-line no-constant-condition
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
                await sleep(700);
                if (tourAbortRef.current) {
                  teardownFx();
                  return;
                }
                location.href = target.url;
                return;
              }
              void narrate(narrationOpen(target, step, total));
              const offSpotlight = spotlightOn(el);
              // Cinematic approach: the page glides while the ghost cursor
              // curves toward the link, landing just after the scroll settles.
              await Promise.all([smoothScrollTo(el), cursorGlideTo(el)]);
              await saveTour({ ...t, phase: 'navigating' });
              await sleep(t.dwellMs);
              if (tourAbortRef.current) {
                offSpotlight();
                teardownFx();
                return;
              }
              await cursorClick();
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
              const visited = t.targets[t.index];
              mountBanner({ step: Math.min(t.index + 1, total), total, rightOffsetPx: rightOffset() });
              setBannerProgress((t.index + 0.5) / units);
              void narrate(`Sto leggendo «${document.title}»…`);
              const page: KbPage = { ...extractCurrentPage(t.query), origin: 'followed' };
              const pages = [...t.pages, page];
              t = { ...t, pages, index: t.index + 1, phase: 'returning' };
              setPagesUsed(pages);
              // Persist BEFORE the scan so a reload mid-scan resumes correctly.
              await saveTour(t);
              await runReadingScan({
                keywords: visited?.matchedKeywords ?? [],
                durationMs: t.scanMs ?? DEFAULT_SCAN_MS,
              });
              if (tourAbortRef.current) {
                teardownFx();
                return;
              }
              void narrate('Torno alla pagina di partenza…');
              await sleep(350);
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
              await sleep(900);
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
    [runAsk],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadTourResult();
      if (cancelled || !result) return;
      if (normalizeUrl(result.targetUrl) !== normalizeUrl(location.href)) return;
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
    let cancelled = false;
    (async () => {
      // Sweep any FX leftover from a previous content-script life (e.g. after
      // an aborted tour) before deciding whether to resume.
      teardownFx();
      const t = await loadTour();
      if (cancelled || !t) return;
      if (t.phase === 'idle' || t.phase === 'done' || t.phase === 'error') return;
      setMode('visual');
      tourAbortRef.current = false;
      setTimeout(() => {
        if (!cancelled) driveTour(t);
      }, 300);
    })();
    return () => {
      cancelled = true;
    };
  }, [driveTour]);

  const run = useCallback(async () => {
    if (!query.trim() || status === 'reading' || status === 'streaming') return;

    if (mode === 'visual') {
      teardownFx();
      tourAbortRef.current = false;
      setStatus('reading');
      setOutcome('');
      setPlan(null);
      setError('');
      const t = startTour(query.trim());
      await saveTour(t);
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
          <strong>Demo mock.</strong> I link sono scelti con scoring locale; il provider AI reale si
          collega lato backend senza esporre chiavi nell'estensione.
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
          <button className="rs-secondary" onClick={() => void resetSession()} disabled={busy || !hasSession}>
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
