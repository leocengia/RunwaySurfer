import { describe, expect, it } from 'vitest';
import { countKeywords, matchedKeywords, normalize, unique, wordsOf } from '../lib/text';

describe('normalize', () => {
  it('rimuove diacritici e porta in minuscolo', () => {
    expect(normalize('Rimborsò È')).toBe('rimborso e');
  });
});

describe('wordsOf', () => {
  it('tiene solo token >3 non stop-word, deduplicando di default', () => {
    // "come" e "il" cadono (stop-word / troppo corta); "rimborso" ripetuto → una volta.
    expect(wordsOf('come il rimborso rimborso ordine')).toEqual(['rimborso', 'ordine']);
  });

  it('con dedupe=false conserva le ripetizioni (segnale per il retrieval)', () => {
    expect(wordsOf('rimborso rimborso ordine', false)).toEqual(['rimborso', 'rimborso', 'ordine']);
  });
});

describe('matchedKeywords', () => {
  it('trova le keyword presenti (insensibile ad accenti/maiuscole)', () => {
    expect(matchedKeywords('Procedura di RIMBORSÒ ordine', ['rimborso', 'volo'])).toEqual([
      'rimborso',
    ]);
  });

  it('resta sottostringa per default: `policies` copre una query su `polic`', () => {
    expect(matchedKeywords('Refund policies', ['polic'])).toEqual(['polic']);
  });

  describe('con termini ancorati (acronimi)', () => {
    const anchored = new Set(['asc', 'ndc']);

    it('un acronimo matcha come parola intera', () => {
      expect(matchedKeywords('Flight ASC Farelogix Rebook a flight', ['asc'], anchored)).toEqual([
        'asc',
      ]);
    });

    it('e NON come sottostringa: sono tre falsi positivi reali dell’indice', () => {
      for (const label of [
        'Madagascar Nationwide Civil Unrest September 2025',
        'Billing Charge TAAP Agency Service Charge TASC',
        'Vuelo Reservar Politica de mascotas global',
      ]) {
        expect(matchedKeywords(label, ['asc'], anchored)).toEqual([]);
      }
    });

    it('i termini NON ancorati restano sottostringa nella stessa chiamata', () => {
      // `refund` non è nell'insieme ancorato: continua a matchare dentro `refunds`.
      expect(matchedKeywords('Cancel NDC refunds', ['ndc', 'refund'], anchored)).toEqual([
        'ndc',
        'refund',
      ]);
    });
  });
});

describe('countKeywords', () => {
  it('conta le presenze (una keyword ripetuta pesa di più, come lo storico scoreText)', () => {
    expect(countKeywords('rimborso ordine', ['rimborso', 'rimborso', 'volo'])).toBe(2);
  });
});

describe('unique', () => {
  it('rimuove i duplicati mantenendo l’ordine', () => {
    expect(unique([1, 2, 2, 3, 1])).toEqual([1, 2, 3]);
  });
});
