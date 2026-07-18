import { describe, expect, it } from 'vitest';
import { linkIdentity, normalizeLinkUrl, withRetrievalLanguage } from '../lib/site-profile';

const BASE = 'https://traveler.my.site.com/Runway/s/article/Rimborso';

describe('normalizeLinkUrl', () => {
  it('preserva ?language e rimuove fragment e param non essenziali', () => {
    expect(normalizeLinkUrl(new URL(`${BASE}?language=it&nocache=xyz#sezione`))).toBe(
      `${BASE}?language=it`,
    );
  });

  it('lascia gli URL senza query invariati (a parte il fragment)', () => {
    expect(normalizeLinkUrl(new URL('https://kb.example.com/wiki/Rimborsi#note'))).toBe(
      'https://kb.example.com/wiki/Rimborsi',
    );
  });
});

describe('linkIdentity', () => {
  it('collassa le varianti della stessa pagina (query e fragment ignorati)', () => {
    const a = linkIdentity(new URL(`${BASE}?language=en_US`));
    const b = linkIdentity(new URL(`${BASE}?nocache=abc`));
    const c = linkIdentity(new URL(`${BASE}#top`));
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(a).toBe(BASE);
  });

  it('distingue pagine con path diverso', () => {
    expect(linkIdentity(new URL(`${BASE}`))).not.toBe(
      linkIdentity(new URL('https://traveler.my.site.com/Runway/s/topic/0TO/hotels')),
    );
  });

  it('ignora la slash finale', () => {
    expect(linkIdentity(new URL('https://traveler.my.site.com/Runway/s/'))).toBe(
      linkIdentity(new URL('https://traveler.my.site.com/Runway/s')),
    );
  });
});

describe('withRetrievalLanguage', () => {
  it('forza ?language=en_US sostituendo una lingua diversa', () => {
    expect(withRetrievalLanguage(`${BASE}?language=de`)).toBe(`${BASE}?language=en_US`);
    expect(withRetrievalLanguage(`${BASE}?language=ko`)).toBe(`${BASE}?language=en_US`);
  });

  it('aggiunge ?language=en_US se assente, preservando il resto', () => {
    expect(withRetrievalLanguage(BASE)).toBe(`${BASE}?language=en_US`);
  });

  it('non tocca gli URL già in en_US e non altera path/identità', () => {
    const out = withRetrievalLanguage(`${BASE}?language=en_US`);
    expect(out).toBe(`${BASE}?language=en_US`);
    expect(linkIdentity(new URL(out))).toBe(BASE);
  });

  it('ritorna invariato un input non parsabile', () => {
    expect(withRetrievalLanguage('non-un-url')).toBe('non-un-url');
  });
});
