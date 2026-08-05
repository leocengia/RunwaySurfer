// Rilevamento "la domanda non c'entra con la pagina aperta". È la decisione che
// evita la risposta strutturalmente sbagliata quando l'agente chiede altro
// rispetto all'articolo che ha davanti — e allo stesso tempo NON deve allargare a
// vuoto quando l'articolo aperto è l'unico posto dove la risposta esiste.
import { describe, expect, it } from 'vitest';
import { isOffTopic, pageCoverage } from '../lib/off-topic';
import type { KbLink, KbPage } from '../lib/outcome';

const REFUND_PAGE: Pick<KbPage, 'title' | 'text' | 'url'> = {
  url: 'https://kb.example.com/s/article/Refund-policy-cancelled-flight',
  title: 'Flight | Policies | Refund for cancelled flight',
  text: 'Refund policy for a cancelled flight. Rimborso del biglietto quando il volo è cancellato dal vettore. Procedura di rimborso e tempistiche.',
};

const candidate = (slug: string, text: string): KbLink => ({
  url: `https://kb.example.com/s/article/${slug}`,
  text,
});

const BAGGAGE = candidate(
  'Baggage-allowance-rules',
  'Baggage | Allowance and excess baggage rules',
);
const NAME_CHANGE = candidate('Name-correction-ticket', 'Ticketing | Name correction on a ticket');

describe('pageCoverage', () => {
  it('è alta quando la domanda parla di ciò che la pagina tratta', () => {
    expect(pageCoverage(REFUND_PAGE, 'rimborso volo cancellato')).toBeGreaterThan(0.5);
  });

  it('è bassa quando la domanda parla di altro', () => {
    expect(pageCoverage(REFUND_PAGE, 'franchigia bagaglio a mano')).toBeLessThan(0.34);
  });

  it('senza termini utili non giudica (ritorna 1, cioè non allargare)', () => {
    expect(pageCoverage(REFUND_PAGE, 'e poi?')).toBe(1);
  });
});

describe('isOffTopic', () => {
  it('riconosce la domanda fuori tema quando esiste un articolo migliore', () => {
    expect(isOffTopic(REFUND_PAGE, 'regole franchigia baggage allowance', [BAGGAGE])).toBe(true);
  });

  it('NON allarga se la domanda è sul tema della pagina', () => {
    expect(isOffTopic(REFUND_PAGE, 'rimborso volo cancellato', [BAGGAGE, NAME_CHANGE])).toBe(false);
  });

  it('NON allarga senza candidati: allargare non porterebbe da nessuna parte', () => {
    expect(isOffTopic(REFUND_PAGE, 'franchigia bagaglio a mano', [])).toBe(false);
  });

  it('NON allarga su query vuota', () => {
    expect(isOffTopic(REFUND_PAGE, '   ', [BAGGAGE])).toBe(false);
  });

  it('NON allarga se nessun candidato batte la pagina', () => {
    // Copertura bassa (sinonimi), ma i candidati non c'entrano nulla con la
    // domanda: la pagina aperta resta la miglior fonte disponibile.
    const irrelevant = [candidate('Hotel-checkin-times', 'Lodging | Check-in times')];
    expect(isOffTopic(REFUND_PAGE, 'reimbursement ticket refund', irrelevant)).toBe(false);
  });

  it('la soglia di copertura è regolabile', () => {
    // Con soglia 0 nessuna domanda è mai fuori tema.
    expect(isOffTopic(REFUND_PAGE, 'franchigia baggage allowance', [BAGGAGE], 0)).toBe(false);
  });
});
