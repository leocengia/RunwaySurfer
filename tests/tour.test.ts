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

const { clearTourAbort, loadTourResult, markTourAborted, saveTourResult } =
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
