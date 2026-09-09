/*
 * RunwaySurfer — generatore del set golden per la valutazione del reranker (Fase 5)
 * =================================================================================
 *
 * Produce la sezione `bootstrap` di tests/fixtures/rank-goldens.json campionando
 * l'indice KB reale (lib/kb-index.json) e derivando una query dal label di ogni
 * articolo scelto. Serve VOLUME e un guard di regressione ("lo scorer trova
 * l'articolo quando gli dai in pratica il titolo"); la fedeltà alle vere domande
 * degli agenti la portano le entry `curated`, che questo script NON tocca.
 *
 * USO (Node, dalla root del repo):
 *   node docs/build-rank-goldens.mjs [--count N]   # default N=30
 *
 * Deterministico: campiona a passo fisso sull'indice ordinato (niente RNG), così
 * il fixture è riproducibile e il diff è stabile.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const indexPath = join(repoRoot, 'lib', 'kb-index.json');
const outPath = join(repoRoot, 'tests', 'fixtures', 'rank-goldens.json');

const countArg = process.argv.indexOf('--count');
const COUNT = countArg !== -1 ? Number(process.argv[countArg + 1]) : 30;

const STOP = new Set([
  'flight',
  'policies',
  'policy',
  'global',
  'the',
  'and',
  'for',
  'a',
  'to',
  'in',
  'of',
  'or',
  'retail',
  'process',
]);

/** Da un label "Airline baggage policies 169455..." deriva una query plausibile. */
function queryFromLabel(label) {
  const words = decodeURIComponent(label || '')
    .replace(/[|—–\-_/()]+/g, ' ')
    .replace(/\d+/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
  // Tieni le parole più distintive (max 5) preservando l'ordine.
  return words.slice(0, 5).join(' ').trim();
}

function main() {
  const raw = JSON.parse(readFileSync(indexPath, 'utf8'));
  const articles = raw.articles ?? raw.default?.articles ?? [];
  if (!articles.length) throw new Error(`indice KB vuoto: ${indexPath}`);

  const stride = Math.max(1, Math.floor(articles.length / COUNT));
  const bootstrap = [];
  for (let i = 0; i < articles.length && bootstrap.length < COUNT; i += stride) {
    const a = articles[i];
    const query = queryFromLabel(a.l);
    if (!query) continue;
    bootstrap.push({ query, expectedUrl: a.u, source: 'bootstrap' });
  }

  // Preserva la sezione curated esistente (editata a mano coi casi reali).
  let curated = [];
  try {
    const prev = JSON.parse(readFileSync(outPath, 'utf8'));
    if (Array.isArray(prev.curated)) curated = prev.curated;
  } catch {
    /* primo run: nessun file precedente */
  }

  const doc = {
    schema: 'rs-rank-goldens/1',
    note: 'curated = casi reali (editati a mano); bootstrap = generato da build-rank-goldens.mjs',
    curated,
    bootstrap,
  };
  writeFileSync(outPath, JSON.stringify(doc, null, 2) + '\n');
  console.log(
    `scritte ${bootstrap.length} entry bootstrap (+${curated.length} curated) → ${outPath}`,
  );
}

main();
