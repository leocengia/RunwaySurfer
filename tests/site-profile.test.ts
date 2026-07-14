import { describe, expect, it } from 'vitest';
import { linkIdentity, normalizeLinkUrl } from '../lib/site-profile';

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
