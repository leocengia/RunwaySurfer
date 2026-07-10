import { describe, expect, it } from 'vitest';
import { findTourTargetUrl, sourceSection, urlsIn } from '../lib/tour-target';
import type { KbPage } from '../lib/outcome';

function page(url: string, origin: 'current' | 'followed'): KbPage {
  return { url, title: url, text: '', origin };
}

const START = 'https://kb.example.com/wiki/Start';
const FOLLOWED = 'https://kb.example.com/wiki/Dettaglio';

describe('urlsIn', () => {
  it('estrae gli URL ripulendo la punteggiatura finale', () => {
    expect(
      urlsIn('vedi https://kb.example.com/wiki/A, e (https://kb.example.com/wiki/B).'),
    ).toEqual(['https://kb.example.com/wiki/A', 'https://kb.example.com/wiki/B']);
  });
});

describe('sourceSection', () => {
  it('isola la sezione ## Fonti fino alla sezione successiva', () => {
    const md = '## Procedura\npassi\n## Fonti\n- https://a\n- https://b\n## Note\naltro';
    expect(sourceSection(md)).toBe('- https://a\n- https://b');
  });

  it("restituisce '' se la sezione manca", () => {
    expect(sourceSection('## Procedura\npassi')).toBe('');
  });
});

describe('findTourTargetUrl', () => {
  const pages = [page(START, 'current'), page(FOLLOWED, 'followed')];

  it('preferisce le pagine followed citate nelle Fonti', () => {
    const md = `## Procedura\nx\n## Fonti\n- ${START}\n- ${FOLLOWED}`;
    expect(findTourTargetUrl(md, pages)).toBe(FOLLOWED);
  });

  it('ripiega sulla pagina corrente se le Fonti citano solo quella', () => {
    const md = `## Fonti\n- ${START}`;
    expect(findTourTargetUrl(md, pages)).toBe(START);
  });

  it('senza sezione Fonti usa gli URL citati nel testo', () => {
    const md = `La risposta arriva da ${FOLLOWED}.`;
    expect(findTourTargetUrl(md, pages)).toBe(FOLLOWED);
  });

  it('ignora URL che non corrispondono a pagine lette', () => {
    const md = '## Fonti\n- https://kb.example.com/wiki/Mai_letta';
    expect(findTourTargetUrl(md, pages)).toBeNull();
  });

  it('il confronto ignora i fragment', () => {
    const md = `## Fonti\n- ${FOLLOWED}#sezione`;
    expect(findTourTargetUrl(md, pages)).toBe(FOLLOWED);
  });
});
