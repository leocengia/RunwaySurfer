// Articoli dedicati per vettore (D1 del tuning del routing).
import { describe, expect, it } from 'vitest';
import {
  carriersInQuery,
  dedicatedCarrierArticles,
  DEDICATED_CARRIER_BOOST,
} from '../lib/kb-carriers';

// I 10 codici verificati sull'indice reale (grep su lib/kb-index.json):
// Aeromexico, Air Canada, Alaska, American, British Airways, Delta, JetBlue,
// Lufthansa, United, WestJet.
const EXPECTED_CODES = ['am', 'ac', 'as', 'aa', 'ba', 'dl', 'b6', 'lh', 'ua', 'ws'].sort();

describe('dedicatedCarrierArticles · sull’indice KB reale', () => {
  it('risolve esattamente i 10 codici attesi (rete di sicurezza contro un rebuild che rinomini le label)', () => {
    const codes = [...dedicatedCarrierArticles().keys()].sort();
    expect(codes).toEqual(EXPECTED_CODES);
  });

  it('ogni codice risolve a un’identità di URL non vuota', () => {
    for (const [, identity] of dedicatedCarrierArticles()) {
      expect(identity).toMatch(/^https:\/\//);
    }
  });
});

describe('carriersInQuery', () => {
  it('riconosce il vettore per NOME (lufthansa)', () => {
    expect(carriersInQuery('policy schedule change riprotezione lufthansa')).toEqual(['lh']);
  });

  it('riconosce il vettore per CODICE nudo quando è sicuro (LH)', () => {
    expect(carriersInQuery('posso riproteggere il cliente per un volo LH')).toEqual(['lh']);
  });

  it('riconosce i vettori il cui codice collide con parole comuni SOLO per nome', () => {
    expect(carriersInQuery('policy aeromexico')).toEqual(['am']);
    expect(carriersInQuery('alaska airlines contatti')).toEqual(['as']);
  });

  it('NON riconosce "am"/"as"/"ac" come codice nudo (collisione con parole inglesi comuni)', () => {
    // Se ci riuscisse, "I am not sure" o "cancel as requested" attiverebbero
    // DEDICATED_CARRIER_BOOST su Aeromexico/Alaska per coincidenza.
    expect(carriersInQuery('I am not sure what to do')).toEqual([]);
    expect(carriersInQuery('cancel as requested please')).toEqual([]);
    expect(carriersInQuery('turn on the ac in the room')).toEqual([]);
  });

  it('un vettore SENZA articolo dedicato (Emirates) non produce nulla', () => {
    expect(carriersInQuery('devo cercare la policy di emirates')).toEqual([]);
  });

  it('nessun vettore nominato: array vuoto', () => {
    expect(carriersInQuery('quali sono tutti motivi di relocation?')).toEqual([]);
  });
});

describe('DEDICATED_CARRIER_BOOST', () => {
  it('è un numero positivo', () => {
    expect(DEDICATED_CARRIER_BOOST).toBeGreaterThan(0);
  });
});
