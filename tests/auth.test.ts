// Verifica della sessione. La distinzione che questi test proteggono è quella
// fra "sessione scaduta" e "backend non raggiungibile": prima entrambe
// tornavano `null`, l'agente vedeva il form di login, digitava le credenziali e
// riceveva "Failed to fetch". Con un guasto di rete il token va TENUTO, con un
// 401 va buttato.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, unknown>();

vi.mock('wxt/browser', () => ({
  browser: {
    storage: {
      local: {
        get: async (key: string) => (store.has(key) ? { [key]: store.get(key) } : {}),
        set: async (items: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(items)) store.set(k, v);
        },
        remove: async (key: string) => void store.delete(key),
      },
    },
  },
}));

const { fetchMe, getToken, login, setToken } = await import('../lib/auth');

const TOKEN_KEY = 'rs:authToken';
const USER = {
  id: 1,
  username: 'agente',
  email: null,
  name: 'Agente',
  role: 'agent',
  status: 'active',
  teamId: null,
  mustChangePassword: false,
};

beforeEach(() => {
  store.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchMe', () => {
  it('senza token non chiama nemmeno il backend', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchMe('http://proxy.test')).toEqual({ state: 'loggedOut' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sessione valida → state "in" con l’utente', async () => {
    await setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ user: USER }), { status: 200 })),
    );
    expect(await fetchMe('http://proxy.test')).toEqual({ state: 'in', user: USER });
  });

  it('401 → loggedOut E il token viene cancellato', async () => {
    await setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 401 })),
    );
    expect(await fetchMe('http://proxy.test')).toEqual({ state: 'loggedOut' });
    // La sessione è morta sul server: tenere il token servirebbe solo a
    // ritentare per sempre.
    expect(await getToken()).toBeNull();
  });

  it('errore di rete → offline, e il token SOPRAVVIVE', async () => {
    await setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const result = await fetchMe('http://proxy.test');
    expect(result.state).toBe('offline');
    // Il punto: al ritorno della rete l'agente non deve rifare il login.
    expect(await getToken()).toBe('tok');
  });

  it('il messaggio offline è leggibile, non "Failed to fetch"', async () => {
    await setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const result = await fetchMe('http://proxy.test');
    expect(result.state === 'offline' && result.message).toMatch(/non raggiungibile/i);
    expect(result.state === 'offline' && result.message).not.toMatch(/Failed to fetch/);
  });

  it('un 500 è "offline", non una sessione scaduta', async () => {
    // Il backend c'è ma non sta bene: mandare l'agente al login non risolve
    // niente e gli fa perdere la sessione buona.
    await setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('boom', { status: 500 })),
    );
    const result = await fetchMe('http://proxy.test');
    expect(result.state).toBe('offline');
    expect(await getToken()).toBe('tok');
  });

  it('un body non-JSON non fa esplodere la sidebar', async () => {
    await setToken('tok');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>', { status: 200 })),
    );
    expect((await fetchMe('http://proxy.test')).state).toBe('offline');
  });
});

describe('login', () => {
  it('salva il token e restituisce l’utente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ token: 'nuovo', user: USER, mustChangePassword: false }), {
            status: 200,
          }),
      ),
    );
    const user = await login('http://proxy.test', 'agente', 'pw');
    expect(user.username).toBe('agente');
    expect(store.get(TOKEN_KEY)).toBe('nuovo');
  });

  it('traduce il guasto di rete in un messaggio comprensibile', async () => {
    // AuthForms mostra `e.message` grezzo: se qui passasse "Failed to fetch",
    // quello è ciò che leggerebbe l'agente di call center.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    await expect(login('http://proxy.test', 'a', 'b')).rejects.toThrow(/non raggiungibile/i);
  });

  it('riporta l’errore del backend sulle credenziali sbagliate', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'credenziali non valide' }), { status: 401 }),
      ),
    );
    await expect(login('http://proxy.test', 'a', 'b')).rejects.toThrow('credenziali non valide');
  });
});
