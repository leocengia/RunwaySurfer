import { describe, expect, it } from 'vitest';
import { conceptsInQuery, expandQueryTerms, INTENT_ALIASES } from '../lib/kb-vocab';

describe('conceptsInQuery', () => {
  it('riconosce i concetti anche da alias italiani', () => {
    const concepts = conceptsInQuery('come chiedo il rimborso del volo?');
    expect(concepts).toContain('refund');
    expect(concepts).toContain('flight');
  });

  it('non inventa concetti su query fuori dominio', () => {
    expect(conceptsInQuery('meteo di domani')).toEqual([]);
  });
});

describe('expandQueryTerms', () => {
  it('aggiunge i termini EN del concetto colpito da una query IT', () => {
    // Uso reale: le keyword base della query vengono passate come `existing`,
    // così l'espansione porta i termini nuovi (EN) senza ripetere l'IT gia' noto.
    const extra = expandQueryTerms('voglio il rimborso', ['voglio', 'rimborso']);
    expect(extra).toContain('refund'); // EN, assente nella query IT
    expect(extra).not.toContain('rimborso'); // gia' fra le keyword base
  });

  it('non ripete i termini gia presenti', () => {
    const extra = expandQueryTerms('refund policy', ['refund', 'policy']);
    expect(extra).not.toContain('refund');
  });
});

describe('INTENT_ALIASES', () => {
  it('e un vocabolario di dominio aviazione/travel', () => {
    expect(Object.keys(INTENT_ALIASES)).toEqual(
      expect.arrayContaining(['refund', 'cancel', 'flight', 'baggage', 'lodging', 'billing']),
    );
    // niente residui e-commerce del vecchio vocabolario
    expect(INTENT_ALIASES).not.toHaveProperty('delivery');
    expect(INTENT_ALIASES).not.toHaveProperty('order');
  });
});
