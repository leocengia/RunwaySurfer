import { describe, expect, it } from 'vitest';
import { pickRelevantLinks, retrievalEvidence, shortlistCandidates } from '../lib/crawl';
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

  it('non fa scattare il concetto "car" su un titolo che contiene "Carrier" come sottostringa', () => {
    // «Flight Low Cost Carrier LCC policy Global» è un articolo sui VETTORI
    // aerei: `car` ⊂ `Carrier` non deve accreditargli il concetto "autonoleggio".
    // Prova diretta del difetto: con la vecchia corrispondenza a sottostringa
    // questo titolo batteva l'articolo giusto su «devo cercare la policy di
    // emirates» (survey r2-g).
    const links = [
      link('Flight Low Cost Carrier LCC policy Global', `${BASE}/LCC-policy`),
      link('Global airline schedule change policies E H', `${BASE}/Policies-E-H`, 'emirates ek'),
    ];
    const picked = pickRelevantLinks(links, 'devo cercare la policy di emirates', 2);
    expect(picked[0].url).toBe(`${BASE}/Policies-E-H`);
    const lcc = picked.find((l) => l.url === `${BASE}/LCC-policy`);
    expect(lcc?.reason ?? '').not.toContain('car');
  });

  it('un\'iniziale di intervallo spuria, SENZA alcun match lessicale, non basta più a entrare in shortlist', () => {
    // Il gate di I0: prima, un `rangeInitialBoost` non condizionato bastava a
    // superare `score > 0` e finire nella shortlist inviata al reranker AI,
    // anche se il candidato non condivideva UNA parola con la query — la causa
    // dei candidati-rumore su query come "SAFTY" (104 → 64 dopo il gate,
    // vedi il commento a RANGE_INITIAL_BOOST in lib/kb-ranges.ts).
    const spuriousRangeOnly = link(
      'Global airline schedule change policies S Z',
      `${BASE}/Spurious-S-Z`,
    );
    // "Zorbex" non è un vettore reale né vocabolario: nameInitials lo prende
    // comunque come probabile nome proprio (>=4 caratteri, nessuna esclusione),
    // e la sua iniziale Z cade nell'intervallo S-Z del candidato — che però non
    // condivide altrimenti nessuna parola con la query.
    const shortlist = shortlistCandidates([spuriousRangeOnly], 'contatti con Zorbex', 40);
    expect(shortlist.some((l) => l.url === `${BASE}/Spurious-S-Z`)).toBe(false);
  });

  it('riconosce "autonoleggio" (composto IT, l\'alias è un suffisso) come concetto "car"', () => {
    // Regressione presa dal guard di tests/rank-eval.test.ts: una regola
    // "solo prefisso" perdeva questo caso genuino insieme a quelli spuri
    // (vedi il commento di aliasMatchesTokens in lib/text.ts).
    const links = [
      link('Car rental companies contact information A D', `${BASE}/Car-contacts`),
      link('Company history', `${BASE}/History`),
    ];
    const picked = pickRelevantLinks(links, 'contatti autonoleggio', 1);
    expect(picked[0]?.url).toBe(`${BASE}/Car-contacts`);
  });
});

describe('retrievalEvidence · i segnali per assessQuery (A4)', () => {
  it('hasTerms è falso su una domanda di sole parole vuote', () => {
    expect(retrievalEvidence([], 'e poi?').hasTerms).toBe(false);
  });

  it('hasTerms è vero appena c’è un termine, anche a zero candidati', () => {
    const ev = retrievalEvidence([link('Storia della azienda', `${BASE}/Storia`)], 'zorbex');
    expect(ev.hasTerms).toBe(true);
    expect(ev.candidates).toBe(0);
  });

  it('titleHits conta solo i candidati con un hit nel TITOLO, non nello slug/contesto da solo', () => {
    // `retrievalEvidence` fonde `pageLinks` con l'intero indice reale: un
    // termine inventato ("zorbex99") tiene i conteggi esatti, senza collisioni
    // con nessuno dei 2964 articoli veri.
    const titleHit = retrievalEvidence(
      [link('Rimborso Zorbex99', `${BASE}/Rimborso-volo`)],
      'zorbex99',
    );
    const contextOnlyHit = retrievalEvidence(
      [link('Pagina generica', `${BASE}/Pagina`, 'si parla anche di zorbex99 qui')],
      'zorbex99',
    );
    expect(titleHit.candidates).toBe(1);
    expect(titleHit.titleHits).toBe(1);
    expect(contextOnlyHit.candidates).toBe(1);
    expect(contextOnlyHit.titleHits).toBe(0);
  });
});
