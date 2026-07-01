import { useCallback, useEffect, useRef, useState } from 'react';
import { extractCurrentPage, extractInternalLinks } from '../../lib/extract';
import { shallowFollow } from '../../lib/crawl';
import { streamAsk } from '../../lib/client';
import { getProxyUrl } from '../../lib/messaging';
import type { AiPlan, KbPage } from '../../lib/outcome';
import {
  clearTour,
  loadTour,
  normalizeUrl,
  saveTour,
  startTour,
  type TourState,
} from '../../lib/tour';
import { dwell, findLinkElement, scrollAndHighlight } from '../../lib/highlight';

type Status = 'idle' | 'reading' | 'streaming' | 'done' | 'error';
type Mode = 'single' | 'follow' | 'visual';

export default function App() {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<Mode>('follow');
  const [status, setStatus] = useState<Status>('idle');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');
  const [pagesUsed, setPagesUsed] = useState<KbPage[]>([]);
  const [tour, setTour] = useState<TourState | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const tourAbortRef = useRef(false);
  const drivingRef = useRef(false);

  // Stream the outcome for a collected set of pages (shared by all modes).
  const runAsk = useCallback(async (q: string, pages: KbPage[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('streaming');
    setOutcome('');
    setPlan(null);
    setError('');
    setPagesUsed(pages);

    const proxyUrl = await getProxyUrl();
    const links = extractInternalLinks();
    await streamAsk(
      proxyUrl,
      { query: q.trim(), pages, links },
      (event) => {
        switch (event.type) {
          case 'plan':
            setPlan(event.plan);
            break;
          case 'delta':
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
  }, []);

  // Drive the visual tour one transition at a time. Each navigation unloads the
  // content script; on the next mount the effect below rehydrates and re-enters
  // here with the persisted state, so the tour resumes seamlessly.
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
              // Not back at the hub yet → go there; the start-page mount resumes.
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
              // Persist the "navigating" intent BEFORE leaving so the target
              // page knows to collect itself on load.
              await saveTour({ ...t, phase: 'navigating' });
              await dwell(t.dwellMs);
              cleanup?.();
              if (tourAbortRef.current) return;
              location.href = target.url;
              return;
            }

            case 'navigating': {
              // We reloaded after leaving the hub. If we somehow never left,
              // skip this target to guarantee the tour terminates.
              if (onStart) {
                t = { ...t, index: t.index + 1, phase: 'returning' };
                await saveTour(t);
                continue;
              }
              // Collect whatever followed page we landed on, then head back.
              const page: KbPage = { ...extractCurrentPage(), origin: 'followed' };
              const pages = [...t.pages, page];
              t = { ...t, pages, index: t.index + 1, phase: 'returning' };
              setPagesUsed(pages);
              await saveTour(t);
              location.href = t.startUrl;
              return;
            }

            case 'asking': {
              setTour(t);
              await runAsk(t.query, t.pages);
              await clearTour();
              setTour(null);
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

  // On mount, resume an in-progress tour so the sidebar looks continuous across
  // the reloads caused by same-tab navigation.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const t = await loadTour();
      if (cancelled || !t) return;
      if (t.phase === 'idle' || t.phase === 'done' || t.phase === 'error') return;
      setMode('visual');
      tourAbortRef.current = false;
      // Let the page settle (layout done, target anchor present) before driving.
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

    // Non-visual modes: read the current page (optionally background-follow),
    // then stream the outcome — the original behavior.
    setStatus('reading');
    const current = extractCurrentPage();
    const links = extractInternalLinks();
    const pages: KbPage[] = [current];
    if (mode === 'follow') {
      const followed = await shallowFollow(links, query);
      pages.push(...followed);
    }
    await runAsk(query, pages);
  }, [query, mode, status, driveTour, runAsk]);

  const stopTour = useCallback(async () => {
    tourAbortRef.current = true;
    abortRef.current?.abort();
    await clearTour();
    setTour(null);
    setStatus('idle');
  }, []);

  if (!open) {
    return (
      <button className="rs-launcher" onClick={() => setOpen(true)} title="Apri RunwaySurfer">
        🏄 RunwaySurfer
      </button>
    );
  }

  const busy = status === 'reading' || status === 'streaming';
  const tourActive = tour !== null && tour.phase !== 'done' && tour.phase !== 'error';

  return (
    <div className="rs-panel">
      <header className="rs-header">
        <span className="rs-title">🏄 RunwaySurfer</span>
        <button className="rs-close" onClick={() => setOpen(false)} title="Chiudi">
          ✕
        </button>
      </header>

      <div className="rs-body">
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
          Modalità lettura
        </label>
        <select
          id="rs-mode"
          className="rs-select"
          value={mode}
          disabled={busy}
          onChange={(e) => setMode(e.target.value as Mode)}
        >
          <option value="single">Solo pagina corrente</option>
          <option value="follow">Leggi anche le pagine collegate (background)</option>
          <option value="visual">Tour visivo (automatico)</option>
        </select>

        <button className="rs-submit" onClick={run} disabled={busy || !query.trim()}>
          {status === 'reading'
            ? mode === 'visual'
              ? 'Tour in corso…'
              : 'Lettura pagina…'
            : status === 'streaming'
              ? 'Generazione…'
              : 'Chiedi (⌘/Ctrl+Invio)'}
        </button>

        {tourActive && (
          <div className="rs-tour">
            <span>
              {tour.phase === 'asking'
                ? '🔎 Analisi delle pagine visitate…'
                : `Tour visivo — passo ${Math.min(tour.index + 1, tour.targets.length)}/${
                    tour.targets.length
                  }: apro «${tour.targets[Math.min(tour.index, tour.targets.length - 1)]?.text}»`}
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
              {plan.provider === 'mock' ? '⚠️ Risposta MOCK — ' : '● Provider reale — '}
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
