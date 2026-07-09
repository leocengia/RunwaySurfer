// Test di estrazione DOM: girano in happy-dom con URL
// https://kb.example.com/wiki/Pagina_iniziale (vedi vitest.config.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { extractCurrentPage, extractInternalLinks, extractPageText } from '../lib/extract';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('extractPageText', () => {
  it('legge il contenuto da <main> ignorando nav/footer/script', () => {
    document.body.innerHTML = `
      <nav>menu che non deve comparire</nav>
      <main><p>Procedura ufficiale per il cambio indirizzo di consegna.</p></main>
      <footer>footer che non deve comparire</footer>
      <script>var x = 'niente script';</script>
    `;
    const text = extractPageText(document);
    expect(text).toContain('Procedura ufficiale');
    expect(text).not.toContain('menu che non deve comparire');
    expect(text).not.toContain('footer che non deve comparire');
  });

  it('con una query privilegia i blocchi pertinenti', () => {
    const filler = Array.from(
      { length: 30 },
      (_, i) => `<p>Paragrafo di riempimento numero ${i} senza informazioni utili qui.</p>`,
    ).join('');
    document.body.innerHTML = `<main>${filler}<p>Per il rimborso ordine segui questi passi documentati.</p></main>`;
    const text = extractPageText(document, 'come ottengo il rimborso di un ordine?');
    expect(text).toContain('rimborso ordine');
  });

  it('tronca i testi oltre il budget di pagina', () => {
    document.body.innerHTML = `<main><p>${'parola '.repeat(3000)}</p></main>`;
    const text = extractPageText(document);
    expect(text.length).toBeLessThanOrEqual(6003); // budget + '...'
    expect(text.endsWith('...')).toBe(true);
  });
});

describe('extractInternalLinks', () => {
  it('raccoglie solo link same-origin utili, senza duplicati né fragment', () => {
    document.body.innerHTML = `
      <main>
        <h2>Sezione</h2>
        <p><a href="/wiki/Cambio_indirizzo">Cambio indirizzo</a></p>
        <p><a href="/wiki/Cambio_indirizzo#dettagli">Cambio indirizzo (dup con fragment)</a></p>
        <p><a href="https://altro-dominio.com/pagina">Esterno</a></p>
        <p><a href="/wiki/Special:Login">Special</a></p>
        <p><a href="/wiki/Rimborsi">Rimborsi</a></p>
      </main>
    `;
    const links = extractInternalLinks(document);
    expect(links.map((l) => l.url)).toEqual([
      'https://kb.example.com/wiki/Cambio_indirizzo',
      'https://kb.example.com/wiki/Rimborsi',
    ]);
    expect(links[0].context).toContain('Sezione');
    expect(links[0].order).toBeTypeOf('number');
  });

  it('rispetta il limite massimo', () => {
    document.body.innerHTML = `<main>${Array.from(
      { length: 60 },
      (_, i) => `<a href="/wiki/Pagina_${i}">Pagina ${i}</a>`,
    ).join(' ')}</main>`;
    expect(extractInternalLinks(document, 5)).toHaveLength(5);
  });
});

describe('extractCurrentPage', () => {
  it('costruisce la KbPage della pagina corrente', () => {
    document.title = 'Pagina iniziale';
    document.body.innerHTML = '<main><p>Contenuto della pagina iniziale.</p></main>';
    const page = extractCurrentPage('');
    expect(page.origin).toBe('current');
    expect(page.url).toBe('https://kb.example.com/wiki/Pagina_iniziale');
    expect(page.title).toBe('Pagina iniziale');
    expect(page.text).toContain('Contenuto della pagina iniziale.');
  });
});
