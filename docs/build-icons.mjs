// Genera le icone del manifest dal marchio, senza dipendenze esterne.
//
//   node docs/build-icons.mjs [sorgente.png]
//
// Perché scritto a mano invece di usare sharp/jimp: servono quattro PNG generati
// una volta ogni cambio di logo. Aggiungere una dipendenza nativa (che va
// compilata su ogni macchina e in CI) per questo sarebbe sproporzionato, e la
// catena di build dell'estensione non ne ha bisogno per nulla altro.
//
// Copre il solo caso che ci serve — PNG a 8 bit, RGB o RGBA, NON interlacciato —
// e si ferma con un messaggio chiaro su tutto il resto, invece di produrre
// silenziosamente un'immagine sbagliata.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** Dimensioni richieste da Chrome: barra, gestione estensioni, negozio/finestre. */
const SIZES = [16, 32, 48, 128];
/**
 * Marchio per l'INTERFACCIA (sidebar, banner del tour, dashboard, pagine di
 * login, Options). 96px perché la misura più grande a schermo è 56px e serve il
 * doppio per gli schermi ad alta densità. L'originale da 1,7 MB non è utilizzabile:
 * finirebbe in base64 dentro ogni caricamento della dashboard.
 */
const MARK_SIZE = 96;

// --- CRC32 (richiesto da ogni chunk PNG) -------------------------------------
const CRC_TABLE = new Int32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- Decodifica --------------------------------------------------------------
function readPng(path) {
  const buf = readFileSync(path);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${path}: non è un PNG`);

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const bitDepth = buf[24];
  const colorType = buf[25];
  const interlace = buf[28];
  if (bitDepth !== 8) throw new Error(`bitDepth ${bitDepth} non gestito: riesporta a 8 bit`);
  if (colorType !== 2 && colorType !== 6) {
    throw new Error(`colorType ${colorType} non gestito: serve RGB (2) o RGBA (6)`);
  }
  if (interlace !== 0) throw new Error('PNG interlacciato: riesporta senza interlacciamento');

  // Gli IDAT possono essere spezzati in più chunk: il flusso zlib è la loro
  // concatenazione, quindi va ricomposto prima di decomprimere.
  const parts = [];
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.subarray(offset + 4, offset + 8).toString('latin1');
    if (type === 'IDAT') parts.push(buf.subarray(offset + 8, offset + 8 + length));
    if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!parts.length) throw new Error('nessun chunk IDAT trovato');

  const raw = inflateSync(Buffer.concat(parts));
  const channels = colorType === 6 ? 4 : 3;
  const pixels = unfilter(raw, width, height, channels);
  return { width, height, channels, pixels };
}

/**
 * Rimuove i filtri per riga (PNG li applica come predizione prima di comprimere).
 * Ogni scanline è precedura dal suo tipo di filtro: 0 nessuno, 1 Sub, 2 Up,
 * 3 Average, 4 Paeth. Senza questo passaggio i byte non sono colori.
 */
function unfilter(raw, width, height, channels) {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);
  let pos = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[pos];
    pos += 1;
    const row = raw.subarray(pos, pos + stride);
    pos += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? cur[i - channels] : 0; // pixel a sinistra
      const b = prev ? prev[i] : 0; // pixel sopra
      const c = prev && i >= channels ? prev[i - channels] : 0; // in diagonale
      let value = row[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) value += paeth(a, b, c);
      else if (filter !== 0) throw new Error(`filtro PNG ${filter} sconosciuto`);
      cur[i] = value & 0xff;
    }
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// --- Riduzione ---------------------------------------------------------------
/**
 * Media a finestra (box filter) con alpha PREMOLTIPLICATO.
 *
 * La premoltiplicazione non è un dettaglio: mediando i canali colore senza
 * pesarli per l'alpha, i pixel trasparenti (spesso neri o bianchi) sporcano il
 * bordo e l'icona finisce con un alone. Con 1254px verso 16px ogni pixel finale
 * media ~78 pixel di origine, quindi l'alone sarebbe vistoso.
 */
function resize(src, target) {
  const { width, height, channels, pixels } = src;
  const out = Buffer.alloc(target * target * 4);
  for (let ty = 0; ty < target; ty += 1) {
    const y0 = Math.floor((ty * height) / target);
    const y1 = Math.max(y0 + 1, Math.ceil(((ty + 1) * height) / target));
    for (let tx = 0; tx < target; tx += 1) {
      const x0 = Math.floor((tx * width) / target);
      const x1 = Math.max(x0 + 1, Math.ceil(((tx + 1) * width) / target));
      let r = 0;
      let g = 0;
      let b = 0;
      let alpha = 0;
      let count = 0;
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          const i = (y * width + x) * channels;
          const a = channels === 4 ? pixels[i + 3] : 255;
          r += pixels[i] * a;
          g += pixels[i + 1] * a;
          b += pixels[i + 2] * a;
          alpha += a;
          count += 1;
        }
      }
      const o = (ty * target + tx) * 4;
      if (alpha > 0) {
        out[o] = Math.round(r / alpha);
        out[o + 1] = Math.round(g / alpha);
        out[o + 2] = Math.round(b / alpha);
      }
      out[o + 3] = Math.round(alpha / count);
    }
  }
  return out;
}

// --- Codifica ---------------------------------------------------------------
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // compressione 0, filtro 0, interlacciamento 0 (già a zero da Buffer.alloc)

  // Filtro 0 (nessuno) su ogni riga: l'immagine è minuscola, il guadagno di un
  // filtro migliore è irrilevante e il codice resta leggibile.
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Main -------------------------------------------------------------------
const root = resolve(import.meta.dirname, '..');
const source = resolve(root, process.argv[2] ?? 'shared/logo_v2_alpha.png');
const src = readPng(source);
if (src.width !== src.height) {
  console.warn(
    `ATTENZIONE: la sorgente è ${src.width}x${src.height}, non quadrata: ` +
      "l'icona risulterà deformata. Riesporta quadrata.",
  );
}
console.log(
  `sorgente: ${source} (${src.width}x${src.height}, ${src.channels === 4 ? 'RGBA' : 'RGB'})`,
);

for (const size of SIZES) {
  const target = resolve(root, `public/icons/${size}.png`);
  mkdirSync(dirname(target), { recursive: true });
  const png = encodePng(resize(src, size), size);
  writeFileSync(target, png);
  console.log(`  → public/icons/${size}.png (${png.length} byte)`);
}

// Marchio dell'interfaccia. Due forme dello stesso byte-stream:
//  - il PNG su disco, che il SERVER legge a runtime (server/src/shared-assets.ts:
//    `rootDir: "src"` vieta gli import fuori da src);
//  - un modulo TS con il data-URI, che l'ESTENSIONE importa. Un data-URI e non un
//    asset emesso dal bundler: così funziona identico dentro React, nel DOM della
//    pagina host (banner del tour) e nella pagina Options, senza dover dichiarare
//    web_accessible_resources.
const markPng = encodePng(resize(src, MARK_SIZE), MARK_SIZE);
writeFileSync(resolve(root, 'shared/logo-mark.png'), markPng);
const dataUri = `data:image/png;base64,${markPng.toString('base64')}`;
writeFileSync(
  resolve(root, 'shared/logo-mark.ts'),
  `// GENERATO da docs/build-icons.mjs — non modificare a mano.\n` +
    `// Marchio Runway Surfer a ${MARK_SIZE}px come data-URI. Sorgente: ${process.argv[2] ?? 'shared/logo_v2_alpha.png'}\n` +
    `// Rigenera con: node docs/build-icons.mjs\n` +
    `export const LOGO_MARK =\n  '${dataUri}';\n`,
);
console.log(`  → shared/logo-mark.png (${markPng.length} byte)`);
console.log(`  → shared/logo-mark.ts (data-URI, ${dataUri.length} caratteri)`);
