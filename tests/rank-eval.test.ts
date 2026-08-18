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
import { unique } from '../lib/text';
import goldens from './fixtures/rank-goldens.json';
import survey from './fixtures/survey-queries-2026-08.json';

interface Golden {
  query: string;
  /** Risposta attesa singola. */
  expectedUrl?: string;
  /**
   * Più risposte attese, per le richieste di ELENCO ESAUSTIVO («dimmi tutte le
   * casistiche di…»): tre delle 27 query del sondaggio sono di questo tipo, e per
   * quelle un solo articolo non è la risposta giusta. Il recall le conta coperte
   * quando c'è almeno un atteso in shortlist; `precision@3` guarda il migliore.
   */
  expectedUrls?: string[];
  /** Perché questa query è difficile: si legge nei report, non serve al calcolo. */
  note?: string;
  source: string;
}

/** Gli URL attesi di un golden, in un solo formato per chi calcola le metriche. */
function expectedOf(g: Golden): string[] {
  return unique([...(g.expectedUrl ? [g.expectedUrl] : []), ...(g.expectedUrls ?? [])]);
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
    const wanted = expectedOf(g).map(identity);
    // Con più risposte attese conta la MIGLIORE posizione raggiunta: la domanda
    // è coperta se il retrieval ne ha portato almeno una in shortlist.
    const ranks = wanted.map((w) => ids.indexOf(w)).filter((r) => r !== -1);
    const rank = ranks.length ? Math.min(...ranks) : -1;
    const inShortlist = rank !== -1;
    const p1 = rank === 0;
    const p3 = rank !== -1 && rank < 3;
    if (inShortlist) hitRecall++;
    if (p1) hitP1++;
    if (p3) hitP3++;
    rows.push({
      query: g.query.slice(0, 42),
      attesi: wanted.length,
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

  it('ogni URL atteso dei goldens esiste nell’indice KB (fixture non marcia)', async () => {
    const { kbIndexAsLinks } = await import('../lib/kb-index');
    const known = new Set(kbIndexAsLinks().map((l) => identity(l.url)));
    const missing = all.flatMap((g) => expectedOf(g).filter((u) => !known.has(identity(u))));
    expect(missing).toEqual([]);
  });

  it('ogni golden dichiara almeno una risposta attesa', () => {
    // Schema /2: `expectedUrl` oppure `expectedUrls`. Un golden senza nessuno dei
    // due passerebbe silenziosamente come "mai trovato", abbassando il recall
    // senza che nulla sia rotto nel retrieval.
    expect(all.filter((g) => expectedOf(g).length === 0).map((g) => g.query)).toEqual([]);
  });
});

describe('le query del sondaggio agenti (fixture versionato)', () => {
  it('sono 27, con id distinti', () => {
    // Vengono da un .xlsx fuori dal repo: il fixture è la copia versionata, ed è
    // la fonte sia del report da etichettare sia dei goldens che ne nasceranno.
    expect(survey.queries).toHaveLength(27);
    expect(new Set(survey.queries.map((q) => q.id)).size).toBe(27);
    expect(survey.queries.every((q) => q.query.trim().length > 0)).toBe(true);
  });

  it('nessuna produce una shortlist vuota', () => {
    // Prima del Giro 4 erano 4 a non produrre nulla: `ndc`, `ndc emea`,
    // `compensazioni per reclami` e la domanda con il refuso SAFTY. Una shortlist
    // vuota è il caso peggiore, perché nessun reranker AI a valle può rimediare.
    const empty = survey.queries.filter(
      (q) => shortlistCandidates([], q.query, SHORTLIST_SIZE).length === 0,
    );
    expect(empty.map((q) => q.id)).toEqual([]);
  });
});
