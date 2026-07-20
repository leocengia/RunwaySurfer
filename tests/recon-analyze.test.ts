import { describe, expect, it } from 'vitest';
import { analyze, diff, formatTable } from '../docs/recon-kb-analyze.mjs';
import sample from './fixtures/rs-verify-sample.json';

// Il JSON committato congela lo schema rs-verify/1: se il probe cambia forma, o
// l'analizzatore cambia soglie, questi verdetti si spostano e il test lo segnala.
const clone = () => JSON.parse(JSON.stringify(sample));

describe('recon-kb-analyze', () => {
  it('rifiuta input con schema diverso', () => {
    expect(() => analyze({ schema: 'altro' })).toThrow(/schema atteso/);
  });

  it('produce il verdetto atteso sul sample (mix PASS/FAIL/PENDING)', () => {
    const res = analyze(sample);
    expect(res.verdict).toBe('6/7 PASS (5 PENDING)');
    const byN = Object.fromEntries(res.rows.map((r) => [r.n, r.verdict]));
    expect(byN[1]).toBe('PASS'); // origin
    expect(byN[2]).toBe('FAIL'); // vince [role=main], non un selettore Salesforce-specifico
    expect(byN[5]).toBe('PENDING'); // E2 verificabile solo offline via fixture
    expect(byN[6]).toBe('PENDING'); // richiede RS_VERIFY_NAV
    expect(byN[10]).toBe('PENDING'); // $A presente ma getRecord non eseguito
    expect(byN[11]).toBe('PASS'); // ka0 in LDS plaintext
  });

  it('formatTable emette una riga per assunzione + il verdetto', () => {
    const md = formatTable(analyze(sample));
    expect(md).toContain('VERDICT: 6/7 PASS');
    expect(md.split('\n').filter((l) => l.startsWith('| ')).length).toBeGreaterThanOrEqual(12);
  });

  it('diff segnala il flip quando il selettore Salesforce vince (fix riga 2)', () => {
    const after = clone();
    after.checks.C2.winnerIsSalesforceSpecific = true;
    const d = diff(sample, after);
    expect(d.flips).toHaveLength(1);
    expect(d.flips[0].n).toBe(2);
    expect(d.flips[0].to).toBe('PASS');
    expect(d.verdictAfter).toBe('7/7 PASS (5 PENDING)');
  });
});
