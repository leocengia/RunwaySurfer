import { describe, expect, it } from 'vitest';
import {
  anchoredTermsInQuery,
  conceptsInQuery,
  expandQueryTerms,
  expandTerm,
  INTENT_ALIASES,
} from '../lib/kb-vocab';

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

// Giro 4 — le forme che gli agenti hanno DAVVERO scritto nel sondaggio.
describe('flessioni italiane e singolare/plurale', () => {
  it('`policy` porta al concetto, e il concetto porta a `policies`', () => {
    // La coppia che mancava: `policies` ha 109 label nell'indice contro le 57 di
    // `policy`, e `policy` compare in 6 delle 27 query reali.
    expect(conceptsInQuery('ASC lufthansa policy')).toContain('policy');
    expect(expandQueryTerms('ASC lufthansa policy', ['lufthansa'])).toContain('policies');
  });

  it.each([
    ['riproteggere', 'relocation'],
    ['riprotezioni', 'relocation'],
    ['pacchetti', 'package'],
    ['compensazioni', 'compensation'],
    ['reclami', 'escalate'],
    ['contatti', 'contact'],
    ['casistiche', 'scenario'],
  ])('«%s» riconosce il concetto %s', (word, concept) => {
    expect(conceptsInQuery(word)).toContain(concept);
  });
});

describe('acronimi', () => {
  it('ASC si espande nelle parole che la KB usa per esteso', () => {
    const extra = expandQueryTerms('ASC lufthansa policy', ['lufthansa']);
    expect(extra).toEqual(expect.arrayContaining(['airline', 'schedule', 'change']));
  });

  it('anchoredTermsInQuery restituisce solo gli acronimi che la KB scrive', () => {
    // `ndc` compare in 19 titoli → va cercato letteralmente. `lhg` in nessuno →
    // serve solo per l'espansione, e qui non deve comparire.
    expect(anchoredTermsInQuery('ndc emea')).toEqual(expect.arrayContaining(['ndc', 'emea']));
    expect(anchoredTermsInQuery('policy LHG')).not.toContain('lhg');
  });

  it('un codice vettore si espande nel nome della compagnia', () => {
    expect(expandQueryTerms('schedule change policy LH', [])).toContain('lufthansa');
  });
});

describe('expandTerm · le espansioni di UN solo termine', () => {
  it('attribuisce a `regole` solo le espansioni di policy', () => {
    const terms = expandTerm('regole');
    expect(terms).toContain('policies');
    // …e non quelle dei bagagli, che appartengono a un'altra parola: è il guasto
    // che faceva risultare in tema «regole franchigia baggage allowance» su un
    // articolo intitolato «Refund policy».
    expect(terms).not.toContain('baggage');
  });

  it('riconosce il concetto dentro una forma flessa', () => {
    // `cancel` è sottostringa di `cancellato`.
    expect(expandTerm('cancellato')).toContain('cancelled');
  });

  it('non restituisce il termine stesso', () => {
    expect(expandTerm('rimborso')).not.toContain('rimborso');
  });

  it('su una parola fuori dominio non inventa nulla', () => {
    expect(expandTerm('franchigia')).toEqual([]);
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
