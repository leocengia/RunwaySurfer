// Fase 5 — harness di valutazione OFFLINE (meta locale, nessuna API).
// Per ogni golden gira il PREFILTRO locale (`shortlistCandidates`) sull'indice KB
// reale bundle-ato e misura:
//   - recall@shortlist : l'articolo atteso è nella shortlist? (se no, nessun
//                        reranker AI a valle potrà recuperarlo → metrica chiave)
//   - precision@1 / @3 : lo scoring locale lo mette 1° / nei primi 3?
// I numeri CURATED sono la baseline da battere in Fase 6 (rerank AI). I numeri
// BOOTSTRAP sono un guard di regressione (query ~= titolo → devono essere trovati).
import { describe, expect, it } from 'vitest';
import { shortlistCandidates, SHORTLIST_SIZE } from '../lib/crawl';
import goldens from './fixtures/rank-goldens.json';

interface Golden {
  query: string;
  expectedUrl: string;
  source: string;
}

/** Identità dell'URL: origin+path in minuscolo, ignora query/fragment. */
function identity(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`.toLowerCase().replace(/\/+$/, '');
  } catch {
    return url.trim().toLowerCase();
  }
}

interface Metrics {
  n: number;
  recall: number;
  p1: number;
  p3: number;
}

function evaluate(set: Golden[]): { metrics: Metrics; rows: Array<Record<string, unknown>> } {
  let hitRecall = 0;
  let hitP1 = 0;
  let hitP3 = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const g of set) {
    const shortlist = shortlistCandidates([], g.query, SHORTLIST_SIZE);
    const ids = shortlist.map((l) => identity(l.url));
    const want = identity(g.expectedUrl);
    const rank = ids.indexOf(want); // -1 se assente
    const inShortlist = rank !== -1;
    const p1 = rank === 0;
    const p3 = rank !== -1 && rank < 3;
    if (inShortlist) hitRecall++;
    if (p1) hitP1++;
    if (p3) hitP3++;
    rows.push({
      query: g.query.slice(0, 42),
      rank: inShortlist ? rank + 1 : '—',
      recall: inShortlist ? '✓' : '✗',
      top3: p3 ? '✓' : '✗',
    });
  }
  const n = set.length || 1;
  return {
    metrics: { n: set.length, recall: hitRecall / n, p1: hitP1 / n, p3: hitP3 / n },
    rows,
  };
}

const all = [...goldens.curated, ...goldens.bootstrap] as Golden[];
const curated = all.filter((g) => g.source === 'curated');
const bootstrap = all.filter((g) => g.source === 'bootstrap');

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

// Lo scoring gira su TUTTO l'indice reale (~2964) per ogni golden: costoso, quindi
// lo calcoliamo UNA volta qui e i test leggono i risultati memoizzati.
const curatedEval = curated.length ? evaluate(curated) : null;
const bootstrapEval = bootstrap.length ? evaluate(bootstrap) : null;

describe('rank eval — prefiltro locale (offline)', () => {
  it('stampa la baseline LOCALE (recall@shortlist, precision@1/@3) per source', () => {
    for (const [name, res] of [
      ['curated', curatedEval],
      ['bootstrap', bootstrapEval],
    ] as const) {
      if (!res) continue;
      const { metrics, rows } = res;
      console.log(
        `\n[rank-eval:${name}] n=${metrics.n}  recall@${SHORTLIST_SIZE}=${pct(metrics.recall)}  ` +
          `precision@1=${pct(metrics.p1)}  precision@3=${pct(metrics.p3)}`,
      );
      console.table(rows);
    }
    expect(all.length).toBeGreaterThan(0);
  });

  it('guard di regressione: recall@shortlist bootstrap ≥ 90%', () => {
    // Le query bootstrap sono ~il titolo dell'articolo: se lo scorer/indice non le
    // trova quasi tutte, qualcosa è regredito (scorer, dedup, o asset indice).
    if (!bootstrapEval) return;
    expect(bootstrapEval.metrics.recall).toBeGreaterThanOrEqual(0.9);
  });

  it('ogni expectedUrl dei goldens esiste nell’indice KB (fixture non marcia)', async () => {
    const { kbIndexAsLinks } = await import('../lib/kb-index');
    const known = new Set(kbIndexAsLinks().map((l) => identity(l.url)));
    const missing = all.filter((g) => !known.has(identity(g.expectedUrl)));
    expect(missing.map((g) => g.expectedUrl)).toEqual([]);
  });
});
