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

  it('isola la sezione pertinente in un articolo strutturato per heading', () => {
    // Articolo lungo, più sezioni con intestazione: solo quella sui rimborsi
    // deve arrivare; le sezioni bagaglio/check-in restano fuori.
    const filler = (topic: string) =>
      Array.from(
        { length: 12 },
        (_, i) => `<p>Dettagli su ${topic}, paragrafo ${i}, testo di riempimento lungo.</p>`,
      ).join('');
    document.body.innerHTML = `
      <main>
        <h2>Politica bagagli</h2>${filler('il bagaglio a mano e in stiva')}
        <h2>Procedura di rimborso del volo</h2>
        <p>Per il rimborso del volo cancellato apri una richiesta entro 30 giorni.</p>
        ${filler('la procedura di rimborso passo passo')}
        <h2>Check-in online</h2>${filler('il check-in e la carta di imbarco')}
      </main>
    `;
    const text = extractPageText(document, 'come richiedo il rimborso di un volo?');
    expect(text).toContain('rimborso del volo cancellato');
    expect(text).toContain('Procedura di rimborso');
    expect(text).not.toContain('carta di imbarco');
  });

  it('ricade sul retrieval per-blocco quando la pagina non ha heading', () => {
    const filler = Array.from(
      { length: 20 },
      (_, i) => `<p>Paragrafo ${i} di contorno senza informazioni pertinenti.</p>`,
    ).join('');
    document.body.innerHTML = `<main>${filler}<p>Il rimborso del volo si richiede dal portale.</p></main>`;
    const text = extractPageText(document, 'come ottengo il rimborso del volo?');
    expect(text).toContain('rimborso del volo');
  });

  it('cross-lingua: query IT trova la sezione EN pertinente (rimborso→refund)', () => {
    const filler = (topic: string) =>
      Array.from(
        { length: 12 },
        (_, i) => `<p>About ${topic}, paragraph ${i}, long filler text.</p>`,
      ).join('');
    document.body.innerHTML = `
      <main>
        <h2>Baggage allowance</h2>${filler('carry-on and checked baggage')}
        <h2>Flight refund policy</h2>
        <p>Refund requests for a cancelled flight must be filed within 30 days.</p>
        ${filler('the refund process step by step')}
        <h2>Online check-in</h2>${filler('check-in and boarding pass')}
      </main>
    `;
    // Query interamente in italiano; contenuto interamente in inglese.
    const text = extractPageText(document, 'come richiedo il rimborso di un volo cancellato?');
    expect(text).toContain('Refund requests');
    expect(text).not.toContain('boarding pass');
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

  it('mantiene i link con query-string e deduplica le varianti; scarta i topic (KB Salesforce)', () => {
    // Origin uguale a quello dei test (kb.example.com) ma path in stile
    // Salesforce Experience Cloud, con ?language / ?nocache / #.
    document.body.innerHTML = `
      <main>
        <a href="/Runway/s/article/Rimborso?language=en_US">Rimborso</a>
        <a href="/Runway/s/article/Rimborso?language=en_US#">Rimborso (fragment)</a>
        <a href="/Runway/s/article/Rimborso?nocache=abc123">Rimborso (cache-buster)</a>
        <a href="/Runway/s/topic/0TO5f000000/hotelscom">Hotels.com</a>
      </main>
    `;
    const links = extractInternalLinks(document);
    // Le tre varianti dell'articolo collassano in una (con ?language preservato);
    // il link topic è una pagina-lista, non un articolo → scartato da
    // rejectPathIncludes (`/s/topic/`), confermato sulla KB reale (Passa 0).
    expect(links.map((l) => l.url)).toEqual([
      'https://kb.example.com/Runway/s/article/Rimborso?language=en_US',
    ]);
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
