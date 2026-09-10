// Agent authentication for the sidebar: username/password login against the
// backend, bearer token kept in extension storage and attached to every
// /ask request. The token is an opaque session id issued by POST /auth/login
// (client: 'extension'); the backend can revoke it at any time.
import { browser } from 'wxt/browser';
import { withTimeout } from './abort';
import { BACKEND_UNREACHABLE } from './client';

const TOKEN_KEY = 'rs:authToken';

/**
 * Le chiamate di autenticazione sono corte per natura: se dopo 10 secondi non c'è
 * risposta il backend è appeso, e far aspettare l'agente davanti a "Verifica
 * sessione..." senza via d'uscita è peggio che dirgli che non si raggiunge.
 */
const AUTH_TIMEOUT_MS = 10_000;

/**
 * Esito della verifica della sessione. Prima era `AuthUser | null`, e `null`
 * significava sia "sessione scaduta" sia "backend spento": l'agente vedeva il
 * form di login, digitava le credenziali e riceveva "Failed to fetch".
 */
export type SessionCheck =
  { state: 'in'; user: AuthUser } | { state: 'loggedOut' } | { state: 'offline'; message: string };

/** fetch con scadenza che traduce i guasti di rete in un messaggio leggibile. */
async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const deadline = withTimeout(AUTH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: deadline.signal });
  } catch (e) {
    throw new Error(
      deadline.expired()
        ? 'Il backend non ha risposto in tempo. Riprova; se continua, segnalalo.'
        : BACKEND_UNREACHABLE,
      { cause: e },
    );
  } finally {
    deadline.dispose();
  }
}

export interface AuthUser {
  id: number;
  username: string;
  email: string | null;
  name: string | null;
  role: 'agent' | 'team_lead' | 'admin';
  status: 'pending' | 'active' | 'disabled';
  teamId: number | null;
  mustChangePassword: boolean;
}

export async function getToken(): Promise<string | null> {
  try {
    const stored = await browser.storage.local.get(TOKEN_KEY);
    const token = stored[TOKEN_KEY];
    return typeof token === 'string' && token ? token : null;
  } catch {
    return null;
  }
}

export async function setToken(token: string): Promise<void> {
  await browser.storage.local.set({ [TOKEN_KEY]: token });
}

export async function clearToken(): Promise<void> {
  try {
    await browser.storage.local.remove(TOKEN_KEY);
  } catch {
    // storage unavailable — nothing to clear
  }
}

function base(proxyUrl: string): string {
  return proxyUrl.replace(/\/$/, '');
}

async function readError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    // non-JSON body
  }
  return `errore ${res.status}`;
}

/** Logs in and stores the bearer token. Throws with a user-facing message on failure. */
export async function login(
  proxyUrl: string,
  username: string,
  password: string,
): Promise<AuthUser> {
  const res = await authFetch(`${base(proxyUrl)}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, client: 'extension' }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { token: string; user: AuthUser; mustChangePassword: boolean };
  await setToken(data.token);
  return { ...data.user, mustChangePassword: data.mustChangePassword };
}

/** Revokes the server-side session; the local token is cleared regardless. */
export async function logout(proxyUrl: string): Promise<void> {
  const token = await getToken();
  if (token) {
    try {
      await authFetch(`${base(proxyUrl)}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // backend unreachable — the token still dies locally
    }
  }
  await clearToken();
}

/**
 * Verifica il token salvato. Il 401 lo cancella (sessione morta sul server), un
 * guasto di rete lo TIENE: al ritorno della rete l'agente non deve rifare login.
 */
export async function fetchMe(proxyUrl: string): Promise<SessionCheck> {
  const token = await getToken();
  if (!token) return { state: 'loggedOut' };
  let res: Response;
  try {
    res = await authFetch(`${base(proxyUrl)}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    return { state: 'offline', message: e instanceof Error ? e.message : BACKEND_UNREACHABLE };
  }
  if (res.status === 401) {
    await clearToken();
    return { state: 'loggedOut' };
  }
  // 5xx o body illeggibile: il backend c'è ma non sta bene. Non è una sessione
  // scaduta, quindi nemmeno qui si manda l'agente al form di login.
  if (!res.ok) {
    return { state: 'offline', message: `Il backend ha risposto ${res.status}. Riprova.` };
  }
  try {
    const data = (await res.json()) as { user: AuthUser };
    if (!data?.user) return { state: 'offline', message: 'Risposta del backend non valida.' };
    return { state: 'in', user: data.user };
  } catch {
    return { state: 'offline', message: 'Risposta del backend non valida.' };
  }
}

export async function changePassword(
  proxyUrl: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthUser> {
  const token = await getToken();
  const res = await authFetch(`${base(proxyUrl)}/auth/change-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!res.ok) throw new Error(await readError(res));
  const data = (await res.json()) as { user: AuthUser };
  return data.user;
}
