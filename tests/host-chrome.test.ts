// La misura dell'header del sito KB è euristica. Questi test fissano il contratto:
// cosa accetta, cosa scarta, e che senza candidati ritorni 0 invece di un numero
// inventato — perché chi chiama usa 0 per decidere di tenere il proprio default.
//
// Misurato poi sulla KB reale (pagina articolo, 2026-08-14):
// `[data-region-name="themeHeader"]` alto 64px, `position: static` — quindi
// scorrendo esce dal viewport. Da lì il caso "pagina già scrollata" qui sotto.
import { afterEach, describe, expect, it } from 'vitest';
import { findHostHeader, measureHostHeaderHeight, observeHostHeader } from '../lib/host-chrome';

const VIEWPORT_WIDTH = 1200;

/**
 * happy-dom non implementa elementsFromPoint (il codice di produzione la invoca
 * con optional call proprio per questo): qui la si installa per pilotare la sonda
 * geometrica.
 */
function stubElementsFromPoint(stack: Element[]): void {
  (document as unknown as { elementsFromPoint: () => Element[] }).elementsFromPoint = () => stack;
}

/**
 * happy-dom non fa layout: ogni rect è 0×0. Si sovrascrive
 * getBoundingClientRect sull'elemento, che è esattamente ciò che l'euristica
 * legge.
 */
function fakeBand(
  el: HTMLElement,
  rect: { top?: number; height: number; width?: number },
): HTMLElement {
  const box = {
    top: rect.top ?? 0,
    height: rect.height,
    width: rect.width ?? VIEWPORT_WIDTH,
    left: 0,
    right: rect.width ?? VIEWPORT_WIDTH,
    bottom: (rect.top ?? 0) + rect.height,
    x: 0,
    y: rect.top ?? 0,
  };
  el.getBoundingClientRect = () => ({ ...box, toJSON: () => box }) as DOMRect;
  return el;
}

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

/** Simula una pagina scrollata: `scrollY` è ciò che l'euristica somma a `top`. */
function scrollTo(y: number): void {
  Object.defineProperty(window, 'scrollY', { value: y, configurable: true });
}

afterEach(() => {
  document.body.innerHTML = '';
  scrollTo(0);
  delete (document as unknown as { elementsFromPoint?: unknown }).elementsFromPoint;
});

describe('measureHostHeaderHeight', () => {
  it('riconosce un candidato noto e ne riporta l’altezza', () => {
    const el = mount('<div class="themeHeader"></div>');
    fakeBand(el, { height: 76 });
    expect(measureHostHeaderHeight()).toBe(76);
  });

  it('accetta la tolleranza di 2px sul bordo alto (header sticky)', () => {
    const el = mount('<header role="banner"></header>');
    fakeBand(el, { top: 1, height: 64 });
    expect(measureHostHeaderHeight()).toBe(64);
  });

  it('scarta un elemento troppo basso per essere una testata', () => {
    fakeBand(mount('<div class="themeHeader"></div>'), { height: 12 });
    expect(measureHostHeaderHeight()).toBe(0);
  });

  it('scarta un elemento troppo alto (è il contenitore della pagina)', () => {
    fakeBand(mount('<div class="themeHeader"></div>'), { height: 900 });
    expect(measureHostHeaderHeight()).toBe(0);
  });

  it('scarta un elemento che non tocca il bordo alto', () => {
    fakeBand(mount('<div class="themeHeader"></div>'), { top: 300, height: 60 });
    expect(measureHostHeaderHeight()).toBe(0);
  });

  it('misura l’header anche su una pagina GIÀ SCROLLATA', () => {
    // L'header della KB reale è `position: static`: dopo 800px di scroll il suo
    // rect.top è -800 e non è più nel viewport. Ma resta in cima al DOCUMENTO, e
    // la sua altezza è quella a cui allinearsi. Senza questo caso, una sidebar
    // che si monta su una pagina già scrollata misurerebbe 0 e collasserebbe al
    // fallback.
    scrollTo(800);
    fakeBand(mount('<div data-region-name="themeHeader"></div>'), { top: -800, height: 64 });
    expect(measureHostHeaderHeight()).toBe(64);
  });

  it('su pagina scrollata NON confonde il contenuto con la testata', () => {
    // Un elemento a metà articolo: né in cima al viewport né in cima al documento.
    scrollTo(800);
    fakeBand(mount('<div class="themeHeader"></div>'), { top: 40, height: 60 });
    expect(measureHostHeaderHeight()).toBe(0);
  });

  it('un header sticky resta valido a pagina scrollata', () => {
    // Caso opposto: resta a top 0 nel viewport ma non è in cima al documento.
    scrollTo(800);
    fakeBand(mount('<div class="themeHeader"></div>'), { top: 0, height: 56 });
    expect(measureHostHeaderHeight()).toBe(56);
  });

  it('scarta un elemento troppo stretto (è un widget, non una banda)', () => {
    fakeBand(mount('<div class="themeHeader"></div>'), { height: 60, width: 200 });
    expect(measureHostHeaderHeight()).toBe(0);
  });

  it('scarta un elemento invisibile', () => {
    const el = mount('<div class="themeHeader" style="display:none"></div>');
    fakeBand(el, { height: 60 });
    expect(measureHostHeaderHeight()).toBe(0);
  });

  it('ritorna 0 quando non c’è alcun candidato', () => {
    document.body.innerHTML = '<div class="qualcosa-altro"></div>';
    expect(measureHostHeaderHeight()).toBe(0);
  });

  it('ripiega sulla sonda geometrica quando nessun selettore combacia', () => {
    // Nome di classe sconosciuto: solo elementsFromPoint può trovarlo. È il caso
    // reale se Salesforce rinomina le classi del tema.
    const el = mount('<div class="classe-mai-vista"></div>');
    fakeBand(el, { height: 72 });
    stubElementsFromPoint([el, document.body]);
    expect(measureHostHeaderHeight()).toBe(72);
  });

  it('la sonda sceglie il contenitore, non il figlio', () => {
    const outer = mount('<div class="ignota"><span class="pure-ignota"></span></div>');
    const inner = outer.firstElementChild as HTMLElement;
    fakeBand(outer, { height: 80 });
    fakeBand(inner, { height: 40 });
    // elementsFromPoint va dal più interno al più esterno.
    stubElementsFromPoint([inner, outer, document.body]);
    expect(measureHostHeaderHeight()).toBe(80);
  });
});

describe('findHostHeader', () => {
  it('preferisce il candidato per nome alla sonda', () => {
    document.body.innerHTML =
      '<div class="ignota"></div><div data-region-name="themeHeader"></div>';
    const [probe, named] = Array.from(document.body.children) as HTMLElement[];
    fakeBand(probe, { height: 70 });
    fakeBand(named, { height: 50 });
    stubElementsFromPoint([probe, document.body]);
    expect(findHostHeader()).toBe(named);
  });
});

describe('observeHostHeader', () => {
  it('notifica subito l’altezza misurata', () => {
    fakeBand(mount('<div class="themeHeader"></div>'), { height: 76 });
    const seen: number[] = [];
    const dispose = observeHostHeader((px) => seen.push(px));
    expect(seen).toEqual([76]);
    dispose();
  });

  it('un override manuale vince sulla misura e non osserva nulla', () => {
    // È la via di fuga se l'euristica sceglie l'elemento sbagliato sulla KB reale.
    fakeBand(mount('<div class="themeHeader"></div>'), { height: 76 });
    const seen: number[] = [];
    const dispose = observeHostHeader((px) => seen.push(px), { override: 88 });
    expect(seen).toEqual([88]);
    dispose();
  });

  it('notifica 0 quando non trova nulla, così chi chiama tiene il default', () => {
    document.body.innerHTML = '';
    const seen: number[] = [];
    const dispose = observeHostHeader((px) => seen.push(px));
    expect(seen).toEqual([0]);
    dispose();
  });

  it('rimisura al resize della finestra', () => {
    const el = mount('<div class="themeHeader"></div>');
    fakeBand(el, { height: 76 });
    const seen: number[] = [];
    const dispose = observeHostHeader((px) => seen.push(px));
    fakeBand(el, { height: 48 }); // il tema si ricompone su viewport stretta
    window.dispatchEvent(new Event('resize'));
    expect(seen).toEqual([76, 48]);
    dispose();
  });

  it('non ri-notifica un valore identico', () => {
    const el = mount('<div class="themeHeader"></div>');
    fakeBand(el, { height: 76 });
    const seen: number[] = [];
    const dispose = observeHostHeader((px) => seen.push(px));
    window.dispatchEvent(new Event('resize'));
    expect(seen).toEqual([76]);
    dispose();
  });

  it('il disposer stacca i listener', () => {
    const el = mount('<div class="themeHeader"></div>');
    fakeBand(el, { height: 76 });
    const seen: number[] = [];
    observeHostHeader((px) => seen.push(px))();
    fakeBand(el, { height: 40 });
    window.dispatchEvent(new Event('resize'));
    expect(seen).toEqual([76]);
  });
});
