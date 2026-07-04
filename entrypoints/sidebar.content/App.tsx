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
import type { AiPlan, KbPage } from '../../lib/outcome';
import {
  clearTour,
  clearTourResult,
  loadTour,
  loadTourResult,
  normalizeUrl,
  saveTour,
  saveTourResult,
  startTour,
  type TourState,
} from '../../lib/tour';
import { dwell, findLinkElement, scrollAndHighlight } from '../../lib/highlight';

type Status = 'idle' | 'reading' | 'streaming' | 'done' | 'error';
type Mode = 'single' | 'follow' | 'visual';
type AskResult = { outcome: string; plan: AiPlan | null };

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

export default function App() {
  const [open, setOpen] = useState(true);
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
  const originalBodyStylesRef = useRef<{ marginRight: string; transition: string } | null>(null);

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
          }
        },
        controller.signal,
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
          if (tourAbortRef.current) return;

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
              const el = findLinkElement(target.url);
              const cleanup = el ? scrollAndHighlight(el) : null;
              await saveTour({ ...t, phase: 'navigating' });
              await dwell(t.dwellMs);
              cleanup?.();
              if (tourAbortRef.current) return;
              location.href = target.url;
              return;
            }

            case 'navigating': {
              if (onStart) {
                t = { ...t, index: t.index + 1, phase: 'returning' };
                await saveTour(t);
                continue;
              }
              const page: KbPage = { ...extractCurrentPage(t.query), origin: 'followed' };
              const pages = [...t.pages, page];
              t = { ...t, pages, index: t.index + 1, phase: 'returning' };
              setPagesUsed(pages);
              await saveTour(t);
              location.href = t.startUrl;
              return;
            }

            case 'asking': {
              setTour(t);
              const result = await runAsk(t.query, t.pages, t.targets);
              await clearTour();
              setTour(null);
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
    await clearTour();
    await clearTourResult();
    setTour(null);
    setStatus('idle');
  }, []);

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
      </div>
    </div>
  );
}
