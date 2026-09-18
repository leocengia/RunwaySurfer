/*
 * RunwaySurfer — ingestione delle etichette del sondaggio agenti (prep Fase 6)
 * ================================================================================
 *
 * Legge il modulo Word compilato dagli esperti KB — un .docx generato FUORI dal
 * repo (python-docx) a partire da docs/EVAL-DA-ETICHETTARE.md — e scrive le
 * risposte in tests/fixtures/rank-goldens.json: le domande con una risposta
 * (spuntata o scritta in ALTRO) diventano `curated`, quelle che gli esperti hanno
 * dichiarato incomplete o senza senso diventano `rejected`. Chiude l'anello
 * descritto in docs/survey-agenti-2026-08.md: da lì in poi tests/rank-eval.test.ts
 * misura il prefiltro locale sulle domande VERE, non solo sui 3 casi a mano.
 *
 * PERCHÉ UNO UNZIP FATTO IN CASA. Un .docx è uno zip OOXML: bastano la central
 * directory e `zlib.inflateRawSync` (~40 righe), verificato che tutte le entry di
 * questo file sono deflate senza data descriptor (flag=0x6, bit 0x8 assente).
 * Una dipendenza (`jszip`/`adm-zip`) non aggiungerebbe nulla che non sia già qui;
 * `mammoth` sarebbe PEGGIO del nulla — scarta i content control, che sono
 * esattamente il dato che serve.
 *
 * IL CONTRATTO CHE QUESTO SCRIPT SI ASPETTA DAL MODULO (per chi ne genererà un
 * altro): una sezione per domanda, paragrafo in stile "Titolo2" che comincia con
 * "<N>. <testo della domanda>" (N = 1..27, testo verbatim identico a
 * tests/fixtures/survey-queries-2026-08.json); subito dopo un paragrafo con
 * "ID <id> · Lingua: .. · N candidati"; 6 checkbox `<w:sdt>` con
 * `<w:tag w:val="Q<NN>_C<n>"/>` (n = 1..6), `<w:alias>` = titolo dell'articolo,
 * `<w14:checkbox>` per lo stato; subito dopo OGNI checkbox un hyperlink "Apri
 * articolo" verso l'URL — l'ordine dei 6 hyperlink deve combaciare con l'ordine
 * delle 6 checkbox; una riga ALTRO (in tabella) con l'etichetta "ALTRO" in una
 * cella e la risposta nella cella successiva.
 *
 * PERCHÉ SI LEGGE LA CELLA E NON IL CONTENT CONTROL. Verificato sul documento
 * reale: 7 esperti su 13 hanno scritto l'URL ACCANTO al controllo invece che
 * dentro (il controllo resta vuoto, `<w:showingPlcHdr/>` o `<w:sdtContent/>`), e
 * uno ha incollato un controllo INTERO da un'altra domanda (tag sbagliato). Un
 * parser che si fidasse solo di `sdtContent` perderebbe più della metà delle
 * mancate — il dato più prezioso del documento. Regola unica: il valore di ALTRO
 * è il TESTO DELL'INTERA CELLA dopo l'etichetta "ALTRO", ripulito del placeholder
 * letterale non compilato. Il tag del content control resta un controllo di
 * coerenza (stampato come avviso se non combacia), mai la fonte del dato.
 *
 * Rieseguibile e IDEMPOTENTE: due esecuzioni di fila non devono produrre un
 * secondo diff (`node docs/ingest-survey-labels.mjs && git diff --exit-code`
 * deve tacere) — è la sola prova che il parser non stia interpretando. Possiede
 * SOLO le entry di `curated`/`rejected` col proprio `batch`; preserva ogni altra
 * entry di `curated` (i casi editati a mano) e tutto il resto del documento
 * (`bootstrap` è di competenza di docs/build-rank-goldens.mjs).
 *
 * USO (Node, dalla root del repo):
 *   node docs/ingest-survey-labels.mjs [--dry-run] ["percorso/al.docx"]
 *
 * Il percorso di default è il modulo del sondaggio 2026-08 in docs/.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

export const DEFAULT_DOCX_PATH = join(
  repoRoot,
  'docs',
  'Domande Agenti e match con la KB (compilato).docx',
);
const SURVEY_PATH = join(repoRoot, 'tests', 'fixtures', 'survey-queries-2026-08.json');
const INDEX_PATH = join(repoRoot, 'lib', 'kb-index.json');
const GOLDENS_PATH = join(repoRoot, 'tests', 'fixtures', 'rank-goldens.json');

/** Questo script possiede le entry `curated`/`rejected` con questo `batch`. */
export const BATCH_ID = 'survey-2026-08';

/** Testo letterale del content control ALTRO mai toccato dall'esperto. */
export const PLACEHOLDER_ALTRO = "Clicca qui e scrivi il titolo o 'non esiste'";

// --- 1. Unzip minimale (solo le entry richieste, via central directory) ----

const EOCD_SIG = 0x06054b50;
const CDIR_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

/**
 * Legge le entry richieste da un buffer .docx (zip), per nome esatto.
 * Usa SOLO le dimensioni della central directory (autorevoli anche quando il
 * local header ha un data descriptor): il local header serve solo a trovare
 * l'inizio dei dati, via la lunghezza di nome+extra che può differire da quella
 * in central directory.
 */
export function readDocxEntries(buf, wantedNames) {
  const want = new Set(wantedNames);
  let eocd = -1;
  // L'EOCD è vicino alla fine (un commento opzionale la sposta indietro), quindi
  // si scansiona all'indietro invece di leggere tutto il file dall'inizio.
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('EOCD non trovato: il file non è uno zip valido');
  const entryCount = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);

  const out = new Map();
  for (let i = 0; i < entryCount && out.size < want.size; i++) {
    if (buf.readUInt32LE(cdOffset) !== CDIR_SIG) {
      throw new Error(`central directory corrotta all'offset ${cdOffset}`);
    }
    const method = buf.readUInt16LE(cdOffset + 10);
    const compSize = buf.readUInt32LE(cdOffset + 20);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const localOffset = buf.readUInt32LE(cdOffset + 42);
    const name = buf.toString('utf8', cdOffset + 46, cdOffset + 46 + nameLen);

    if (want.has(name)) {
      if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
        throw new Error(`local header corrotto all'offset ${localOffset} per ${name}`);
      }
      const localNameLen = buf.readUInt16LE(localOffset + 26);
      const localExtraLen = buf.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLen + localExtraLen;
      const raw = buf.subarray(dataStart, dataStart + compSize);
      const data = method === 0 ? Buffer.from(raw) : inflateRawSync(raw);
      out.set(name, data.toString('utf8'));
    }
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  for (const name of want) {
    if (!out.has(name)) throw new Error(`entry mancante nel .docx: ${name}`);
  }
  return out;
}

// --- 2. Estrazione di testo dall'XML (regex mirate, non un parser generico) -

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Testo concatenato di tutti i `<w:t>` in un frammento XML. `(?:\s[^>]*)?` dopo
 * `w:t` è la parte che conta: un `<w:t[^>]*>` ingenuo matcha anche `<w:tag>` e
 * `<w:text/>`, che iniziano allo stesso modo — bug preso e corretto durante
 * l'ispezione del documento reale, e produce risultati PLAUSIBILI ma sbagliati.
 */
export function extractText(xmlFragment) {
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  for (const m of xmlFragment.matchAll(re)) out += decodeXmlEntities(m[1]);
  return out;
}

/** Relazioni Id → Target di word/_rels/document.xml.rels. */
export function parseRelationships(relsXml) {
  const map = new Map();
  const re = /<Relationship\s+Id="(rId\d+)"[^>]*\bTarget="([^"]*)"/g;
  for (const m of relsXml.matchAll(re)) map.set(m[1], decodeXmlEntities(m[2]));
  return map;
}

// --- 3. Sezioni (una per domanda, delimitate dallo stile Titolo2) ----------

const TITOLO2_RE = /<w:pStyle w:val="Titolo2"\/>/g;
const TITOLO1_RE = /<w:pStyle w:val="Titolo1"\/>/g;

/**
 * Spezza il documento in sezioni, una per intestazione "Titolo2". L'ultima
 * sezione si chiude al primo "Titolo1" successivo (l'Appendice tecnica), non a
 * fine file — altrimenti la sua tabella riepilogativa (27 righe) finirebbe
 * dentro l'ultima sezione e ne confonderebbe il parsing.
 */
export function splitSections(documentXml) {
  const starts = [...documentXml.matchAll(TITOLO2_RE)].map((m) => m.index);
  if (!starts.length) throw new Error('nessuna sezione "Titolo2" trovata nel documento');
  const titolo1s = [...documentXml.matchAll(TITOLO1_RE)].map((m) => m.index);
  const lastStart = starts[starts.length - 1];
  const afterLast = titolo1s.find((i) => i > lastStart) ?? documentXml.length;
  const bounds = [...starts, afterLast];
  const sections = [];
  for (let i = 0; i < starts.length; i++)
    sections.push(documentXml.slice(bounds[i], bounds[i + 1]));
  return sections;
}

/** Testo del PRIMO paragrafo del frammento (fino al primo `</w:p>`). */
function firstParagraphText(fragment) {
  const end = fragment.indexOf('</w:p>');
  return extractText(end === -1 ? fragment : fragment.slice(0, end));
}

/** Testo del SECONDO paragrafo (quello subito dopo il primo `</w:p>`). */
function secondParagraphText(fragment) {
  const firstEnd = fragment.indexOf('</w:p>');
  if (firstEnd === -1) return '';
  const secondEnd = fragment.indexOf('</w:p>', firstEnd + 1);
  const slice = fragment.slice(
    firstEnd + '</w:p>'.length,
    secondEnd === -1 ? undefined : secondEnd,
  );
  return extractText(slice);
}

const SDT_RE = /<w:sdt>([\s\S]*?)<\/w:sdt>/g;

/** Le 6 checkbox candidate di una sezione, in ordine documento. */
export function parseCheckboxes(sectionXml) {
  const boxes = [];
  for (const m of sectionXml.matchAll(SDT_RE)) {
    const body = m[1];
    if (!body.includes('<w14:checkbox>')) continue; // salta l'sdt di ALTRO
    const tagM = body.match(/<w:tag w:val="(Q\d{2}_C[1-6])"\/>/);
    const aliasM = body.match(/<w:alias w:val="([^"]*)"\/>/);
    const checkedM = body.match(/<w14:checked w14:val="(\d)"\/>/);
    if (!tagM || !aliasM || !checkedM) {
      throw new Error(
        `checkbox malformata (tag=${tagM?.[1] ?? '?'} alias=${aliasM?.[1] ?? '?'}): ` +
          'attesi <w:tag>, <w:alias> e <w14:checked> sulla stessa <w:sdt>',
      );
    }
    boxes.push({
      tag: tagM[1],
      alias: decodeXmlEntities(aliasM[1]),
      checked: checkedM[1] === '1',
    });
  }
  return boxes;
}

const HYPERLINK_RE = /<w:hyperlink r:id="(rId\d+)"[^>]*>([\s\S]*?)<\/w:hyperlink>/g;

/** Gli rId dei link "Apri articolo" di una sezione, in ordine documento. */
export function parseArticleHyperlinkIds(sectionXml) {
  const ids = [];
  for (const m of sectionXml.matchAll(HYPERLINK_RE)) {
    if (extractText(m[2]).trim() === 'Apri articolo') ids.push(m[1]);
  }
  return ids;
}

const TABLE_RE = /<w:tbl>([\s\S]*?)<\/w:tbl>/;
const CELL_RE = /<w:tc>([\s\S]*?)<\/w:tc>/g;
const ALTRO_TAG_RE = /<w:tag w:val="(Q\d{2}_ALTRO)"\/>/g;

/**
 * Il campo ALTRO di una sezione: il testo di OGNI cella dopo quella etichettata
 * "ALTRO" nella riga (normalmente una sola; il documento reale ne ha 2 in un
 * caso — un content control intero incollato da un'altra domanda, con tag
 * sbagliato ma in posizione corretta). Si legge il testo della cella, non il
 * content control: è la regola che regge sia il caso normale sia l'anomalia,
 * senza doverla riconoscere esplicitamente.
 */
export function parseAltroField(sectionXml) {
  const tableM = sectionXml.match(TABLE_RE);
  if (!tableM) return { text: '', tagsFound: [], cellsFound: 0 };
  const tableXml = tableM[1];
  const cells = [...tableXml.matchAll(CELL_RE)].map((m) => m[1]);
  if (cells.length < 2) return { text: '', tagsFound: [], cellsFound: cells.length };

  const labelText = extractText(cells[0]).trim();
  if (labelText !== 'ALTRO') {
    throw new Error(
      `riga inattesa nella tabella ALTRO: prima cella = ${JSON.stringify(labelText)}`,
    );
  }

  const answers = cells
    .slice(1)
    .map((c) => normalizeCellText(extractText(c)))
    .filter((t) => t && t !== PLACEHOLDER_ALTRO);

  const distinct = [...new Set(answers)];
  if (distinct.length > 1) {
    throw new Error(`più risposte ALTRO diverse nella stessa sezione: ${JSON.stringify(distinct)}`);
  }

  const tagsFound = [...tableXml.matchAll(ALTRO_TAG_RE)].map((m) => m[1]);
  return { text: distinct[0] ?? '', tagsFound, cellsFound: cells.length };
}

/** NBSP -> spazio normale, spazi ripetuti collassati, trim. */
function normalizeCellText(raw) {
  return raw.replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

// --- 4. Risoluzione contro l'indice KB reale --------------------------------

/**
 * Identità di un URL ai fini del confronto: origin + pathname, minuscolo, senza
 * query né fragment. Duplica DELIBERATAMENTE `identity()` di
 * tests/rank-eval.test.ts (5 righe, non vale un modulo condiviso fra docs/ e
 * tests/) — un test in tests/ingest-survey-labels.test.ts verifica che le due
 * restino allineate sui casi limite (in particolare il fragment `#EK`).
 */
export function urlIdentity(rawUrl) {
  try {
    const u = new URL(rawUrl);
    return `${u.origin}${u.pathname}`.toLowerCase().replace(/\/+$/, '');
  } catch {
    return rawUrl.trim().toLowerCase();
  }
}

/** Mappa identità -> record per ogni articolo di lib/kb-index.json. */
export function indexByIdentity(kbIndex) {
  const map = new Map();
  for (const a of kbIndex.articles) map.set(urlIdentity(a.u), a);
  return map;
}

/** Via l'ID Salesforce in coda: stessa funzione di docs/build-eval-report.mts. */
function readableLabel(label) {
  return label.replace(/\s+\d{10,}$/, '');
}

/**
 * Risolve un URL (o testo) contro l'indice: ritorna l'URL CANONICO dell'indice
 * (mai il testo etichettato verbatim) — così `?language=en_US` è sempre giusto
 * per costruzione e un fragment come `#EK` cade da sé, senza una regola dedicata.
 * Lancia se non trova corrispondenza: l'integrità non è un controllo a parte,
 * è il passo stesso.
 */
export function resolveArticleUrl(rawUrl, byIdentity, context) {
  const hit = byIdentity.get(urlIdentity(rawUrl));
  if (!hit)
    throw new Error(
      `${context}: nessun articolo nell'indice combacia con ${JSON.stringify(rawUrl)}`,
    );
  return hit.u;
}

const HTTP_URL_RE = /^https?:\/\//i;

// --- 5. Una sezione -> un verdetto -------------------------------------------

/**
 * Elabora una sezione: verifica la coerenza con la query attesa, accoppia
 * checkbox e hyperlink, risolve gli URL, classifica l'esito. Ritorna anche gli
 * avvisi non fatali (mismatch di tag/alias) da stampare a video.
 */
export function parseSection(sectionXml, index, expectedQuery, rels, byIdentity) {
  const warnings = [];
  const n = index + 1;
  const label = `sezione ${n} (${expectedQuery.id})`;

  const heading = firstParagraphText(sectionXml).trim();
  const headingQuery = heading.replace(/^\d+\.\s*/, '').trim();
  if (headingQuery !== expectedQuery.query.trim()) {
    throw new Error(
      `${label}: il testo della domanda non combacia -- ` +
        `docx=${JSON.stringify(headingQuery)} fixture=${JSON.stringify(expectedQuery.query)}`,
    );
  }

  const meta = secondParagraphText(sectionXml);
  const idM = meta.match(/ID\s+(\S+)/);
  if (!idM || idM[1] !== expectedQuery.id) {
    throw new Error(`${label}: ID non trovato o non combacia (letto ${JSON.stringify(idM?.[1])})`);
  }

  const boxes = parseCheckboxes(sectionXml);
  const hyperlinkIds = parseArticleHyperlinkIds(sectionXml);
  if (boxes.length !== 6 || hyperlinkIds.length !== 6 || boxes.length !== hyperlinkIds.length) {
    throw new Error(
      `${label}: attese 6 checkbox e 6 hyperlink "Apri articolo" accoppiati 1:1, ` +
        `trovate ${boxes.length} checkbox e ${hyperlinkIds.length} hyperlink`,
    );
  }
  boxes.forEach((box, i) => {
    const expectedTag = `Q${String(n).padStart(2, '0')}_C${i + 1}`;
    if (box.tag !== expectedTag) {
      warnings.push(`${label}: checkbox ${i + 1} ha tag ${box.tag}, atteso ${expectedTag}`);
    }
  });

  const checked = boxes
    .map((box, i) => ({ box, rId: hyperlinkIds[i] }))
    .filter((c) => c.box.checked);

  const checkedUrls = checked.map(({ box, rId }) => {
    const target = rels.get(rId);
    if (!target) throw new Error(`${label}: hyperlink ${rId} non presente nelle relazioni`);
    const resolved = resolveArticleUrl(target, byIdentity, `${label} (spunta "${box.alias}")`);
    const article = byIdentity.get(urlIdentity(resolved));
    const wantAlias = readableLabel(article.l).trim();
    if (wantAlias !== box.alias.trim()) {
      warnings.push(
        `${label}: alias della spunta ${JSON.stringify(box.alias)} != label dell'articolo risolto ${JSON.stringify(wantAlias)}`,
      );
    }
    return resolved;
  });

  const altro = parseAltroField(sectionXml);
  const expectedAltroTag = `Q${String(n).padStart(2, '0')}_ALTRO`;
  if (altro.tagsFound.length && !altro.tagsFound.every((t) => t === expectedAltroTag)) {
    warnings.push(
      `${label}: la cella ALTRO contiene un content control con tag inatteso (${altro.tagsFound.join(', ')}) -- letto comunque dal testo della cella, non dal tag`,
    );
  }

  if (checkedUrls.length) {
    return {
      id: expectedQuery.id,
      query: expectedQuery.query,
      kind: 'labelled',
      expectedUrls: [...new Set(checkedUrls)],
      sourceKind: 'checked',
      warnings,
    };
  }

  if (altro.text && HTTP_URL_RE.test(altro.text)) {
    const resolved = resolveArticleUrl(altro.text, byIdentity, `${label} (campo ALTRO)`);
    const note = altro.text.includes('#')
      ? `L'esperto ha indicato il fragment "${altro.text.slice(altro.text.indexOf('#'))}": la risposta e' probabilmente una SEZIONE dentro un articolo che copre piu' vettori/temi (cfr. lib/kb-ranges.ts), non l'intero articolo. Articolo fuori dai 6 mostrati dal prefiltro.`
      : 'Articolo fuori dai 6 mostrati dal prefiltro (risposta scritta in ALTRO).';
    return {
      id: expectedQuery.id,
      query: expectedQuery.query,
      kind: 'labelled',
      expectedUrls: [resolved],
      sourceKind: 'altro-url',
      note,
      warnings,
    };
  }

  if (altro.text) {
    return {
      id: expectedQuery.id,
      query: expectedQuery.query,
      kind: 'rejected',
      verdict: altro.text,
      warnings,
    };
  }

  return { id: expectedQuery.id, query: expectedQuery.query, kind: 'unlabelled', warnings };
}

// --- 6. Assemblaggio del documento goldens ----------------------------------

/**
 * Da tutti i verdetti di sezione ai due array da scrivere in rank-goldens.json.
 * Fa il dedup di r9-h/r9-i (stessa query "EU package bookings", stessa risposta
 * -- 27 risposte per 26 query distinte nel sondaggio): due sezioni "labelled"
 * con stesso testo query e stesso insieme di URL attesi diventano UNA entry
 * sola, con `note` che cita entrambi gli id.
 */
export function buildGoldenEntries(results) {
  const labelled = results.filter((r) => r.kind === 'labelled');
  const rejected = results.filter((r) => r.kind === 'rejected');

  const byDedupKey = new Map();
  for (const r of labelled) {
    const key = `${r.query.trim().toLowerCase()} ${[...r.expectedUrls].sort().join(',')}`;
    const existing = byDedupKey.get(key);
    if (existing) {
      existing.ids.push(r.id);
      if (r.note && !existing.notes.includes(r.note)) existing.notes.push(r.note);
    } else {
      byDedupKey.set(key, {
        ids: [r.id],
        query: r.query,
        expectedUrls: r.expectedUrls,
        notes: r.note ? [r.note] : [],
      });
    }
  }

  const curated = [...byDedupKey.values()].map((g) => {
    const notes = [...g.notes];
    if (g.ids.length > 1) {
      notes.push(
        `Duplicata nel sondaggio: id ${g.ids.join(', ')} sono la stessa domanda con la stessa risposta.`,
      );
    }
    const entry = {
      id: g.ids[0],
      query: g.query,
      source: 'curated',
      batch: BATCH_ID,
    };
    if (g.expectedUrls.length === 1) entry.expectedUrl = g.expectedUrls[0];
    else entry.expectedUrls = g.expectedUrls;
    if (notes.length) entry.note = notes.join(' ');
    return entry;
  });

  const rejectedEntries = rejected.map((r) => ({
    id: r.id,
    query: r.query,
    verdict: r.verdict,
    source: BATCH_ID,
  }));

  return { curated, rejected: rejectedEntries };
}

/**
 * Riscrive rank-goldens.json possedendo solo le entry del batch indicato.
 *
 * `batchId` ha un default (la costante del modulo) per comodità della CLI, ma
 * NON va dedotto a sola chiusura su `BATCH_ID`: questa funzione deve poter
 * ingerire un batch FUTURO senza cancellare quelli precedenti, e un test deve
 * poterla esercitare con dati sintetici che non conoscono il modulo. Filtrare
 * per il batch delle `newEntries` stesse rende la funzione corretta anche
 * quando `BATCH_ID` cambia da una versione dello script alla successiva.
 */
export function writeGoldens(prevDoc, newEntries, batchId = BATCH_ID) {
  const nonBatchCurated = (prevDoc.curated ?? []).filter((g) => g.batch !== batchId);
  const nonBatchRejected = (prevDoc.rejected ?? []).filter((g) => g.source !== batchId);
  return {
    ...prevDoc,
    schema: 'rs-rank-goldens/3',
    schemaNote:
      'Ogni golden ha `query` e almeno una risposta attesa: `expectedUrl` (una) oppure ' +
      "`expectedUrls` (piu' di una, per le richieste di elenco esaustivo). Se ci sono entrambi, " +
      '`expectedUrl` conta come primo elemento. `id`/`batch` tracciano la provenienza per gli ' +
      'ingest rieseguibili (docs/ingest-survey-labels.mjs), che possiede solo le entry col proprio ' +
      '`batch`. `rejected` sono le domande che gli esperti hanno dichiarato incomplete o senza senso: ' +
      'non entrano nelle metriche, restano per tarare in futuro un gate "chiedi chiarimento". ' +
      'Le query del sondaggio agenti stanno in survey-queries-2026-08.json.',
    curated: [...nonBatchCurated, ...newEntries.curated],
    rejected: [...nonBatchRejected, ...newEntries.rejected],
  };
}

// --- 7. CLI ------------------------------------------------------------------

function summarize(results, warnings) {
  const labelled = results.filter((r) => r.kind === 'labelled');
  const checked = labelled.filter((r) => r.sourceKind === 'checked');
  const altroUrl = labelled.filter((r) => r.sourceKind === 'altro-url');
  const rejected = results.filter((r) => r.kind === 'rejected');
  const unlabelled = results.filter((r) => r.kind === 'unlabelled');
  const lines = [
    `${results.length} sezioni - ${checked.length} con spunta - ${altroUrl.length} con URL in ALTRO - ` +
      `${rejected.length} giudizi in ALTRO - ${unlabelled.length} non etichettate`,
  ];
  for (const r of results) {
    const tag =
      r.kind === 'labelled'
        ? `-> ${r.expectedUrls.length > 1 ? `${r.expectedUrls.length} articoli` : r.expectedUrls[0]} (${r.sourceKind})`
        : r.kind === 'rejected'
          ? `-> respinta: ${JSON.stringify(r.verdict)}`
          : '-> NON ETICHETTATA';
    lines.push(`  ${r.id}  ${tag}`);
  }
  if (warnings.length) {
    lines.push('', `${warnings.length} avvisi:`);
    for (const w of warnings) lines.push(`  ! ${w}`);
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const docxPath = resolve(args.find((a) => a !== '--dry-run') ?? DEFAULT_DOCX_PATH);

  const survey = JSON.parse(readFileSync(SURVEY_PATH, 'utf8'));
  const kbIndex = JSON.parse(readFileSync(INDEX_PATH, 'utf8'));
  const byIdentity = indexByIdentity(kbIndex);

  const docxBuf = readFileSync(docxPath);
  const entries = readDocxEntries(docxBuf, ['word/document.xml', 'word/_rels/document.xml.rels']);
  const documentXml = entries.get('word/document.xml');
  const rels = parseRelationships(entries.get('word/_rels/document.xml.rels'));

  const sections = splitSections(documentXml);
  if (sections.length !== survey.queries.length) {
    throw new Error(
      `${sections.length} sezioni nel .docx ma ${survey.queries.length} query nel fixture: ` +
        "il join posizionale non e' affidabile finche' non combaciano",
    );
  }

  const results = [];
  const allWarnings = [];
  sections.forEach((sectionXml, i) => {
    const r = parseSection(sectionXml, i, survey.queries[i], rels, byIdentity);
    results.push(r);
    allWarnings.push(...r.warnings);
  });

  console.log(summarize(results, allWarnings));

  if (dryRun) {
    console.log('\n--dry-run: nessuna scrittura.');
    return;
  }

  const newEntries = buildGoldenEntries(results);
  const prevDoc = JSON.parse(readFileSync(GOLDENS_PATH, 'utf8'));
  const doc = writeGoldens(prevDoc, newEntries);
  writeFileSync(GOLDENS_PATH, JSON.stringify(doc, null, 2) + '\n');
  console.log(
    `\nscritte ${newEntries.curated.length} entry curated + ${newEntries.rejected.length} rejected ` +
      `(batch ${BATCH_ID}) -> ${GOLDENS_PATH}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    main();
  } catch (e) {
    console.error('Errore:', e.message);
    process.exit(1);
  }
}
