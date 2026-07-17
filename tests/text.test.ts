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
