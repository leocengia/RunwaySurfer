import { defineConfig } from 'vitest/config';

// Test dell'estensione: ambiente happy-dom (extract/crawl leggono il DOM) con
// un URL simil-KB così i link same-origin dei fixture risultano interni.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: { url: 'https://kb.example.com/wiki/Pagina_iniziale' },
    },
    include: ['tests/**/*.test.ts'],
  },
});
