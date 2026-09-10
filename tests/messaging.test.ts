// Risoluzione dell'URL del backend: è l'UNICO punto di configurazione del
// rilascio e non aveva test. Un errore qui non si manifesta come un bug ma come
// "l'estensione non funziona su quella postazione", che è la segnalazione più
// difficile da diagnosticare a distanza.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const local = new Map<string, unknown>();
const managed = new Map<string, unknown>();
/** Su un profilo senza policy aziendali `storage.managed` non esiste affatto. */
let managedAvailable = true;

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (key: string) => (local.has(key) ? { [key]: local.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) local.set(k, v);
        },
      },
      get managed() {
        if (!managedAvailable) return undefined;
        return {
          get: async (key: string) => (managed.has(key) ? { [key]: managed.get(key) } : {}),
        };
      },
    },
  },
}));

const { DEFAULT_PROXY_URL, getProxyUrl, setProxyUrl } = await import('../lib/messaging');

beforeEach(() => {
  local.clear();
  managed.clear();
  managedAvailable = true;
});

describe('getProxyUrl · precedenza', () => {
  it('senza nulla di configurato usa il default', async () => {
    expect(await getProxyUrl()).toBe(DEFAULT_PROXY_URL);
  });

  it('usa il valore locale se c’è', async () => {
    local.set('proxyUrl', 'https://backend.example.local');
    expect(await getProxyUrl()).toBe('https://backend.example.local');
  });

  it('la policy aziendale VINCE sul valore locale', async () => {
    // Durante un rollout la configurazione centrale non deve poter essere
    // scavalcata da un valore rimasto sulla postazione.
    local.set('proxyUrl', 'https://vecchio.example.local');
    managed.set('proxyUrl', 'https://nuovo.example.local');
    expect(await getProxyUrl()).toBe('https://nuovo.example.local');
  });

  it('un profilo senza policy non è un errore', async () => {
    managedAvailable = false;
    local.set('proxyUrl', 'https://backend.example.local');
    expect(await getProxyUrl()).toBe('https://backend.example.local');
  });
});

describe('getProxyUrl · valori inservibili', () => {
  it('ignora una stringa vuota e ricade sul default', async () => {
    local.set('proxyUrl', '   ');
    expect(await getProxyUrl()).toBe(DEFAULT_PROXY_URL);
  });

  it('ignora un valore non-stringa', async () => {
    local.set('proxyUrl', 42);
    expect(await getProxyUrl()).toBe(DEFAULT_PROXY_URL);
  });

  it('ignora uno schema diverso da http/https', async () => {
    local.set('proxyUrl', 'javascript:alert(1)');
    expect(await getProxyUrl()).toBe(DEFAULT_PROXY_URL);
  });

  it('una policy malformata non blocca il valore locale valido', async () => {
    managed.set('proxyUrl', 'non-un-url');
    local.set('proxyUrl', 'https://backend.example.local');
    expect(await getProxyUrl()).toBe('https://backend.example.local');
  });

  it('normalizza via la barra finale, così non si duplica in `${url}/ask`', async () => {
    local.set('proxyUrl', 'https://backend.example.local/');
    expect(await getProxyUrl()).toBe('https://backend.example.local');
  });
});

describe('setProxyUrl', () => {
  it('salva il valore normalizzato', async () => {
    expect(await setProxyUrl('  https://backend.example.local/  ')).toBe(
      'https://backend.example.local',
    );
    expect(local.get('proxyUrl')).toBe('https://backend.example.local');
  });

  it('rifiuta un URL non valido invece di salvare spazzatura', async () => {
    await expect(setProxyUrl('backend.example.local')).rejects.toThrow(/non valido/i);
    expect(local.has('proxyUrl')).toBe(false);
  });
});
