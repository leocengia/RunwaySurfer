import { describe, expect, it } from 'vitest';
import { pickRelevantLinks } from '../lib/crawl';
import type { KbLink } from '../lib/outcome';

function link(text: string, url: string, context?: string, order?: number): KbLink {
  return { text, url, context, order };
}

const BASE = 'https://kb.example.com/wiki';

describe('pickRelevantLinks', () => {
  it('restituisce [] se la query non contiene keyword utili', () => {
    const links = [link('Cambio indirizzo', `${BASE}/Cambio_indirizzo`)];
    expect(pickRelevantLinks(links, 'il e a')).toEqual([]);
  });

  it('seleziona il link pertinente e scarta quelli fuori tema', () => {
    const links = [
      link('Cambio indirizzo di consegna', `${BASE}/Cambio_indirizzo`, 'come cambiare indirizzo'),
      link('Storia della azienda', `${BASE}/Storia`),
      link('Contatti generali', `${BASE}/Contatti`),
    ];
    const picked = pickRelevantLinks(links, 'cliente vuole cambiare indirizzo di consegna');
    expect(picked.map((l) => l.url)).toEqual([`${BASE}/Cambio_indirizzo`]);
  });

  it('arricchisce i link scelti con score, reason e matchedKeywords', () => {
    const links = [
      link('Rimborso ordine', `${BASE}/Rimborso_ordine`, 'procedura di rimborso ordine'),
      link('Pagina generica', `${BASE}/Generica`),
    ];
    const [picked] = pickRelevantLinks(links, 'come richiedo il rimborso di un ordine?');
    expect(picked.score).toBeGreaterThan(0);
    expect(picked.reason).toBeTruthy();
    expect(picked.matchedKeywords).toContain('rimborso');
  });

  it('con un match molto forte restituisce solo quel link', () => {
    const links = [
      link(
        'cliente vuole cambiare indirizzo ordine',
        `${BASE}/Cambiare_indirizzo_ordine`,
        'cliente vuole cambiare indirizzo ordine',
      ),
      link('Modifica ordine', `${BASE}/Modifica_ordine`, 'modifiche ordine'),
      link('Indirizzi di spedizione', `${BASE}/Indirizzi`, 'gestione indirizzo'),
    ];
    const picked = pickRelevantLinks(links, 'cliente vuole cambiare indirizzo ordine');
    expect(picked).toHaveLength(1);
    expect(picked[0].url).toBe(`${BASE}/Cambiare_indirizzo_ordine`);
  });

  it('rispetta il limite massimo di link selezionati', () => {
    const links = Array.from({ length: 10 }, (_, i) =>
      link(`Rimborso ordine variante ${i}`, `${BASE}/Rimborso_${i}`, 'rimborso ordine'),
    );
    const picked = pickRelevantLinks(links, 'rimborso ordine', 3);
    expect(picked.length).toBeLessThanOrEqual(3);
  });

  it('usa il vocabolario di dominio (aviazione) per collegare query IT a slug EN', () => {
    // Query in italiano ("rimborso del volo"); l'articolo giusto ha slug/label
    // inglesi. Il concetto refund/flight deve farlo emergere sopra il rumore.
    const links = [
      link('Flight refund policy', `${BASE}/Flight-refund-policy`, 'refund for cancelled flights'),
      link('Baggage allowance', `${BASE}/Baggage-allowance`, 'checked and carry-on bags'),
      link('Company history', `${BASE}/History`),
    ];
    const picked = pickRelevantLinks(links, 'come chiedo il rimborso del volo cancellato?');
    expect(picked[0].url).toBe(`${BASE}/Flight-refund-policy`);
    expect(picked[0].reason).toContain('intent');
  });
});
