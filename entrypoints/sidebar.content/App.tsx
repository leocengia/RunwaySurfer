import { useCallback, useRef, useState } from 'react';
import { extractCurrentPage, extractInternalLinks } from '../../lib/extract';
import { shallowFollow } from '../../lib/crawl';
import { streamAsk } from '../../lib/client';
import { getProxyUrl } from '../../lib/messaging';
import type { AiPlan, KbPage } from '../../lib/outcome';

type Status = 'idle' | 'reading' | 'streaming' | 'done' | 'error';

export default function App() {
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [followLinks, setFollowLinks] = useState(true);
  const [status, setStatus] = useState<Status>('idle');
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [outcome, setOutcome] = useState('');
  const [error, setError] = useState('');
  const [pagesUsed, setPagesUsed] = useState<KbPage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(async () => {
    if (!query.trim() || status === 'reading' || status === 'streaming') return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('reading');
    setOutcome('');
    setPlan(null);
    setError('');

    // 1. Read the current page + its nested internal links.
    const current = extractCurrentPage();
    const links = extractInternalLinks();
    const pages: KbPage[] = [current];

    // 2. Optional shallow follow: read the most relevant linked pages, reusing
    //    the page's session (in prod: the agent's SSO session).
    if (followLinks) {
      const followed = await shallowFollow(links, query);
      pages.push(...followed);
    }
    setPagesUsed(pages);

    // 3. Stream the outcome from the backend.
    setStatus('streaming');
    const proxyUrl = await getProxyUrl();
    await streamAsk(
      proxyUrl,
      { query: query.trim(), pages, links },
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
  }, [query, followLinks, status]);

  if (!open) {
    return (
      <button className="rs-launcher" onClick={() => setOpen(true)} title="Apri RunwaySurfer">
        🏄 RunwaySurfer
      </button>
    );
  }

  const busy = status === 'reading' || status === 'streaming';

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

        <label className="rs-check">
          <input
            type="checkbox"
            checked={followLinks}
            onChange={(e) => setFollowLinks(e.target.checked)}
          />
          Leggi anche le pagine collegate (multi-pagina)
        </label>

        <button className="rs-submit" onClick={run} disabled={busy || !query.trim()}>
          {status === 'reading'
            ? 'Lettura pagina…'
            : status === 'streaming'
              ? 'Generazione…'
              : 'Chiedi (⌘/Ctrl+Invio)'}
        </button>

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
