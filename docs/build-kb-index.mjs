/*
 * RunwaySurfer — build dell'indice KB (Fase E4)
 * =============================================
 *
 * Converte l'inventario grezzo della sitemap (rs-sitemap-inventory.json,
 * prodotto da docs/recon-kb-sitemap.js) nell'asset compatto che l'estensione
 * bundle-a: lib/kb-index.json. L'indice è STATICO — va rigenerato solo quando
 * cambia la KB — e viene consultato in locale dalla sidebar a costo-token zero
 * per proporre l'articolo giusto anche se non è linkato nella pagina corrente.
 *
 * USO (Node, dalla root del repo):
 *   node docs/build-kb-index.mjs <path-a-rs-sitemap-inventory.json>
 *   # default: ./rs-sitemap-inventory.json → scrive lib/kb-index.json
 *
 * Record di output (minimale, solo ciò che serve allo scoring per-slug):
 *   { u: <url normalizzato>, s: <slug>, l: <label leggibile dallo slug> }
 * Titolo reale e topic NON sono nella sitemap: lo slug (descrittivo, in
 * inglese, es. "RBC-Cancel-24-Hour-GDS-refund-process") è già un ottimo
 * portatore di keyword per il matching.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const inPath = resolve(process.argv[2] ?? join(repoRoot, 'rs-sitemap-inventory.json'));
const outPath = join(repoRoot, 'lib', 'kb-index.json');

/**
 * Ripara le label con mojibake: `couponsâ HCOM` nasce da un em-dash che
 * Salesforce ha mal codificato nello slug stesso (l'URL reale contiene
 * `%C3%A2`). Si pulisce SOLO la label — `u` e `s` restano il vero indirizzo, e
 * riscriverli romperebbe il link. Allineata a `cleanKbLabel` in lib/kb-index.ts.
 */
function cleanLabel(label) {
  return label
    .replace(/â\s*œ?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** slug "RBC-Cancel-24-Hour-GDS-refund-process" → "RBC Cancel 24 Hour GDS refund process" */
function labelFromSlug(slug) {
  return cleanLabel(
    decodeURIComponent(slug || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

/**
 * Lingua di retrieval: leggiamo gli articoli in inglese (contenuto popolato +
 * ricerca KB funzionante). La sitemap indicizza in lingue miste, quindi forziamo
 * `?language=en_US` sull'URL memorizzato. Deve restare allineato a
 * `withRetrievalLanguage` in lib/site-profile.ts.
 */
function withRetrievalLanguage(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('language', 'en_US');
    return url.href;
  } catch {
    return rawUrl;
  }
}

const raw = JSON.parse(readFileSync(inPath, 'utf8'));
const records = Array.isArray(raw.inventory) ? raw.inventory : Array.isArray(raw) ? raw : [];
if (!records.length) {
  console.error(
    `Nessun record in ${inPath}. Atteso un JSON con { inventory: [...] } (RS-SITEMAP completo, non troncato).`,
  );
  process.exit(1);
}

const seen = new Set();
const articles = [];
for (const r of records) {
  if (r.type !== 'article') continue; // solo articoli (i topic non sono destinazioni di risposta)
  const url = withRetrievalLanguage((r.url || r.id || '').split('#')[0]);
  const slug = r.slug || '';
  if (!url || !slug || seen.has(url)) continue;
  seen.add(url);
  articles.push({ u: url, s: slug, l: labelFromSlug(slug) });
}

articles.sort((a, b) => a.s.localeCompare(b.s));

const out = {
  origin: raw.origin || '',
  builtFrom: 'rs-sitemap-inventory.json',
  count: articles.length,
  articles,
};

writeFileSync(outPath, JSON.stringify(out));
console.log(`✓ Scritto ${outPath}: ${articles.length} articoli (da ${records.length} record).`);
