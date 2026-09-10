// Individuazione e click dell'anchor sulla pagina host.
//
// Questi test nascono da un guasto osservato sulla KB reale: il tour apriva una
// SCHEDA NUOVA, la pagina di partenza non cambiava route, l'attesa del render
// scadeva a vuoto e il driver tornava indietro da una pagina che non si era
// mossa — portando l'agente fuori dall'hub. La causa erano due scelte innocue in
// apparenza: cercare l'anchor in tutto il documento e prendere il primo, e
// cliccarlo senza guardare `target`.
import { afterEach, describe, expect, it } from 'vitest';
import { clickInSameTab, findLinkElement } from '../lib/highlight';

const ARTICLE = 'https://kb.example.com/wiki/Rimborso';

/** happy-dom non fa layout: i rect vanno imposti a mano dove contano. */
function withRect(el: HTMLElement, width: number, height: number): HTMLElement {
  const box = { top: 0, left: 0, right: width, bottom: height, width, height, x: 0, y: 0 };
  el.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect;
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findLinkElement · quale anchor', () => {
  it('trova l’anchor per identità di path, ignorando i parametri', () => {
    document.body.innerHTML = `<main role="main"><a href="${ARTICLE}?language=it&nocache=1">Rimborso</a></main>`;
    const found = findLinkElement(`${ARTICLE}?language=en_US`);
    expect(found).not.toBeNull();
    expect(found?.textContent).toBe('Rimborso');
  });

  it('IGNORA il duplicato fuori dal content-root, dov’è il target="_blank"', () => {
    // È il caso reale: la KB ripete gli articoli nel menu di testata, con
    // target="_blank". Cercando in tutto il documento si prendeva quello, perché
    // viene prima in ordine di documento.
    document.body.innerHTML = `
      <nav><a id="menu" href="${ARTICLE}" target="_blank">Rimborso</a></nav>
      <main role="main"><a id="content" href="${ARTICLE}">Rimborso</a></main>`;
    withRect(document.getElementById('menu')!, 100, 20);
    withRect(document.getElementById('content')!, 300, 20);
    expect(findLinkElement(ARTICLE)?.id).toBe('content');
  });

  it('fra più anchor nel content-root prende quello visibile più grande', () => {
    // Lo stesso articolo può comparire nel corpo e nel pannello Suggested; un
    // anchor nascosto ha rect a zero e darebbe coordinate degeneri alle animazioni.
    document.body.innerHTML = `
      <main role="main">
        <a id="hidden" href="${ARTICLE}">Rimborso</a>
        <a id="visible" href="${ARTICLE}">Rimborso — policy</a>
      </main>`;
    withRect(document.getElementById('hidden')!, 0, 0);
    withRect(document.getElementById('visible')!, 280, 18);
    expect(findLinkElement(ARTICLE)?.id).toBe('visible');
  });

  it('ritorna null se l’anchor non è nel content-root', () => {
    // Chi chiama ha una via alternativa (navigazione esplicita) più sicura del
    // click su una voce di menu.
    document.body.innerHTML = `
      <nav><a href="${ARTICLE}" target="_blank">Rimborso</a></nav>
      <main role="main"><p>nessun link</p></main>`;
    expect(findLinkElement(ARTICLE)).toBeNull();
  });

  it('ritorna null su URL non valido invece di lanciare', () => {
    document.body.innerHTML = '<main role="main"></main>';
    expect(findLinkElement('http://[non-un-url')).toBeNull();
  });

  it('tollera href malformati fra i candidati', () => {
    document.body.innerHTML = `
      <main role="main">
        <a href="http://[rotto">rotto</a>
        <a id="ok" href="${ARTICLE}">Rimborso</a>
      </main>`;
    withRect(document.getElementById('ok')!, 200, 18);
    expect(findLinkElement(ARTICLE)?.id).toBe('ok');
  });
});

describe('clickInSameTab', () => {
  it('rimuove target durante il click e lo RIPRISTINA dopo', () => {
    document.body.innerHTML = `<a id="a" href="${ARTICLE}" target="_blank" rel="noopener">Rimborso</a>`;
    const anchor = document.getElementById('a') as HTMLAnchorElement;
    let targetDuringClick: string | null = 'non-osservato';
    anchor.addEventListener('click', (event) => {
      event.preventDefault(); // in happy-dom la navigazione non serve
      targetDuringClick = anchor.getAttribute('target');
    });

    clickInSameTab(anchor);

    // Durante il click l'attributo non c'era: è ciò che impedisce la scheda nuova.
    expect(targetDuringClick).toBeNull();
    // Dopo, la pagina host è esattamente come l'abbiamo trovata.
    expect(anchor.getAttribute('target')).toBe('_blank');
    expect(anchor.getAttribute('rel')).toBe('noopener');
  });

  it('non inventa attributi su un anchor che non li aveva', () => {
    document.body.innerHTML = `<a id="a" href="${ARTICLE}">Rimborso</a>`;
    const anchor = document.getElementById('a') as HTMLAnchorElement;
    anchor.addEventListener('click', (event) => event.preventDefault());
    clickInSameTab(anchor);
    expect(anchor.hasAttribute('target')).toBe(false);
    expect(anchor.hasAttribute('rel')).toBe(false);
  });

  it('ripristina gli attributi anche se un handler lancia', () => {
    // Un handler della pagina host può lanciare: senza il finally l'anchor
    // resterebbe senza target, cioè avremmo modificato la pagina della KB.
    document.body.innerHTML = `<a id="a" href="${ARTICLE}" target="_blank">Rimborso</a>`;
    const anchor = document.getElementById('a') as HTMLAnchorElement;
    anchor.addEventListener('click', () => {
      throw new Error('handler della KB');
    });
    expect(() => clickInSameTab(anchor)).toThrow();
    expect(anchor.getAttribute('target')).toBe('_blank');
  });
});
