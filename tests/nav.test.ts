import { beforeEach, describe, expect, it } from 'vitest';
import { openAndReadArticle, readIndexOnlyArticles } from '../lib/nav';
import type { KbLink } from '../lib/outcome';

// L'URL del documento nei test è https://kb.example.com/wiki/Pagina_iniziale
// (vedi vitest.config.ts): la usiamo come "hub" per il caso già-sulla-pagina.
const HUB_URL = 'https://kb.example.com/wiki/Pagina_iniziale';

// happy-dom aggiorna location.href su history.pushState (non c'è un router SPA
// reale): per i casi di "render mancato" serve quindi un content-root VUOTO
// (testo < minChars) così waitForSpaRender non si stabilizza mai. Ogni test
// riparte dall'hub con body vuoto.
beforeEach(() => {
  history.pushState(null, '', HUB_URL);
  document.body.innerHTML = '<main></main>';
});

describe('openAndReadArticle', () => {
  it('legge la pagina corrente senza navigare quando è già il target', async () => {
    document.body.innerHTML =
      '<main><h1>Rimborsi</h1><p>Procedura per il rimborso di un volo cancellato.</p></main>';
    const page = await openAndReadArticle(HUB_URL, 'rimborso volo');
    expect(page).not.toBeNull();
    expect(page?.origin).toBe('followed');
    expect(page?.text.length).toBeGreaterThan(0);
  });

  it('degrada a null se abortito prima di navigare', async () => {
    const page = await openAndReadArticle('https://kb.example.com/wiki/Altro', 'q', {
      shouldAbort: () => true,
    });
    expect(page).toBeNull();
  });

  it('degrada a null (non errore) se il render non arriva entro il timeout', async () => {
    // Target diverso dall'hub: nessun router SPA nei test, quindi il render non
    // si stabilizza mai → deve degradare a suggerimento entro un timeout breve.
    const page = await openAndReadArticle('https://kb.example.com/wiki/Non_renderizza', 'q', {
      waitOptions: { timeoutMs: 20, pollMs: 5 },
    });
    expect(page).toBeNull();
  });
});

describe('readIndexOnlyArticles', () => {
  const candidates: KbLink[] = [
    { url: 'https://kb.example.com/wiki/A', text: 'A' },
    { url: 'https://kb.example.com/wiki/B', text: 'B' },
  ];

  it('non apre nulla quando il budget è 0', async () => {
    expect(await readIndexOnlyArticles(candidates, 'q', 0)).toEqual([]);
  });

  it('non apre nulla quando è già abortito', async () => {
    expect(await readIndexOnlyArticles(candidates, 'q', 3, { shouldAbort: () => true })).toEqual(
      [],
    );
  });

  it('salta i target che non renderizzano e ritorna [] (degrado silenzioso)', async () => {
    const pages = await readIndexOnlyArticles(candidates, 'q', 3, {
      waitOptions: { timeoutMs: 20, pollMs: 5 },
    });
    expect(pages).toEqual([]);
  });
});
