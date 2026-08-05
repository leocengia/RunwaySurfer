// Il campo "Impacted Itinerary (City Pair)" è un unico input libero: gli agenti
// ci scrivono sigle o nomi di città, indifferentemente. La ricerca in KB funziona
// sui codici, quindi la normalizzazione è parte del percorso — e ciò che non si
// risolve deve passare intatto, non essere indovinato.
import { describe, expect, it } from 'vitest';
import { parseCityPair } from '../src/itinerary.js';

describe('parseCityPair', () => {
  it('converte i nomi di città in codici', () => {
    expect(parseCityPair('Milano-Parigi').normalized).toBe('MIL-PAR');
  });

  it('lascia intatti i codici già scritti come tali', () => {
    expect(parseCityPair('MIL-PAR').normalized).toBe('MIL-PAR');
    expect(parseCityPair('mil-par').normalized).toBe('MIL-PAR');
  });

  it('accetta i separatori che gli agenti usano davvero', () => {
    for (const input of [
      'Milano - Parigi',
      'Milano/Parigi',
      'Milano > Parigi',
      'Milano → Parigi',
    ]) {
      expect(parseCityPair(input).normalized).toBe('MIL-PAR');
    }
  });

  it('accetta "to" e "a" come separatori', () => {
    expect(parseCityPair('Milano to Parigi').normalized).toBe('MIL-PAR');
    expect(parseCityPair('Milano a Parigi').normalized).toBe('MIL-PAR');
  });

  it('gestisce i nomi composti con lo spazio', () => {
    expect(parseCityPair('New York - Londra').normalized).toBe('NYC-LON');
  });

  it('è indifferente alla lingua del nome', () => {
    expect(parseCityPair('Munich-Rome').normalized).toBe('MUC-ROM');
    expect(parseCityPair('Monaco-Roma').normalized).toBe('MUC-ROM');
  });

  it('passa intatto ciò che non sa risolvere, e lo segnala', () => {
    const out = parseCityPair('Vattelapesca-Parigi');
    expect(out.normalized).toBe('Vattelapesca-PAR');
    expect(out.unresolved).toEqual(['Vattelapesca']);
  });

  it('senza separatore restituisce una parte singola invece di indovinare', () => {
    const out = parseCityPair('Milano');
    expect(out.parts).toEqual(['MIL']);
    expect(out.normalized).toBe('MIL');
  });

  it('input vuoto → nessuna parte', () => {
    expect(parseCityPair('')).toEqual({ normalized: '', parts: [], unresolved: [] });
    expect(parseCityPair('   ').parts).toEqual([]);
  });

  it('regge una tratta con scalo', () => {
    expect(parseCityPair('MIL-FRA-NYC').normalized).toBe('MIL-FRA-NYC');
  });
});
