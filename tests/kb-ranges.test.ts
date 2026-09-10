// Intervalli alfabetici della KB (Giro 4, causa n.1 del sondaggio agenti).
//
// La KB archivia i vettori per iniziale — l'articolo che risponde a «ASC
// lufthansa policy» è `Global airline schedule change policies I L`, perché
// Lufthansa comincia per L — e quel titolo non contiene né «lufthansa» né «ASC».
//
// Le label usate qui sono TUTTE prese dall'indice reale, refusi di Salesforce
// compresi (`POSa`), perché il valore del parser sta nel reggere quelle vere.
import { describe, expect, it } from 'vitest';
import { nameInitials, parseKbRange, rangeCovers, rangeInitialBoost } from '../lib/kb-ranges';
import { shortlistCandidates, SHORTLIST_SIZE } from '../lib/crawl';

describe('parseKbRange · riconosce le label a intervallo', () => {
  it('due lettere in coda', () => {
    expect(parseKbRange('Global airline schedule change policies I L')).toEqual({
      family: 'Global airline schedule change policies',
      from: 'I',
      to: 'L',
    });
  });

  it('una lettera sola in coda (nell’indice esiste un unico caso)', () => {
    expect(parseKbRange('Global airline schedule change policies A')).toEqual({
      family: 'Global airline schedule change policies',
      from: 'A',
      to: 'A',
    });
  });

  it('minuscole: la KB non è coerente nemmeno con se stessa', () => {
    expect(parseKbRange('AMER Airline schedule change policies a b')).toEqual({
      family: 'AMER Airline schedule change policies',
      from: 'A',
      to: 'B',
    });
  });

  it('intervallo in mezzo alla label, con un suffisso dopo', () => {
    // La regione resta nella famiglia: è ciò che distingue APAC da EMEA.
    expect(parseKbRange('Airline contacts for JP POSa A C APAC')).toEqual({
      family: 'Airline contacts for JP POSa APAC',
      from: 'A',
      to: 'C',
    });
  });

  it('ignora l’ID articolo Salesforce in coda', () => {
    expect(parseKbRange('Car Contacts K Q 1694551644510')?.family).toBe('Car Contacts');
  });

  it('la stessa famiglia per tutti i fratelli', () => {
    const families = [
      'Global airline schedule change policies A',
      'Global airline schedule change policies B D',
      'Global airline schedule change policies I L',
      'Global airline schedule change policies S Z',
    ].map((l) => parseKbRange(l)?.family);
    expect(new Set(families).size).toBe(1);
  });
});

describe('parseKbRange · NON è un intervallo', () => {
  it('un intervallo discendente: «only U.S.» non è da U a S', () => {
    // Falso positivo reale dell'indice: `Hotwire Account Holder Data Requests
    // only U S`. Il filtro crescente è ciò che lo scarta.
    expect(parseKbRange('Hotwire Account Holder Data Requests only U S')).toBeNull();
  });

  it('l’altro discendente dell’indice', () => {
    expect(parseKbRange('Handle inquiries from TPG team Global English team S O')).toBeNull();
  });

  it('una label normale', () => {
    expect(parseKbRange('Billing Refund Refund a duplicate booking')).toBeNull();
  });

  it('una label che finisce per caso con una lettera ma non ha famiglia', () => {
    expect(parseKbRange('Piano B')).toBeNull();
  });
});

describe('rangeCovers', () => {
  const range = { family: 'x', from: 'I', to: 'L' };

  it('copre gli estremi', () => {
    expect(rangeCovers(range, 'I')).toBe(true);
    expect(rangeCovers(range, 'L')).toBe(true);
  });

  it('L di Lufthansa sta in I-L, non in S-Z', () => {
    expect(rangeCovers(range, 'l')).toBe(true);
    expect(rangeCovers({ family: 'x', from: 'S', to: 'Z' }, 'L')).toBe(false);
  });
});

describe('nameInitials', () => {
  it('prende l’iniziale del vettore', () => {
    expect(nameInitials('ASC lufthansa policy')).toContain('L');
  });

  it('scarta le stop-word italiane: «dimmi» e «tutte» non sono vettori', () => {
    const initials = nameInitials('dimmi tutte le casistiche di riprotezione');
    expect(initials).not.toContain('D');
    expect(initials).not.toContain('T');
  });

  it('scarta i termini del vocabolario di dominio', () => {
    // `riprotezione` e `policy` sono vocabolario, non nomi propri.
    expect(nameInitials('riprotezione policy')).toEqual([]);
  });

  it('un codice vettore dà l’iniziale del NOME, non del codice', () => {
    // TK → turkish → T. «turkish» non compare in nessun titolo della KB:
    // senza questo passaggio non c'è modo di raggiungere l'intervallo S-Z.
    const initials = nameInitials('schedule change policy TK');
    expect(initials).toContain('T');
  });
});

describe('rangeInitialBoost', () => {
  it('premia il fratello che copre l’iniziale', () => {
    expect(rangeInitialBoost('Global airline schedule change policies I L', ['L'])).toBeGreaterThan(
      0,
    );
  });

  it('non premia i fratelli che non la coprono', () => {
    expect(rangeInitialBoost('Global airline schedule change policies B D', ['L'])).toBe(0);
  });

  it('non premia una label che non è un intervallo', () => {
    expect(rangeInitialBoost('EMEA Airline schedule change policies', ['L'])).toBe(0);
  });

  it('senza iniziali non fa nulla', () => {
    expect(rangeInitialBoost('Global airline schedule change policies I L', [])).toBe(0);
  });
});

// Il test che vale il giro: sull'indice KB reale, non su fixture.
describe('sull’indice KB reale', () => {
  /** Rank (1-based) della label attesa nella shortlist, o -1 se assente. */
  function rankOf(query: string, expectedLabel: string): number {
    const shortlist = shortlistCandidates([], query, SHORTLIST_SIZE);
    const i = shortlist.findIndex((l) => l.text.replace(/\s+\d{10,}$/, '') === expectedLabel);
    return i === -1 ? -1 : i + 1;
  }

  it('«ASC lufthansa policy» trova l’articolo dell’intervallo I-L', () => {
    // Prima del Giro 4 questa query non lo raggiungeva affatto: l'acronimo ASC
    // veniva scartato dal tokenizzatore e `policy` non matcha `policies`.
    const rank = rankOf('ASC lufthansa policy', 'Global airline schedule change policies I L');
    expect(rank).toBeGreaterThan(0);
    expect(rank).toBeLessThanOrEqual(5);
  });

  it('il fratello giusto batte gli altri della sua famiglia', () => {
    // Il punto del bonus: senza di esso i fratelli pareggiano e vince il primo
    // in ordine di URL, cioè `… policies A`. Conta sul percorso locale, quando
    // `/rank` scade e non c'è alcuna AI a rimediare.
    const shortlist = shortlistCandidates([], 'ASC lufthansa policy', SHORTLIST_SIZE);
    const family = shortlist.filter((l) =>
      l.text.startsWith('Global airline schedule change policies'),
    );
    expect(family.length).toBeGreaterThan(1);
    const best = family[0];
    expect(best.text).toContain('I L');
  });

  it('un codice vettore raggiunge l’intervallo giusto: TK → S-Z', () => {
    const rank = rankOf('schedule change policy TK', 'Global airline schedule change policies S Z');
    expect(rank).toBeGreaterThan(0);
    expect(rank).toBeLessThanOrEqual(5);
  });

  it('la domanda lunga e a elenco arriva comunque in shortlist', () => {
    // Una delle 3 richieste di elenco esaustivo del sondaggio. Non contiene
    // lessicalmente né «schedule» né «change» né «policy»: ci arriva solo grazie
    // al ponte concettuale riprotezione → schedule change (CONCEPT_KB_TERMS).
    const rank = rankOf(
      'dimmi tutte le casistiche di riprotezione per volo cancellato da lufthansa',
      'Global airline schedule change policies I L',
    );
    expect(rank).toBeGreaterThan(0);
  });

  it('una famiglia diversa, per provare che non è cucito su un caso solo', () => {
    // Hertz → H → `Flight ADM IAR Errors G I`.
    const rank = rankOf('adm iar error hertz', 'Flight ADM IAR Errors G I');
    expect(rank).toBeGreaterThan(0);
    expect(rank).toBeLessThanOrEqual(5);
  });
});
