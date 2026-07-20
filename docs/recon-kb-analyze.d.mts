// Dichiarazioni per l'analizzatore (JS puro), così i test TS lo importano tipato.
export const SCHEMA: string;
export const THRESHOLDS: Record<string, number | boolean>;

export interface AnalyzeRow {
  n: number;
  assumption: string;
  check: string;
  world: string;
  measured: string;
  verdict: 'PASS' | 'FAIL' | 'PENDING';
  action: string;
}
export interface AnalyzeResult {
  probeVersion?: string;
  preflight?: unknown;
  rows: AnalyzeRow[];
  verdict: string;
}
export interface DiffResult {
  verdictBefore: string;
  verdictAfter: string;
  flips: Array<{ n: number; assumption: string; from: string; to: string }>;
  timingDelta: Record<string, { from: number | null; to: number | null }>;
}

export function analyze(run: unknown): AnalyzeResult;
export function formatTable(res: AnalyzeResult): string;
export function diff(before: unknown, after: unknown): DiffResult;
