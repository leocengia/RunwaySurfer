// Stato persistito del tour visivo. Due cose da tenere sotto controllo: la
// scadenza (un risultato vecchio non deve ricomparire su una pagina qualsiasi) e
// COSA finisce su disco, perché `storage.local` sopravvive alla chiusura del tab.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KbPage } from '../lib/outcome';

const store = new Map<string, unknown>();

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const key of list) if (store.has(key)) out[key] = store.get(key);
          return out;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (key: string) => void store.delete(key),
      },
    },
  },
}));

const { clearTourAbort, loadTourResult, markTourAborted, saveTourResult, startTour } =
  await import('../lib/tour');

const RESULT_KEY = 'rs:tourResult';
const ABORT_KEY = 'rs:tourAbort';

const page = (url: string, text: string): KbPage => ({
  url,
  title: 'Titolo',
  text,
  origin: 'followed',
});

const result = (startedAt: number, pages: KbPage[] = [page('https://kb/a', 'corpo articolo')]) => ({
  query: 'rimborso',
  outcome: '## Procedura\npassi',
  plan: null,
  pages,
  targetUrl: 'https://kb/a',
  startedAt,
});

beforeEach(() => {
  store.clear();
});

describe('saveTourResult', () => {
  it('NON scrive su disco il testo degli articoli', async () => {
    // Il record serve solo a ricomporre risposta e fonti dopo la navigazione
    // finale. Il corpo degli articoli resterebbe in storage.local anche se
    // l'agente chiude il tab prima di atterrare: la scadenza di 5 minuti si
    // applica solo in lettura.
    await saveTourResult(result(Date.now()));
    const stored = store.get(RESULT_KEY) as { pages: KbPage[] };
    expect(stored.pages).toHaveLength(1);
    expect(stored.pages[0].text).toBe('');
    // Url e titolo restano: servono all'elenco delle fonti.
    expect(stored.pages[0].url).toBe('https://kb/a');
    expect(stored.pages[0].title).toBe('Titolo');
  });

  it('conserva la risposta, che è il motivo per cui esiste', async () => {
    await saveTourResult(result(Date.now()));
    const stored = store.get(RESULT_KEY) as { outcome: string };
    expect(stored.outcome).toContain('Procedura');
  });
});

describe('loadTourResult · scadenza', () => {
  it('restituisce un risultato fresco', async () => {
    await saveTourResult(result(Date.now()));
    expect(await loadTourResult()).not.toBeNull();
  });

  it('scarta un risultato più vecchio di 5 minuti E lo cancella da disco', async () => {
    await saveTourResult(result(Date.now() - 6 * 60_000));
    expect(await loadTourResult()).toBeNull();
    expect(store.has(RESULT_KEY)).toBe(false);
  });

  it('senza risultato non inventa nulla', async () => {
    expect(await loadTourResult()).toBeNull();
  });

  it('tollera un valore corrotto in storage', async () => {
    store.set(RESULT_KEY, 'non un oggetto');
    expect(await loadTourResult()).toBeNull();
  });
});

describe('loadTourResult · guardia sullo stop', () => {
  it('scarta il risultato se lo stop è arrivato dopo il suo avvio', async () => {
    // Stop premuto mentre la navigazione finale committava: il flag su storage
    // sopravvive alla morte della pagina, il risultato non deve ricomparire.
    const startedAt = Date.now();
    await saveTourResult(result(startedAt));
    store.set(ABORT_KEY, startedAt + 100);
    expect(await loadTourResult()).toBeNull();
  });

  it('un tour NUOVO non viene affossato da un vecchio stop', async () => {
    store.set(ABORT_KEY, Date.now() - 60_000);
    await saveTourResult(result(Date.now()));
    expect(await loadTourResult()).not.toBeNull();
  });

  it('consuma il flag di abort: prima non veniva rimosso mai', async () => {
    // Nessun codice rimuoveva questa chiave: restava su disco a tempo
    // indeterminato e al riavvio del browser poteva scartare il risultato di un
    // tour successivo.
    await markTourAborted();
    expect(store.has(ABORT_KEY)).toBe(true);
    await saveTourResult(result(Date.now()));
    await loadTourResult();
    expect(store.has(ABORT_KEY)).toBe(false);
  });

  it('lo consuma anche quando è servito a scartare', async () => {
    const startedAt = Date.now();
    await saveTourResult(result(startedAt));
    store.set(ABORT_KEY, startedAt + 100);
    expect(await loadTourResult()).toBeNull();
    expect(store.has(ABORT_KEY)).toBe(false);
  });

  it('clearTourAbort è idempotente', async () => {
    await clearTourAbort();
    await clearTourAbort();
    expect(store.has(ABORT_KEY)).toBe(false);
  });
});

// La domanda di approfondimento in modalità Immersiva. Prima il tour ripartiva da
// zero a ogni domanda: rivisitava gli stessi articoli con tutta l'animazione e
// buttava i corpi già in memoria, mentre le altre due modalità li riusavano.
describe('startTour · follow-up', () => {
  const HERE = 'https://kb.example.com/wiki/Pagina_iniziale';
  const ALTRO = 'https://kb.example.com/wiki/Rimborso_volo_cancellato';

  beforeEach(() => {
    document.body.innerHTML = `
      <main role="main">
        <h1>Rimborsi</h1>
        <p>Testo della pagina di partenza sul rimborso del biglietto.</p>
        <a href="${ALTRO}">Rimborso volo cancellato: procedura</a>
      </main>`;
  });

  it('la prima domanda cammina verso gli articoli collegati', () => {
    const tour = startTour('rimborso volo cancellato');
    expect(tour.targets.length).toBeGreaterThan(0);
    expect(tour.phase).toBe('scrolling');
  });

  it('porta le pagine già lette nel contesto, senza duplicare quella corrente', () => {
    const tour = startTour('rimborso volo cancellato', {
      alreadyRead: [page(ALTRO, 'corpo già letto'), page(HERE, 'la pagina corrente, di nuovo')],
    });
    const urls = tour.pages.map((p) => p.url);
    expect(urls).toContain(ALTRO);
    // La pagina corrente compare una volta sola: è sempre pages[0].
    expect(urls.filter((u) => u.startsWith(HERE))).toHaveLength(1);
  });

  it('NON cammina verso un articolo che ha già letto', () => {
    const tour = startTour('rimborso volo cancellato', {
      alreadyRead: [page(ALTRO, 'corpo già letto')],
    });
    expect(tour.targets.map((t) => t.url)).not.toContain(ALTRO);
  });

  it('se la pagina aperta copre la domanda salta la camminata', () => {
    const tour = startTour('rimborso volo cancellato', {
      alreadyRead: [page(ALTRO, 'corpo già letto')],
      currentPageCovers: true,
    });
    expect(tour.targets).toEqual([]);
    // `asking` è la strada già esistente per "nessun link da visitare".
    expect(tour.phase).toBe('asking');
  });

  it('ma cammina comunque se la pagina aperta NON copre la domanda', () => {
    const tour = startTour('rimborso volo cancellato', {
      alreadyRead: [page('https://kb.example.com/wiki/Altro_tema', 'roba diversa')],
      currentPageCovers: false,
    });
    expect(tour.targets.length).toBeGreaterThan(0);
  });

  it('scarta le pagine senza testo (risultato di tour persistito)', () => {
    // saveTourResult azzera il testo prima di scrivere su disco: rimandare quei
    // corpi vuoti al modello costerebbe token senza aggiungere contesto.
    const tour = startTour('rimborso', { alreadyRead: [page(ALTRO, '')] });
    expect(tour.pages.map((p) => p.url)).not.toContain(ALTRO);
  });
});
