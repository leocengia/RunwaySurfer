// Dichiarazioni per l'ingestione del sondaggio (JS puro), così il test TS lo
// importa tipato. Stesso schema di docs/recon-kb-analyze.d.mts.

export const DEFAULT_DOCX_PATH: string;
export const BATCH_ID: string;
export const PLACEHOLDER_ALTRO: string;

export function readDocxEntries(buf: Buffer, wantedNames: Iterable<string>): Map<string, string>;

export function extractText(xmlFragment: string): string;
export function parseRelationships(relsXml: string): Map<string, string>;
export function splitSections(documentXml: string): string[];

export interface CheckboxField {
  tag: string;
  alias: string;
  checked: boolean;
}
export function parseCheckboxes(sectionXml: string): CheckboxField[];
export function parseArticleHyperlinkIds(sectionXml: string): string[];

export interface AltroField {
  text: string;
  tagsFound: string[];
  cellsFound: number;
}
export function parseAltroField(sectionXml: string): AltroField;

export function urlIdentity(rawUrl: string): string;

export interface KbIndexRecord {
  u: string;
  s: string;
  l: string;
}
export interface KbIndexFile {
  origin: string;
  count: number;
  articles: KbIndexRecord[];
}
export function indexByIdentity(kbIndex: KbIndexFile): Map<string, KbIndexRecord>;
export function resolveArticleUrl(
  rawUrl: string,
  byIdentity: Map<string, KbIndexRecord>,
  context: string,
): string;

export interface SurveyQuery {
  id: string;
  query: string;
  lang: string;
  note?: string;
}

export interface SectionResultLabelled {
  id: string;
  query: string;
  kind: 'labelled';
  expectedUrls: string[];
  sourceKind: 'checked' | 'altro-url';
  note?: string;
  warnings: string[];
}
export interface SectionResultRejected {
  id: string;
  query: string;
  kind: 'rejected';
  verdict: string;
  warnings: string[];
}
export interface SectionResultUnlabelled {
  id: string;
  query: string;
  kind: 'unlabelled';
  warnings: string[];
}
export type SectionResult = SectionResultLabelled | SectionResultRejected | SectionResultUnlabelled;

export function parseSection(
  sectionXml: string,
  index: number,
  expectedQuery: SurveyQuery,
  rels: Map<string, string>,
  byIdentity: Map<string, KbIndexRecord>,
): SectionResult;

export interface GoldenCurated {
  id: string;
  query: string;
  source: 'curated';
  batch: string;
  expectedUrl?: string;
  expectedUrls?: string[];
  note?: string;
}
export interface GoldenRejected {
  id: string;
  query: string;
  verdict: string;
  source: string;
}
export function buildGoldenEntries(results: SectionResult[]): {
  curated: GoldenCurated[];
  rejected: GoldenRejected[];
};

export function writeGoldens(
  prevDoc: Record<string, unknown>,
  newEntries: { curated: GoldenCurated[]; rejected: GoldenRejected[] },
  batchId?: string,
): Record<string, unknown>;
