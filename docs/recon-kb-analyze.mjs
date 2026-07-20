/*
 * RunwaySurfer — Analizzatore dei JSON di recon-kb-verify.js
 * ==========================================================
 *
 * Trasforma l'output del probe (schema rs-verify/1) nella tabella verdetto del
 * piano (assunzione → check → PASS/FAIL → azione), con valore misurato vs soglia.
 * Le soglie vivono in THRESHOLDS (i numeri del piano diventano eseguibili).
 *
 * USO
 *   node docs/recon-kb-analyze.mjs run.json              # tabella verdetto
 *   node docs/recon-kb-analyze.mjs before.json after.json # diff fra due run
 *
 * Esportato (analyze/diff/formatTable) per i test in tests/recon-analyze.test.ts.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import process from 'node:process';

export const SCHEMA = 'rs-verify/1';

export const THRESHOLDS = {
  redirectCountMax: 0,
  winnerMustBeSalesforceSpecific: true, // else WARN (role=main che vince = root troppo largo)
  noiseDeltaPctMin: 15,
  noisePostLenMin: 900,
  fetchTextualInShellMax: 0, // selettori "testuali" generici nel raw HTML = hasRenderedContent rotto
  renderMsMax: 5000,
  ldsMinKa0: 1,
};

const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

/** Righe della tabella centrale del piano. Ogni riga: verdetto da una/più check. */
function rows(run) {
  const c = run.checks || {};
  const navOff = !(run.meta && run.meta.nav);
  const navRan = !navOff && Array.isArray(get(c, 'C7.results'));
  // navOff = RS_VERIFY_NAV non attivo; !navRan con NAV attivo = C7 skippato (nessun target).
  const navPendingMsg = navOff
    ? 'PENDING (RS_VERIFY_NAV=false)'
    : 'PENDING (C7 skippato: nessun target)';
  const r = [];
  const push = (n, assumption, check, world, measured, pass, action) =>
    r.push({
      n,
      assumption,
      check,
      world,
      measured,
      verdict: pass === null ? 'PENDING' : pass ? 'PASS' : 'FAIL',
      action,
    });

  // 1 — origin
  {
    const ok =
      get(c, 'C1.match') === true &&
      (get(c, 'C1.redirectCount') || 0) <= THRESHOLDS.redirectCountMax;
    push(
      1,
      'origin = traveler',
      'C1',
      'either',
      `${get(c, 'C1.origin')} redir=${get(c, 'C1.redirectCount')}`,
      get(c, 'C1.match') == null ? null : ok,
      'aggiorna matches/host_permissions',
    );
  }
  // 2 — content selector winner
  {
    const sf = get(c, 'C2.winnerIsSalesforceSpecific');
    push(
      2,
      '[role=main]/selettore = body',
      'C2',
      'either',
      `winner=${get(c, 'C2.winner')} len=${get(c, 'C2.winnerLen')}`,
      sf == null ? null : sf === THRESHOLDS.winnerMustBeSalesforceSpecific,
      'riordina contentSelectors (WARN se vince role=main)',
    );
  }
  // 3 — noise delta
  {
    const d = get(c, 'C3.deltaPct');
    const after = get(c, 'C3.lenAfter');
    const ok =
      typeof d === 'number' &&
      d >= THRESHOLDS.noiseDeltaPctMin &&
      after >= THRESHOLDS.noisePostLenMin;
    push(
      3,
      'noiseSelectors giusti',
      'C3',
      'either',
      `delta=${d}% post=${after}`,
      d == null ? null : ok,
      'allinea noiseSelectors al set recon',
    );
  }
  // 4 — fetch = shell
  {
    const t = get(c, 'C5.textualMatchedInShell');
    const ok = Array.isArray(t) && t.length <= THRESHOLDS.fetchTextualInShellMax;
    push(
      4,
      'fetch = shell (hasRenderedContent)',
      'C5',
      'either',
      `textualInShell=${Array.isArray(t) ? t.join(',') || 'nessuno' : '?'} followDead=${get(c, 'C5.followDeadConfirmed')}`,
      t == null ? null : ok,
      'split marker vs root o min-len in extract.ts',
    );
  }
  // 5 — E2 heading (offline fixture)
  push(
    5,
    'E2 per-heading vive',
    'fixture',
    'either',
    'verificare offline su fixture (focusedByHeading≠null)',
    null,
    'discendi nel body annidato (Details__c/.cuf-content)',
  );
  // 6 — render timing
  {
    const w = navRan
      ? (get(c, 'C7.results') || []).find((x) => x.outcome === 'intercepted-spa')
      : null;
    if (!navRan)
      push(
        6,
        'render<timeout, testo=finito',
        'C6/C7',
        'either',
        navPendingMsg,
        null,
        'ritara spa-nav + guard stale-text',
      );
    else if (!w)
      push(
        6,
        'render<timeout, testo=finito',
        'C6/C7',
        'either',
        'nessuna nav intercettata',
        false,
        'ritara spa-nav + guard stale-text',
      );
    else {
      const ok =
        w.renderMs != null &&
        w.renderMs <= THRESHOLDS.renderMsMax &&
        w.oldPersistedAfterUrl !== true;
      push(
        6,
        'render<timeout, testo=finito',
        'C6/C7',
        'either',
        `renderMs=${w.renderMs} stale=${w.oldPersistedAfterUrl ?? 'n/a'}`,
        ok,
        'ritara spa-nav + guard stale-text',
      );
    }
  }
  // 7 — anchor intercettato
  {
    if (!navRan)
      push(
        7,
        'anchor sintetico intercettato',
        'C7',
        'either/main',
        navPendingMsg,
        null,
        'matrice fallback B2 (iframe→$A→getRecord)',
      );
    else {
      const rec = get(c, 'C7.recommendedMechanism');
      push(
        7,
        'anchor sintetico intercettato',
        'C7',
        'either/main',
        get(c, 'C7.verdict'),
        !!rec,
        rec ? 'usa il meccanismo trovato' : 'matrice fallback B2 (iframe→$A→getRecord)',
      );
    }
  }
  // 8 — collegati anchor
  {
    const sug = get(c, 'C8.suggestedAnchorCount');
    const anchors = get(c, 'C8.anchorCountInMain');
    const ok = (sug != null ? sug > 0 : false) || (anchors != null && anchors > 0);
    push(
      8,
      'collegati = <a href>',
      'C8',
      'either',
      `mainAnchors=${anchors} suggested=${sug} nonAnchor=${get(c, 'C8.nonAnchorClickable')}`,
      anchors == null ? null : ok,
      'tour su link reali; documenta limite Suggested',
    );
  }
  // 9 — sessione valida
  {
    const v = get(c, 'C4.verdict');
    push(
      9,
      'sessione valida',
      'C4',
      'either',
      `verdict=${v}`,
      v == null ? null : v === 'ok',
      'guardia login-wall/not-found in extract.ts',
    );
  }
  // 10 — $A/getRecord
  {
    const a = get(c, 'C10.status');
    const st = get(c, 'C15.auraState');
    const c15 = get(c, 'C15');
    let pass10;
    if (a == null) pass10 = null;
    else if (a !== 'present') pass10 = false;
    // getRecord NON eseguito (C15 assente o skippato) → PENDING; se ha girato,
    // uno stato ≠ SUCCESS (incluso null da parse fallito) è FAIL, non PENDING.
    else if (c15 == null || c15.status === 'skipped') pass10 = null;
    else pass10 = st === 'SUCCESS';
    push(
      10,
      '$A/getRecord usabili (MAIN)',
      'C10/C15',
      'main',
      `$A=${a} getRecord=${st ?? 'n/a'}`,
      pass10,
      'bridge MAIN-world o via v2',
    );
  }
  // 11 — slug→recordId senza nav
  {
    const cnt = get(c, 'C12.ka0KeyCount');
    const plain = get(c, 'C12.valuesPlaintext');
    const ok = typeof cnt === 'number' && cnt >= THRESHOLDS.ldsMinKa0 && plain === true;
    push(
      11,
      'slug→recordId senza nav',
      'C12/C13',
      'either/main',
      `ka0=${cnt} plaintext=${plain}`,
      cnt == null ? null : ok,
      'se cifrato/assente: resta navigate-then-fetch',
    );
  }
  // 12 — token baseline (backend)
  push(
    12,
    'token E2/E4',
    'baseline SQL',
    'backend',
    'misura via requests table (kb-baseline-A/B)',
    null,
    'ritara soglie router',
  );
  return r;
}

export function analyze(run) {
  if (!run || run.schema !== SCHEMA)
    throw new Error(`schema atteso "${SCHEMA}", trovato "${run && run.schema}"`);
  const table = rows(run);
  const applicable = table.filter((x) => x.verdict !== 'PENDING');
  const pass = applicable.filter((x) => x.verdict === 'PASS').length;
  return {
    probeVersion: run.probeVersion,
    preflight: run.preflight,
    rows: table,
    verdict:
      applicable.length === 0
        ? `— (${table.length} PENDING)`
        : `${pass}/${applicable.length} PASS` +
          (applicable.length < table.length
            ? ` (${table.length - applicable.length} PENDING)`
            : ''),
  };
}

export function formatTable(res) {
  const lines = [];
  lines.push(`# RS-VERIFY — probe ${res.probeVersion || '?'} — VERDICT: ${res.verdict}`);
  if (res.preflight) lines.push(`preflight: ${res.preflight.pass ? 'PASS' : 'FAIL'}`);
  lines.push('');
  lines.push('| # | Assunzione | Check | World | Misurato | Verdetto | Azione se FAIL |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const r of res.rows) {
    lines.push(
      `| ${r.n} | ${r.assumption} | ${r.check} | ${r.world} | ${r.measured} | ${r.verdict} | ${r.action} |`,
    );
  }
  return lines.join('\n');
}

export function diff(before, after) {
  const a = analyze(before);
  const b = analyze(after);
  const flips = [];
  for (let i = 0; i < a.rows.length; i++) {
    if (a.rows[i].verdict !== b.rows[i].verdict) {
      flips.push({
        n: a.rows[i].n,
        assumption: a.rows[i].assumption,
        from: a.rows[i].verdict,
        to: b.rows[i].verdict,
      });
    }
  }
  const timingDelta = {};
  const bt = before.timingsMs || {};
  const at = after.timingsMs || {};
  for (const k of new Set([...Object.keys(bt), ...Object.keys(at)])) {
    if (bt[k] !== at[k]) timingDelta[k] = { from: bt[k] ?? null, to: at[k] ?? null };
  }
  return { verdictBefore: a.verdict, verdictAfter: b.verdict, flips, timingDelta };
}

function formatDiff(d) {
  const lines = [`# RS-VERIFY diff — ${d.verdictBefore} → ${d.verdictAfter}`, ''];
  if (!d.flips.length) lines.push('Nessun verdetto cambiato.');
  else {
    lines.push('| # | Assunzione | Prima | Dopo |', '|---|---|---|---|');
    for (const f of d.flips) lines.push(`| ${f.n} | ${f.assumption} | ${f.from} | ${f.to} |`);
  }
  const tk = Object.keys(d.timingDelta);
  if (tk.length) {
    lines.push('', '## Timing (ms) cambiati');
    for (const k of tk) lines.push(`- ${k}: ${d.timingDelta[k].from} → ${d.timingDelta[k].to}`);
  }
  return lines.join('\n');
}

// --- CLI -------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const load = (p) => JSON.parse(readFileSync(p, 'utf8'));
  try {
    if (args.length === 1) {
      console.log(formatTable(analyze(load(args[0]))));
    } else if (args.length === 2) {
      console.log(formatDiff(diff(load(args[0]), load(args[1]))));
    } else {
      console.error('Uso: node docs/recon-kb-analyze.mjs run.json [after.json]');
      process.exit(2);
    }
  } catch (e) {
    console.error('Errore:', e.message);
    process.exit(1);
  }
}
