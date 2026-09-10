// I design token vivono in un solo file (shared/theme.css), ma i consumatori
// sono quattro superfici indipendenti: sidebar, dashboard, pagine auth e FX del
// tour. Prima ognuna aveva la propria copia della palette, e le copie erano già
// divergenti fra loro. Questi test tengono chiusa quella porta: un `var(--rs-…)`
// non dichiarato passerebbe silenziosamente (CSS non fallisce mai) e la
// superficie perderebbe il colore senza che nessuno se ne accorga.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// `import.meta.url` qui è l'URL del documento happy-dom, non un file://:
// la root del progetto la dà vitest come cwd.
const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const THEME = read('shared/theme.css');

const CONSUMERS: Array<{ name: string; path: string }> = [
  { name: 'sidebar', path: 'entrypoints/sidebar.content/style.css' },
  { name: 'dashboard', path: 'server/src/views/dashboard.ts' },
  { name: 'pagine auth', path: 'server/src/views/auth-pages.ts' },
  { name: 'FX del tour', path: 'lib/fx/index.ts' },
];

/** Nomi dichiarati (`--rs-x: …`), non le occorrenze dentro var(). */
function declaredTokens(css: string): Set<string> {
  return new Set(Array.from(css.matchAll(/^\s*(--rs-[a-z0-9-]+)\s*:/gim), (m) => m[1]));
}

/**
 * Variabili scritte da JS a runtime (geometria, non palette): non appartengono al
 * file dei token e non devono farlo fallire.
 */
const RUNTIME_VARS = ['--rs-fx-right', '--rs-host-header-h'];

/** Nomi usati (`var(--rs-x…)`), escluse le variabili runtime. */
function usedTokens(text: string): Set<string> {
  return new Set(
    Array.from(text.matchAll(/var\(\s*(--rs-[a-z0-9-]+)/gi), (m) => m[1]).filter(
      (name) => !name.startsWith('--rs-spot-') && !RUNTIME_VARS.includes(name),
    ),
  );
}

describe('shared/theme.css', () => {
  it('usa #000099 come tono principale', () => {
    expect(THEME).toMatch(/--rs-primary:\s*#000099/i);
  });

  it('tiene il giallo Expedia come accento di bottoni e bordi', () => {
    expect(THEME).toMatch(/--rs-yellow:\s*#ffcc00/i);
    expect(THEME).toMatch(/--rs-yellow-line:\s*#d8ad00/i);
  });

  it('vale sia per `:root` (dashboard, pagina host) sia per `:host` (shadow root)', () => {
    expect(THEME).toMatch(/:root\s*,\s*:host\s*\{/);
  });
});

describe('token usati dalle superfici', () => {
  const declared = declaredTokens(THEME);

  for (const consumer of CONSUMERS) {
    it(`${consumer.name}: ogni var(--rs-*) è dichiarato nel file condiviso`, () => {
      const unknown = Array.from(usedTokens(read(consumer.path))).filter(
        (name) => !declared.has(name),
      );
      expect(unknown).toEqual([]);
    });

    it(`${consumer.name}: non ridichiara i token in proprio`, () => {
      // Escluso il blocco condiviso, che la dashboard e le auth-pages inlinano.
      const own = read(consumer.path).replace(THEME, '');
      expect(Array.from(declaredTokens(own))).toEqual([]);
    });
  }
});
