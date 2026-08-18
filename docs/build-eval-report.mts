/*
 * RunwaySurfer — report da etichettare (Giro 4, Fase B)
 * =====================================================
 *
 * A COSA SERVE. Oggi l'unico modo di sapere se un intervento sul retrieval
 * migliora le cose è provare tre query a mano e formarsi un'impressione. Il set
 * di valutazione (`tests/fixtures/rank-goldens.json`) ha solo 3 coppie
 * query→articolo curate, e `tests/rank-eval.test.ts` — che misura recall@40,
 * precision@1 e precision@3 — su tre casi non dice niente.
 *
 * Questo script produce il documento che chiude quel buco: per ognuna delle 27
 * query reali del sondaggio agenti stampa i primi candidati che il prefiltro
 * locale trova, con punteggio e motivo, e una casella da spuntare. Chi conosce la
 * KB segna l'articolo giusto; le coppie diventano goldens `curated`; da quel
 * momento ogni modifica al retrieval ha un numero prima e dopo.
 *
 * USO (dalla root del repo):
 *   npx vite-node docs/build-eval-report.mts
 *   # scrive docs/EVAL-DA-ETICHETTARE.md
 *
 * PERCHÉ .mts E NON .mjs come gli altri script in docs/. Serve lo scorer vero,
 * che è TypeScript (`lib/crawl.ts`): un report generato da una copia della logica
 * mentirebbe. `vite-node` è già in node_modules (arriva con vitest), quindi non
 * aggiunge dipendenze e usa lo stesso resolver del resto del progetto.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { retrievalEvidence, shortlistCandidates, SHORTLIST_SIZE } from '../lib/crawl';
import { assessQuery } from '../lib/query-quality';
import survey from '../tests/fixtures/survey-queries-2026-08.json';
import goldens from '../tests/fixtures/rank-goldens.json';

/** Quanti candidati mostrare per query: abbastanza da trovarci l'articolo giusto senza sfogliare 40 righe. */
const SHOWN = 6;

const here = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(join(here, 'EVAL-DA-ETICHETTARE.md'));

interface SurveyQuery {
  id: string;
  query: string;
  lang: string;
  note?: string;
}

/** Via l'ID articolo Salesforce in coda: rumore in un documento da leggere. */
function readable(label: string): string {
  return label.replace(/\s+\d{10,}$/, '');
}

const alreadyLabelled = new Map(
  [...goldens.curated, ...goldens.bootstrap].map((g) => [g.query.toLowerCase(), g.expectedUrl]),
);

const queries = survey.queries as SurveyQuery[];
const lines: string[] = [];

lines.push('# Set di valutazione da etichettare — sondaggio agenti 2026-08');
lines.push('');
lines.push(
  '> **Generato**, non scritto a mano: `npx vite-node docs/build-eval-report.mts`. Le modifiche fatte qui a mano vengono perse alla prossima generazione — l’unica cosa da riportare altrove sono le spunte.',
);
lines.push('');
lines.push('## Cosa devi fare');
lines.push('');
lines.push(
  `Per ogni domanda qui sotto ci sono i primi ${SHOWN} articoli che il prefiltro locale propone, in ordine di punteggio. Metti una **x** nella casella dell’articolo che risponde davvero alla domanda:`,
);
lines.push('');
lines.push('- se quello giusto è in lista → spunta la sua casella;');
lines.push(
  '- se **non** è in lista → scrivilo sulla riga `Altro:` (basta il titolo, o il pezzo finale dell’URL);',
);
lines.push(
  '- se la domanda richiede **più** articoli (le richieste di elenco esaustivo) → spuntane più di uno: il campo `expectedUrls` dei goldens le regge;',
);
lines.push(
  '- se secondo te l’articolo giusto **non esiste** nella KB → scrivilo su `Altro:` come «non esiste»: è un’informazione preziosa, e riguarda chi cura la KB, non noi.',
);
lines.push('');
lines.push(
  'Non serve che sia perfetto o completo. Anche solo metà delle domande etichettate trasforma il retrieval da «sembra migliorato» a un numero.',
);
lines.push('');

const evidenceRows: string[] = [];
let unusable = 0;

for (const [i, q] of queries.entries()) {
  const shortlist = shortlistCandidates([], q.query, SHORTLIST_SIZE);
  const evidence = retrievalEvidence([], q.query);
  const assessment = assessQuery(q.query, evidence);
  if (assessment.vague) unusable++;

  evidenceRows.push(
    `| ${i + 1} | \`${q.id}\` | ${evidence.candidates} | ${evidence.topScore} | ${
      assessment.vague ? '**segnalata**' : '—'
    } |`,
  );

  lines.push('---');
  lines.push('');
  lines.push(`## ${i + 1}. ${q.query}`);
  lines.push('');
  const meta = [`id \`${q.id}\``, `lingua ${q.lang}`, `${evidence.candidates} candidati`];
  if (assessment.vague) meta.push('**la sidebar la segnala come inutilizzabile**');
  lines.push(`*${meta.join(' · ')}*`);
  lines.push('');
  if (q.note) {
    lines.push(`> ${q.note}`);
    lines.push('');
  }
  const known = alreadyLabelled.get(q.query.toLowerCase());
  if (known) {
    lines.push(`> Già etichettata nei goldens: \`${known}\`.`);
    lines.push('');
  }

  if (!shortlist.length) {
    lines.push(
      'Il prefiltro **non propone nulla**: nessun articolo contiene i termini di questa domanda. Se sai quale sarebbe la risposta, scrivila su `Altro:` — è il caso più utile di tutti, perché ci dice cosa il retrieval non raggiunge affatto.',
    );
    lines.push('');
  } else {
    for (const link of shortlist.slice(0, SHOWN)) {
      lines.push(`- [ ] **${readable(link.text)}**`);
      lines.push(`      <br>punteggio ${link.score} — ${link.reason}`);
      lines.push(`      <br>\`${link.url}\``);
    }
    lines.push('');
  }
  lines.push('- [ ] Altro: ');
  lines.push('');
}

lines.push('---');
lines.push('');
lines.push('## Come stanno le query oggi');
lines.push('');
lines.push(
  `Numeri del prefiltro locale sull'indice bundle-ato (${SHOWN} candidati mostrati su ${SHORTLIST_SIZE} inviati al reranker). \`punteggio max\` sotto 5 significa che nessun **titolo** contiene i termini della domanda.`,
);
lines.push('');
lines.push('| # | id | candidati | punteggio max | avviso |');
lines.push('| --- | --- | --- | --- | --- |');
lines.push(...evidenceRows);
lines.push('');
lines.push(
  `Su ${queries.length} domande, ${unusable} vengono segnalate all'agente come inutilizzabili prima di spendere una chiamata.`,
);
lines.push('');

writeFileSync(outPath, `${lines.join('\n')}\n`, 'utf8');
console.log(`✓ Scritto ${outPath}: ${queries.length} domande, ${unusable} segnalate.`);
