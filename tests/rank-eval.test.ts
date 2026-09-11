// Fase 5 — harness di valutazione OFFLINE (meta locale, nessuna API).
// Per ogni golden gira il PREFILTRO locale (`shortlistCandidates`) sull'indice KB
// reale bundle-ato e misura:
//   - recall@40    : l'articolo atteso è nella shortlist? (se no, nessun
//                     reranker AI a valle potrà recuperarlo → metrica chiave)
//   - recall@6      : è fra i 6 che il report di etichettazione mostra davvero
//                     agli esperti KB — direttamente confrontabile col .docx.
//   - precision@1/@3: lo scoring locale lo mette 1° / nei primi 3?
//   - MRR@40        : l'unica che si muove per un progresso PARZIALE (un
//                     articolo che passa dal 31° al 9° posto non sposta
//                     recall@40 né P@1, ma è progresso reale).
//   - rank mediano  : posizione tipica di un articolo trovato, fra i trovati.
//
// TRE GRUPPI, MAI UN TOTALE: `curated·survey-2026-08` (20 query vere del
// sondaggio agenti, etichettate dagli esperti KB — vedi
// docs/ingest-survey-labels.mjs) e `curated·altro` (3 casi a mano, precedenti
// al sondaggio) sono DIFFICILI; `bootstrap` (query ≈ il titolo dell'articolo,
// generate da docs/build-rank-goldens.mjs) è FACILE per costruzione. Mediarli
// nasconderebbe esattamente il segnale che serve: i facili mascherano i
// difficili. Il dettaglio riga-per-riga si stampa solo per i due gruppi
// curated; quello di bootstrap solo dietro RS_EVAL_VERBOSE=1.
//
// IL GUARD DI REGRESSIONE sul gruppo survey è ANCORATO ALLA BASELINE MISURATA
// (tests/fixtures/rank-eval-baseline.json), non a un obiettivo assoluto: un
// guard fissato a un numero aspirazionale fallirebbe subito e verrebbe
// ignorato. La baseline si alza SOLO A MANO: quando il misurato la supera, il
// test stampa il blocco JSON pronto da incollare (mai lo scrive da solo — un
// test che riscrive la propria aspettativa non è un guard), così l'avanzamento
// compare nel diff del commit che lo ha prodotto.
import { describe, expect, it } from 'vitest';
import { retrievalEvidence, shortlistCandidates, SHORTLIST_SIZE } from '../lib/crawl';
import { assessQuery } from '../lib/query-quality';
import { unique } from '../lib/text';
import baseline from './fixtures/rank-eval-baseline.json';
import goldens from './fixtures/rank-goldens.json';
import survey from './fixtures/survey-queries-2026-08.json';

interface Golden {
  id?: string;
  query: string;
  /** Risposta attesa singola. */
  expectedUrl?: string;
  /**
   * Più risposte attese, per le richieste di ELENCO ESAUSTIVO («dimmi tutte le
   * casistiche di…»): per quelle un solo articolo non è la risposta giusta. Il
   * recall le conta coperte quando c'è almeno un atteso in shortlist;
   * `precision@1/@3` guardano la posizione MIGLIORE fra gli attesi.
   */
  expectedUrls?: string[];
  /** Perché questa query è difficile, o da dove viene la risposta: si legge nei report, non serve al calcolo. */
  note?: string;
  source: string;
  /** Provenienza per gli ingest rieseguibili (docs/ingest-survey-labels.mjs). */
  batch?: string;
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
  recall40: number;
  recall6: number;
  p1: number;
  p3: number;
  mrr: number;
  /** Posizione (1-indicizzata) mediana, SOLO fra i goldens trovati. `null` se nessuno trovato. */
  medianRank: number | null;
}

function median(sorted: number[]): number | null {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function evaluate(set: Golden[]): { metrics: Metrics; rows: Array<Record<string, unknown>> } {
  let hitRecall40 = 0;
  let hitRecall6 = 0;
  let hitP1 = 0;
  let hitP3 = 0;
  let mrrSum = 0;
  const foundRanks: number[] = []; // 1-indicizzati, solo i trovati
  const rows: Array<Record<string, unknown>> = [];
  for (const g of set) {
    const shortlist = shortlistCandidates([], g.query, SHORTLIST_SIZE);
    const ids = shortlist.map((l) => identity(l.url));
    const wantedAll = expectedOf(g).map(identity);
    const foundRanksForQuery = wantedAll.map((w) => ids.indexOf(w)).filter((r) => r !== -1);
    // Con più risposte attese conta la MIGLIORE posizione raggiunta: la domanda
    // è coperta se il retrieval ne ha portato almeno una in shortlist.
    const rank = foundRanksForQuery.length ? Math.min(...foundRanksForQuery) : -1;
    const inShortlist = rank !== -1;
    const p1 = rank === 0;
    const p3 = rank !== -1 && rank < 3;
    const r6 = rank !== -1 && rank < 6;
    if (inShortlist) {
      hitRecall40++;
      mrrSum += 1 / (rank + 1);
      foundRanks.push(rank + 1);
    }
    if (r6) hitRecall6++;
    if (p1) hitP1++;
    if (p3) hitP3++;
    rows.push({
      id: g.id ?? '',
      query: g.query.slice(0, 42),
      attesi: wantedAll.length,
      coperti:
        wantedAll.length > 1 ? `${new Set(foundRanksForQuery).size}/${wantedAll.length}` : '—',
      rank: inShortlist ? rank + 1 : '—',
      recall: inShortlist ? '✓' : '✗',
      top6: r6 ? '✓' : '✗',
      top3: p3 ? '✓' : '✗',
    });
  }
  const n = set.length || 1;
  return {
    metrics: {
      n: set.length,
      recall40: hitRecall40 / n,
      recall6: hitRecall6 / n,
      p1: hitP1 / n,
      p3: hitP3 / n,
      mrr: mrrSum / n,
      medianRank: median([...foundRanks].sort((a, b) => a - b)),
    },
    rows,
  };
}

const all = [...goldens.curated, ...goldens.bootstrap] as Golden[];
const SURVEY_BATCH = 'survey-2026-08';
const curatedSurvey = all.filter((g) => g.source === 'curated' && g.batch === SURVEY_BATCH);
const curatedOther = all.filter((g) => g.source === 'curated' && g.batch !== SURVEY_BATCH);
const bootstrap = all.filter((g) => g.source === 'bootstrap');

const GROUPS = [
  { name: 'curated·survey-2026-08', set: curatedSurvey },
  { name: 'curated·altro', set: curatedOther },
  { name: 'bootstrap', set: bootstrap },
] as const;

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

// Lo scoring gira su TUTTO l'indice reale (~2964) per ogni golden: costoso, quindi
// lo calcoliamo UNA volta qui e i test leggono i risultati memoizzati.
const evals = new Map(GROUPS.map(({ name, set }) => [name, set.length ? evaluate(set) : null]));

describe('rank eval — prefiltro locale (offline)', () => {
  it('stampa la tabella riassuntiva per gruppo (mai un totale: difficoltà diverse)', () => {
    const rows = GROUPS.map(({ name }) => {
      const res = evals.get(name);
      if (!res) return { gruppo: name, n: 0 };
      const m = res.metrics;
      return {
        gruppo: name,
        n: m.n,
        [`recall@${SHORTLIST_SIZE}`]: pct(m.recall40),
        'recall@6': pct(m.recall6),
        'P@1': pct(m.p1),
        'P@3': pct(m.p3),
        MRR: m.mrr.toFixed(2),
        'rank mediano': m.medianRank ?? '—',
      };
    });
    console.log('\n[rank-eval] riepilogo per gruppo:');
    console.table(rows);
    expect(all.length).toBeGreaterThan(0);
  });

  it('stampa il dettaglio dei gruppi curated (bootstrap solo con RS_EVAL_VERBOSE=1)', () => {
    for (const { name } of GROUPS) {
      if (name === 'bootstrap' && process.env.RS_EVAL_VERBOSE !== '1') continue;
      const res = evals.get(name);
      if (!res) continue;
      console.log(`\n[rank-eval:${name}]`);
      console.table(res.rows);
    }
  });

  it('guard di regressione: recall@shortlist bootstrap ≥ 90%', () => {
    // Le query bootstrap sono ~il titolo dell'articolo: se lo scorer/indice non le
    // trova quasi tutte, qualcosa è regredito (scorer, dedup, o asset indice).
    // Misura una cosa diversa dal guard sul gruppo survey sotto: la salute
    // dell'indice/scorer, non la qualità del ranking su domande difficili.
    const res = evals.get('bootstrap');
    if (!res) return;
    expect(res.metrics.recall40).toBeGreaterThanOrEqual(0.9);
  });

  it('guard di regressione: il gruppo survey non peggiora sotto la baseline (con tolleranza)', () => {
    const res = evals.get('curated·survey-2026-08');
    if (!res) return;
    const m = res.metrics;
    const b = baseline.groups['curated·survey-2026-08'];
    const tol = baseline.tolerance;

    // Nessun guard su P@1/P@3: a n=20 sono troppo rumorosi (un solo caso vale 5
    // punti) — si stampano nella tabella sopra e basta.
    expect(
      m.recall40,
      `recall@40 sceso sotto baseline(${b.recall40}) - tolleranza(${tol.recall40})`,
    ).toBeGreaterThanOrEqual(b.recall40 - tol.recall40);
    expect(
      m.mrr,
      `MRR sceso sotto baseline(${b.mrr}) - tolleranza(${tol.mrr})`,
    ).toBeGreaterThanOrEqual(b.mrr - tol.mrr);

    // Il misurato ha superato la baseline: si STAMPA il blocco pronto da
    // incollare (mai scritto in automatico — vedi commento in testa al file).
    if (m.recall40 > b.recall40 || m.mrr > b.mrr) {
      console.log(
        '\n[rank-eval] la baseline è superata. Per alzarla, incolla questo blocco in ' +
          'tests/fixtures/rank-eval-baseline.json → groups["curated·survey-2026-08"]:\n' +
          JSON.stringify(
            {
              n: m.n,
              recall40: Number(m.recall40.toFixed(4)),
              recall6: Number(m.recall6.toFixed(4)),
              p1: Number(m.p1.toFixed(4)),
              p3: Number(m.p3.toFixed(4)),
              mrr: Number(m.mrr.toFixed(4)),
              medianRank: m.medianRank,
            },
            null,
            2,
          ),
      );
    }
  });

  it('ogni URL atteso dei goldens esiste nell’indice KB (fixture non marcia)', async () => {
    const { kbIndexAsLinks } = await import('../lib/kb-index');
    const known = new Set(kbIndexAsLinks().map((l) => identity(l.url)));
    const missing = all.flatMap((g) => expectedOf(g).filter((u) => !known.has(identity(u))));
    expect(missing).toEqual([]);
  });

  it('ogni golden dichiara almeno una risposta attesa', () => {
    // Schema /3: `expectedUrl` oppure `expectedUrls`. Un golden senza nessuno dei
    // due passerebbe silenziosamente come "mai trovato", abbassando il recall
    // senza che nulla sia rotto nel retrieval.
    expect(all.filter((g) => expectedOf(g).length === 0).map((g) => g.query)).toEqual([]);
  });

  it('nessun id compare sia in curated sia in rejected (guard di consistenza sull’ingest)', () => {
    const curatedIds = new Set(all.map((g) => g.id).filter(Boolean));
    const overlap = (goldens.rejected as Array<{ id: string }>).filter((r) => curatedIds.has(r.id));
    expect(overlap).toEqual([]);
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
    // `compensazioni per reclami` e la domanda con il refuso SAFTY. Una
    // shortlist vuota è il caso peggiore, perché nessun reranker AI a valle
    // può rimediare.
    const empty = survey.queries.filter(
      (q) => shortlistCandidates([], q.query, SHORTLIST_SIZE).length === 0,
    );
    expect(empty.map((q) => q.id)).toEqual([]);
  }, // Gira lo scorer reale su ~2964 articoli per 27 query: ~3s in isolamento,
  // di più sotto la contesa della suite intera in parallelo. Il default di
  // Vitest (5000ms) basta appena in isolamento e non regge nella suite
  // completa — l'alternativa (indebolire il test) nasconderebbe una
  // regressione vera dietro un timeout invece di segnalarla.
  20_000);

  it('26 sono etichettate (curate o respinte); non registra un gate — solo il numero', () => {
    // Le 27 risposte del sondaggio sono 26 query distinte (r9-h/r9-i duplicate).
    // Copertura attesa: 20 curated (batch survey-2026-08) + 6 rejected = 26.
    const curatedIds = new Set(curatedSurvey.map((g) => g.id));
    const rejectedIds = new Set((goldens.rejected as Array<{ id: string }>).map((r) => r.id));
    const distinctQueries = new Set(survey.queries.map((q) => q.query.trim().toLowerCase()));
    expect(curatedIds.size + rejectedIds.size).toBeGreaterThanOrEqual(distinctQueries.size - 1);
  });

  it('registra (non impone) la concordanza fra assessQuery e il giudizio degli esperti', () => {
    // Non è un gate — la soglia "chiedi chiarimento" resta fuori da questo
    // lavoro per decisione esplicita. È il dato per tararla in futuro: quante
    // delle query che gli esperti hanno bocciato come incomplete/senza senso
    // `assessQuery` segnala già oggi come vaghe, a costo zero (nessuna chiamata).
    const rejectedIds = new Set((goldens.rejected as Array<{ id: string }>).map((r) => r.id));
    let flaggedByAssess = 0;
    let flaggedAndRejected = 0;
    for (const q of survey.queries) {
      const evidence = retrievalEvidence([], q.query);
      const vague = assessQuery(q.query, evidence).vague;
      if (vague) flaggedByAssess++;
      if (vague && rejectedIds.has(q.id)) flaggedAndRejected++;
    }
    console.log(
      `\n[rank-eval] concordanza assessQuery/esperti: gli esperti hanno respinto ${rejectedIds.size}/27, ` +
        `assessQuery ne segnala ${flaggedByAssess}/27 (di cui ${flaggedAndRejected} in comune).`,
    );
    expect(flaggedByAssess).toBeGreaterThanOrEqual(0); // registra soltanto, non impone soglie
  }, // Stesso costo (e stesso motivo) del test sopra: retrievalEvidence scora
  // l'indice reale per ognuna delle 27 query.
  20_000);
});
