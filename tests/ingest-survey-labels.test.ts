// Test dell'ingestione del modulo di etichettatura (docs/ingest-survey-labels.mjs).
//
// XML INLINE, non il .docx reale: la CI non deve dipendere da un binario da
// 60 KB, e i casi limite (URL fuori dal content control, controllo duplicato
// con tag sbagliato, placeholder non compilato, fragment nell'URL) si leggono
// meglio in un frammento di 10 righe che in un file Word. Ogni frammento qui
// sotto riproduce ESATTAMENTE la forma verificata sul documento reale — non è
// una semplificazione, è la stessa struttura con nomi più corti.
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  BATCH_ID,
  PLACEHOLDER_ALTRO,
  buildGoldenEntries,
  indexByIdentity,
  parseAltroField,
  parseArticleHyperlinkIds,
  parseCheckboxes,
  parseSection,
  readDocxEntries,
  resolveArticleUrl,
  splitSections,
  urlIdentity,
  writeGoldens,
  type KbIndexFile,
  type SectionResult,
  type SurveyQuery,
} from '../docs/ingest-survey-labels.mjs';

// --- Costruttori di frammenti XML minimi, fedeli alla forma reale ----------

function candidateParagraphs(tag: string, alias: string, checked: boolean, rId: string): string {
  return (
    `<w:p><w:sdt><w:sdtPr><w:alias w:val="${alias}"/><w:tag w:val="${tag}"/><w:id w:val="1"/>` +
    `<w14:checkbox><w14:checked w14:val="${checked ? '1' : '0'}"/></w14:checkbox></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>?</w:t></w:r></w:sdtContent></w:sdt>` +
    `<w:r><w:t xml:space="preserve">  ${alias}</w:t></w:r></w:p>` +
    `<w:p><w:r><w:t xml:space="preserve">punteggio 10 &#8212;  </w:t></w:r>` +
    `<w:hyperlink r:id="${rId}"><w:r><w:t>Apri articolo</w:t></w:r></w:hyperlink></w:p>`
  );
}

/** Riga ALTRO con N celle dopo l'etichetta (normalmente 1; l'anomalia Q18 ne ha 2). */
function altroRow(cellsXml: string[]): string {
  const tc = (inner: string) => `<w:tc><w:p>${inner}</w:p></w:tc>`;
  return (
    `<w:tbl><w:tr>${tc('<w:r><w:t>ALTRO</w:t></w:r>')}${cellsXml.map((c) => tc(c)).join('')}</w:tr></w:tbl>`
  );
}

/** Content control ALTRO con testo dentro sdtContent (caso normale, Q1-style). */
function altroSdtFilled(tag: string, text: string): string {
  return (
    `<w:sdt><w:sdtPr><w:alias w:val="${tag}"/><w:tag w:val="${tag}"/><w:id w:val="2"/><w:text/></w:sdtPr>` +
    `<w:sdtContent><w:r><w:t>${text}</w:t></w:r></w:sdtContent></w:sdt>`
  );
}

/** Content control ALTRO mai toccato: placeholder letterale dentro sdtContent. */
function altroSdtPlaceholder(tag: string): string {
  return altroSdtFilled(tag, PLACEHOLDER_ALTRO);
}

/** Content control ALTRO con showingPlcHdr + spazi (Q4/Q7/Q8-style: URL scritto fuori). */
function altroSdtShowingPlaceholder(tag: string): string {
  return (
    `<w:sdt><w:sdtPr><w:alias w:val="${tag}"/><w:tag w:val="${tag}"/><w:id w:val="2"/>` +
    `<w:showingPlcHdr/><w:text/></w:sdtPr><w:sdtContent><w:r><w:t xml:space="preserve">     </w:t></w:r></w:sdtContent></w:sdt>`
  );
}

/** Content control ALTRO completamente vuoto (Q27-style: URL scritto fuori). */
function altroSdtEmpty(tag: string): string {
  return `<w:sdt><w:sdtPr><w:alias w:val="${tag}"/><w:tag w:val="${tag}"/><w:id w:val="2"/><w:text/></w:sdtPr><w:sdtContent/></w:sdt>`;
}

/** Un URL incollato come hyperlink reale, testo = URL stesso (non "Apri articolo"). */
function pastedUrlHyperlink(rId: string, url: string): string {
  return `<w:hyperlink r:id="${rId}" w:history="1"><w:r><w:t>${url}</w:t></w:r></w:hyperlink>`;
}

function heading(n: number, text: string): string {
  return `<w:p><w:pPr><w:pStyle w:val="Titolo2"/></w:pPr><w:r><w:t xml:space="preserve">${n}. ${text}</w:t></w:r></w:p>`;
}

function meta(id: string): string {
  return `<w:p><w:r><w:t xml:space="preserve">ID ${id}  &#183;  Lingua: it  &#183;  5 candidati</w:t></w:r></w:p>`;
}

interface SectionSpec {
  n: number;
  id: string;
  query: string;
  candidates?: Array<{ alias: string; checked?: boolean; rId?: string }>;
  altroCellsXml?: string[];
}

/** Assembla una sezione completa (heading, meta, 6 candidati, riga ALTRO). */
function section(spec: SectionSpec): string {
  const nn = String(spec.n).padStart(2, '0');
  const candidates = spec.candidates ?? [];
  const boxesXml = candidates
    .map((c, i) => candidateParagraphs(`Q${nn}_C${i + 1}`, c.alias, c.checked ?? false, c.rId ?? `rId${i + 1}`))
    .join('');
  const altroXml = altroRow(spec.altroCellsXml ?? [altroSdtPlaceholder(`Q${nn}_ALTRO`)]);
  return heading(spec.n, spec.query) + meta(spec.id) + boxesXml + altroXml;
}

function survey(id: string, query: string): SurveyQuery {
  return { id, query, lang: 'it' };
}

/** Completa a 6 candidati (invariante reale: ogni sezione ne ha sempre 6). */
function withSixCandidates(
  first: Array<{ alias: string; checked?: boolean; rId?: string }>,
): Array<{ alias: string; checked?: boolean; rId?: string }> {
  const filler = Array.from({ length: 6 - first.length }, (_, i) => ({ alias: `Riempitivo ${i + 1}` }));
  return [...first, ...filler];
}

// --- Indice KB sintetico -----------------------------------------------------

const INDEX: KbIndexFile = {
  origin: 'https://traveler.my.site.com',
  count: 3,
  articles: [
    {
      u: 'https://traveler.my.site.com/Runway/s/article/Lufthansa-LH-airline-policies-123?language=en_US',
      s: 'Lufthansa-LH-airline-policies-123',
      l: 'Lufthansa LH airline policies 1694551662004',
    },
    {
      u: 'https://traveler.my.site.com/Runway/s/article/Global-schedule-change-E-H?language=en_US',
      s: 'Global-schedule-change-E-H',
      l: 'Global schedule change E H',
    },
    {
      u: 'https://traveler.my.site.com/Runway/s/article/Second-article?language=en_US',
      s: 'Second-article',
      l: 'Second article',
    },
  ],
};
const byIdentity = indexByIdentity(INDEX);
const RELS = new Map([
  ['rId1', 'https://traveler.my.site.com/Runway/s/article/Lufthansa-LH-airline-policies-123?language=en_US'],
  ['rId2', 'https://traveler.my.site.com/Runway/s/article/Second-article?language=en_US'],
]);

// --- splitSections -----------------------------------------------------------

describe('splitSections', () => {
  it('spezza il documento su ogni intestazione Titolo2', () => {
    const doc = section({ n: 1, id: 'a', query: 'prima' }) + section({ n: 2, id: 'b', query: 'seconda' });
    const sections = splitSections(doc);
    expect(sections).toHaveLength(2);
    expect(sections[0]).toContain('1. prima');
    expect(sections[1]).toContain('2. seconda');
  });

  it("esclude l'Appendice tecnica (Titolo1) dall'ultima sezione", () => {
    const appendix = '<w:p><w:pPr><w:pStyle w:val="Titolo1"/></w:pPr><w:r><w:t>Appendice</w:t></w:r></w:p><w:tbl>RUMORE</w:tbl>';
    const doc = section({ n: 1, id: 'a', query: 'unica' }) + appendix;
    const sections = splitSections(doc);
    expect(sections).toHaveLength(1);
    expect(sections[0]).not.toContain('RUMORE');
  });

  it('lancia se non trova nessuna sezione Titolo2', () => {
    expect(() => splitSections('<w:p>niente</w:p>')).toThrow(/nessuna sezione/);
  });
});

// --- parseCheckboxes / parseArticleHyperlinkIds -----------------------------

describe('parseCheckboxes e parseArticleHyperlinkIds', () => {
  it('legge alias e stato nell’ordine documento, accoppiati agli hyperlink', () => {
    const sec = section({
      n: 1,
      id: 'x',
      query: 'q',
      candidates: [
        { alias: 'Primo', checked: false },
        { alias: 'Secondo', checked: true },
      ],
    });
    const boxes = parseCheckboxes(sec);
    expect(boxes).toEqual([
      { tag: 'Q01_C1', alias: 'Primo', checked: false },
      { tag: 'Q01_C2', alias: 'Secondo', checked: true },
    ]);
    expect(parseArticleHyperlinkIds(sec)).toEqual(['rId1', 'rId2']);
  });

  it('ignora gli hyperlink il cui testo non è "Apri articolo" (link incollati in ALTRO)', () => {
    const sec =
      section({ n: 1, id: 'x', query: 'q', candidates: [{ alias: 'Primo' }] }) +
      pastedUrlHyperlink('rId9', 'https://esempio.test/altro');
    expect(parseArticleHyperlinkIds(sec)).toEqual(['rId1']);
  });
});

// --- parseAltroField: i casi limite del documento reale ---------------------

describe('parseAltroField', () => {
  it('legge il testo dentro sdtContent quando il campo è compilato lì (caso normale)', () => {
    const sec = altroRow([altroSdtFilled('Q01_ALTRO', 'https://esempio.test/risposta')]);
    expect(parseAltroField(sec)).toEqual({
      text: 'https://esempio.test/risposta',
      tagsFound: ['Q01_ALTRO'],
      cellsFound: 2,
    });
  });

  it('tratta il placeholder letterale non compilato come vuoto', () => {
    const sec = altroRow([altroSdtPlaceholder('Q01_ALTRO')]);
    expect(parseAltroField(sec).text).toBe('');
  });

  it('legge il testo scritto ACCANTO al controllo quando questo mostra showingPlcHdr (Q4/Q7/Q8-style)', () => {
    const sec = altroRow([
      `${pastedUrlHyperlink('rId9', 'https://esempio.test/fuori')}${altroSdtShowingPlaceholder('Q01_ALTRO')}`,
    ]);
    expect(parseAltroField(sec).text).toBe('https://esempio.test/fuori');
  });

  it('legge il testo scritto accanto a un controllo completamente vuoto (Q27-style)', () => {
    const sec = altroRow([`${pastedUrlHyperlink('rId9', 'https://esempio.test/fuori27')}${altroSdtEmpty('Q01_ALTRO')}`]);
    expect(parseAltroField(sec).text).toBe('https://esempio.test/fuori27');
  });

  it("legge la risposta da una SECONDA cella con tag sbagliato (anomalia Q18: controllo incollato da un'altra domanda)", () => {
    const sec = altroRow([
      altroSdtFilled('Q16_ALTRO', 'La domanda non ha senso'), // tag di UN'ALTRA sezione, incollato per errore
      altroSdtPlaceholder('Q18_ALTRO'), // il controllo giusto, mai toccato
    ]);
    const result = parseAltroField(sec);
    expect(result.text).toBe('La domanda non ha senso');
    expect(result.tagsFound).toEqual(['Q16_ALTRO', 'Q18_ALTRO']);
  });

  it('lancia se le celle ALTRO contengono due risposte diverse (ambiguo)', () => {
    const sec = altroRow([altroSdtFilled('Q01_ALTRO', 'risposta A'), altroSdtFilled('Q02_ALTRO', 'risposta B')]);
    expect(() => parseAltroField(sec)).toThrow(/più risposte ALTRO diverse/);
  });

  it('lancia se la prima cella della riga non è "ALTRO" (struttura tabella inattesa)', () => {
    const badRow = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>NON ALTRO</w:t></w:r></w:p></w:tc><w:tc><w:p/></w:tc></w:tr></w:tbl>';
    expect(() => parseAltroField(badRow)).toThrow(/riga inattesa/);
  });

  it('ritorna vuoto se la sezione non contiene alcuna tabella', () => {
    expect(parseAltroField('<w:p>nessuna tabella qui</w:p>')).toEqual({ text: '', tagsFound: [], cellsFound: 0 });
  });
});

// --- urlIdentity / resolveArticleUrl: il fragment e la lingua --------------

describe('urlIdentity', () => {
  /**
   * Duplica DELIBERATAMENTE identity() di tests/rank-eval.test.ts: questo test
   * verifica che le due restino allineate, invece di condividere un modulo per
   * 5 righe fra docs/ e tests/.
   */
  function harnessIdentity(url: string): string {
    try {
      const u = new URL(url);
      return `${u.origin}${u.pathname}`.toLowerCase().replace(/\/+$/, '');
    } catch {
      return url.trim().toLowerCase();
    }
  }

  it.each([
    'https://traveler.my.site.com/Runway/s/article/Global-airline-schedule-change-policies-E-H?language=en_US#EK',
    'https://traveler.my.site.com/Runway/s/article/Lufthansa-LH-airline-policies-123?language=en_US',
    'https://TRAVELER.my.site.com/Runway/s/article/Foo/',
    'non-e-un-url',
  ])('combacia con identity() del test harness su %s', (url) => {
    expect(urlIdentity(url)).toBe(harnessIdentity(url));
  });

  it('ignora il fragment: la sezione EK dentro un articolo-intervallo risolve allo stesso URL', () => {
    const withFragment =
      'https://traveler.my.site.com/Runway/s/article/Global-schedule-change-E-H?language=en_US#EK';
    expect(resolveArticleUrl(withFragment, byIdentity, 'test')).toBe(
      'https://traveler.my.site.com/Runway/s/article/Global-schedule-change-E-H?language=en_US',
    );
  });

  it("lancia quando l'URL non combacia con nessun articolo dell'indice", () => {
    expect(() => resolveArticleUrl('https://esempio.test/non-esiste', byIdentity, 'contesto-x')).toThrow(
      /contesto-x.*non-esiste/s,
    );
  });
});

// --- parseSection: end-to-end su una sezione sintetica ----------------------

describe('parseSection', () => {
  const q = survey('t1', 'domanda di prova');

  it('classifica come "checked" quando almeno una casella è spuntata, risolvendo il suo hyperlink', () => {
    const sec = section({
      n: 1,
      id: 't1',
      query: 'domanda di prova',
      candidates: withSixCandidates([{ alias: 'Lufthansa LH airline policies', checked: true, rId: 'rId1' }]),
    });
    const r = parseSection(sec, 0, q, RELS, byIdentity) as Extract<SectionResult, { kind: 'labelled' }>;
    expect(r.kind).toBe('labelled');
    expect(r.sourceKind).toBe('checked');
    expect(r.expectedUrls).toEqual([
      'https://traveler.my.site.com/Runway/s/article/Lufthansa-LH-airline-policies-123?language=en_US',
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('raccoglie PIÙ URL quando più caselle sono spuntate (richiesta di elenco esaustivo)', () => {
    const sec = section({
      n: 1,
      id: 't1',
      query: 'domanda di prova',
      candidates: withSixCandidates([
        { alias: 'Lufthansa LH airline policies', checked: true, rId: 'rId1' },
        { alias: 'Second article', checked: true, rId: 'rId2' },
      ]),
    });
    const r = parseSection(sec, 0, q, RELS, byIdentity) as Extract<SectionResult, { kind: 'labelled' }>;
    expect(r.expectedUrls).toHaveLength(2);
  });

  it('classifica come "labelled/altro-url" quando ALTRO contiene un URL e nulla è spuntato', () => {
    const sec = section({
      n: 1,
      id: 't1',
      query: 'domanda di prova',
      candidates: withSixCandidates([{ alias: 'Second article', checked: false, rId: 'rId2' }]),
      altroCellsXml: [
        altroSdtFilled('Q01_ALTRO', 'https://traveler.my.site.com/Runway/s/article/Lufthansa-LH-airline-policies-123?language=en_US'),
      ],
    });
    const r = parseSection(sec, 0, q, RELS, byIdentity) as Extract<SectionResult, { kind: 'labelled' }>;
    expect(r.sourceKind).toBe('altro-url');
    expect(r.expectedUrls[0]).toContain('Lufthansa-LH-airline-policies-123');
  });

  it('segnala nella nota quando ALTRO contiene un fragment (risposta = sezione di un articolo)', () => {
    const sec = section({
      n: 1,
      id: 't1',
      query: 'domanda di prova',
      candidates: withSixCandidates([{ alias: 'Second article', checked: false, rId: 'rId2' }]),
      altroCellsXml: [altroSdtFilled('Q01_ALTRO', 'https://traveler.my.site.com/Runway/s/article/Global-schedule-change-E-H?language=en_US#EK')],
    });
    const r = parseSection(sec, 0, q, RELS, byIdentity) as Extract<SectionResult, { kind: 'labelled' }>;
    expect(r.note).toMatch(/#EK/);
    expect(r.expectedUrls[0]).not.toContain('#');
  });

  it('classifica come "rejected" quando ALTRO contiene un giudizio invece di un URL', () => {
    const sec = section({
      n: 1,
      id: 't1',
      query: 'domanda di prova',
      candidates: withSixCandidates([{ alias: 'Second article', checked: false, rId: 'rId2' }]),
      altroCellsXml: [altroSdtFilled('Q01_ALTRO', 'Domanda senza senso')],
    });
    const r = parseSection(sec, 0, q, RELS, byIdentity);
    expect(r.kind).toBe('rejected');
    expect((r as Extract<SectionResult, { kind: 'rejected' }>).verdict).toBe('Domanda senza senso');
  });

  it('classifica come "unlabelled" quando non c’è né spunta né ALTRO compilato', () => {
    const sec = section({
      n: 1,
      id: 't1',
      query: 'domanda di prova',
      candidates: withSixCandidates([{ alias: 'Second article', checked: false, rId: 'rId2' }]),
    });
    expect(parseSection(sec, 0, q, RELS, byIdentity).kind).toBe('unlabelled');
  });

  it("lancia se il testo della domanda nel .docx non combacia col fixture", () => {
    const sec = section({ n: 1, id: 't1', query: 'domanda DIVERSA', candidates: [] }) + altroRow([altroSdtPlaceholder('Q01_ALTRO')]);
    expect(() => parseSection(sec, 0, q, RELS, byIdentity)).toThrow(/non combacia/);
  });

  it("lancia se l'ID nel .docx non combacia col fixture", () => {
    const badMeta = heading(1, 'domanda di prova') + meta('id-sbagliato') + altroRow([altroSdtPlaceholder('Q01_ALTRO')]);
    expect(() => parseSection(badMeta, 0, q, RELS, byIdentity)).toThrow(/ID non trovato/);
  });

  it('lancia se il numero di checkbox e hyperlink "Apri articolo" non combacia (6 attesi)', () => {
    const sec = section({ n: 1, id: 't1', query: 'domanda di prova', candidates: [{ alias: 'Second article' }] });
    // Va bene con 0 candidati richiesti dal test (survey.query non impone 6): qui
    // verifichiamo solo che un conteggio SPAIATO fra checkbox e hyperlink lanci.
    const spaiato = section({ n: 1, id: 't1', query: 'domanda di prova', candidates: [] }) +
      '<w:p><w:sdt><w:sdtPr><w:alias w:val="X"/><w:tag w:val="Q01_C1"/><w:id w:val="9"/><w14:checkbox><w14:checked w14:val="0"/></w14:checkbox></w:sdtPr><w:sdtContent/></w:sdt></w:p>' +
      altroRow([altroSdtPlaceholder('Q01_ALTRO')]);
    expect(() => parseSection(spaiato, 0, q, RELS, byIdentity)).toThrow(/6 checkbox/);
    void sec;
  });

  it('segnala (senza lanciare) quando l’alias della spunta non combacia con la label risolta', () => {
    const sec = section({
      n: 1,
      id: 't1',
      query: 'domanda di prova',
      candidates: withSixCandidates([{ alias: 'Titolo scritto male', checked: true, rId: 'rId1' }]),
    });
    const r = parseSection(sec, 0, q, RELS, byIdentity);
    expect(r.warnings.some((w) => w.includes('alias della spunta'))).toBe(true);
  });

  it("segnala (senza lanciare) quando la cella ALTRO ha un tag interno diverso da quello della sezione", () => {
    const sec = section({
      n: 18,
      id: 't1',
      query: 'domanda di prova',
      candidates: withSixCandidates([{ alias: 'Second article', checked: false, rId: 'rId2' }]),
      altroCellsXml: [altroSdtFilled('Q16_ALTRO', 'verdetto vero'), altroSdtPlaceholder('Q18_ALTRO')],
    });
    const r = parseSection(sec, 0, survey('t1', 'domanda di prova'), RELS, byIdentity);
    expect(r.kind).toBe('rejected');
    expect(r.warnings.some((w) => w.includes('tag inatteso'))).toBe(true);
  });
});

// --- buildGoldenEntries: dedup delle domande duplicate nel sondaggio -------

describe('buildGoldenEntries', () => {
  it('fa il dedup di due sezioni con stessa query e stesso URL atteso (r9-h/r9-i)', () => {
    const results: SectionResult[] = [
      { id: 'r9-h', query: 'EU package bookings', kind: 'labelled', expectedUrls: ['https://x/a'], sourceKind: 'checked', warnings: [] },
      { id: 'r9-i', query: 'EU package bookings', kind: 'labelled', expectedUrls: ['https://x/a'], sourceKind: 'checked', warnings: [] },
    ];
    const { curated } = buildGoldenEntries(results);
    expect(curated).toHaveLength(1);
    expect(curated[0].id).toBe('r9-h');
    expect(curated[0].note).toMatch(/r9-h, r9-i/);
  });

  it('NON fa il dedup di due sezioni con la stessa query ma risposte diverse', () => {
    const results: SectionResult[] = [
      { id: 'a', query: 'stessa domanda', kind: 'labelled', expectedUrls: ['https://x/a'], sourceKind: 'checked', warnings: [] },
      { id: 'b', query: 'stessa domanda', kind: 'labelled', expectedUrls: ['https://x/b'], sourceKind: 'checked', warnings: [] },
    ];
    expect(buildGoldenEntries(results).curated).toHaveLength(2);
  });

  it('separa i "rejected" dai "labelled" e riporta il verdetto verbatim', () => {
    const results: SectionResult[] = [
      { id: 'a', query: 'q', kind: 'rejected', verdict: 'non ha senso', warnings: [] },
    ];
    const { curated, rejected } = buildGoldenEntries(results);
    expect(curated).toEqual([]);
    expect(rejected).toEqual([{ id: 'a', query: 'q', verdict: 'non ha senso', source: BATCH_ID }]);
  });

  it('un singolo URL atteso usa expectedUrl (stringa), più di uno usa expectedUrls (array)', () => {
    const one: SectionResult[] = [
      { id: 'a', query: 'q1', kind: 'labelled', expectedUrls: ['https://x/a'], sourceKind: 'checked', warnings: [] },
    ];
    const many: SectionResult[] = [
      { id: 'b', query: 'q2', kind: 'labelled', expectedUrls: ['https://x/a', 'https://x/b'], sourceKind: 'checked', warnings: [] },
    ];
    expect(buildGoldenEntries(one).curated[0]).toHaveProperty('expectedUrl', 'https://x/a');
    expect(buildGoldenEntries(one).curated[0]).not.toHaveProperty('expectedUrls');
    expect(buildGoldenEntries(many).curated[0]).toHaveProperty('expectedUrls', ['https://x/a', 'https://x/b']);
    expect(buildGoldenEntries(many).curated[0]).not.toHaveProperty('expectedUrl');
  });
});

// --- writeGoldens: possiede solo il proprio batch, è idempotente -----------

describe('writeGoldens', () => {
  const prevDoc = {
    schema: 'rs-rank-goldens/2',
    note: 'nota originale',
    curated: [{ query: 'a mano', expectedUrl: 'https://x/mano', source: 'curated' }],
    bootstrap: [{ query: 'boot', expectedUrl: 'https://x/boot', source: 'bootstrap' }],
  };
  const entries = {
    curated: [{ id: 'r1', query: 'nuova', source: 'curated' as const, batch: BATCH_ID, expectedUrl: 'https://x/nuova' }],
    rejected: [{ id: 'r2', query: 'respinta', verdict: 'v', source: BATCH_ID }],
  };

  it('preserva le entry curated e bootstrap che non appartengono al proprio batch', () => {
    const doc = writeGoldens(prevDoc, entries);
    expect(doc.curated).toContainEqual(prevDoc.curated[0]);
    expect(doc.bootstrap).toEqual(prevDoc.bootstrap);
  });

  it('aggiunge le nuove entry del batch', () => {
    const doc = writeGoldens(prevDoc, entries);
    expect(doc.curated).toContainEqual(entries.curated[0]);
    expect(doc.rejected).toEqual(entries.rejected);
  });

  it("è idempotente: rialimentare il proprio output con GLI STESSI entries produce lo stesso documento", () => {
    const once = writeGoldens(prevDoc, entries);
    const twice = writeGoldens(once, entries);
    expect(twice).toEqual(once);
  });

  it('una seconda ingestione con un batch DIVERSO non tocca il primo', () => {
    const withFirst = writeGoldens(prevDoc, entries);
    const otherEntries = {
      curated: [{ id: 'z1', query: 'altro batch', source: 'curated' as const, batch: 'survey-2027-01', expectedUrl: 'https://x/z' }],
      rejected: [],
    };
    const withBoth = writeGoldens(withFirst, otherEntries, 'survey-2027-01');
    expect(withBoth.curated).toContainEqual(entries.curated[0]);
    expect(withBoth.curated).toContainEqual(otherEntries.curated[0]);
  });
});

// --- readDocxEntries: lo zip fatto in casa, su un buffer costruito a mano --

function buildMinimalZip(files: Array<{ name: string; content: string; store?: boolean }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');
    const raw = Buffer.from(f.content, 'utf8');
    const compressed = f.store ? raw : deflateRawSync(raw);
    const method = f.store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags: niente data descriptor
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0, 12); // mod date
    local.writeUInt32LE(0, 14); // crc32 (non verificato dal reader)
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    const localEntry = Buffer.concat([local, nameBuf, compressed]);
    localParts.push(localEntry);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(CDIR_SIG, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(0, 16); // crc32
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra length
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42); // local header offset
    centralParts.push(Buffer.concat([central, nameBuf]));

    offset += localEntry.length;
  }

  const localBuf = Buffer.concat(localParts);
  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16); // offset della central directory
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localBuf, centralBuf, eocd]);
}

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

describe('readDocxEntries', () => {
  it('estrae entry deflate e stored dallo stesso archivio, per nome esatto', () => {
    const zip = buildMinimalZip([
      { name: 'word/document.xml', content: '<w:document>ciao</w:document>' },
      { name: 'word/_rels/document.xml.rels', content: '<Relationships/>', store: true },
      { name: 'ignorato.xml', content: 'non richiesto' },
    ]);
    const entries = readDocxEntries(zip, ['word/document.xml', 'word/_rels/document.xml.rels']);
    expect(entries.get('word/document.xml')).toBe('<w:document>ciao</w:document>');
    expect(entries.get('word/_rels/document.xml.rels')).toBe('<Relationships/>');
    expect(entries.has('ignorato.xml')).toBe(false);
  });

  it("lancia se un'entry richiesta non esiste nell'archivio", () => {
    const zip = buildMinimalZip([{ name: 'word/document.xml', content: 'x' }]);
    expect(() => readDocxEntries(zip, ['word/document.xml', 'word/mancante.xml'])).toThrow(/mancante/);
  });

  it('lancia su un buffer che non è uno zip valido', () => {
    expect(() => readDocxEntries(Buffer.from('non uno zip'), ['x'])).toThrow(/EOCD non trovato/);
  });
});
