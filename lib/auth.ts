// Agent authentication for the sidebar: username/password login against the
// backend, bearer token kept in extension storage and attached to every
// /ask request. The token is an opaque session id issued by POST /auth/login
// (client: 'extension'); the backend can revoke it at any time.
import { browser } from 'wxt/browser';

const TOKEN_KEY = 'rs:authToken';

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
  const res = await fetch(`${base(proxyUrl)}/auth/login`, {
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
      await fetch(`${base(proxyUrl)}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {
      // backend unreachable — the token still dies locally
    }
  }
  await clearToken();
}

/** Validates the stored token; clears it and returns null on 401. */
export async function fetchMe(proxyUrl: string): Promise<AuthUser | null> {
  const token = await getToken();
  if (!token) return null;
  let res: Response;
  try {
    res = await fetch(`${base(proxyUrl)}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    // backend unreachable: keep the token, report logged-out for now
    console.warn('[rs] backend non raggiungibile durante la verifica della sessione:', e);
    return null;
  }
  if (res.status === 401) {
    await clearToken();
    return null;
  }
  if (!res.ok) return null;
  const data = (await res.json()) as { user: AuthUser };
  return data.user;
}

export async function changePassword(
  proxyUrl: string,
  currentPassword: string,
  newPassword: string,
): Promise<AuthUser> {
  const token = await getToken();
  const res = await fetch(`${base(proxyUrl)}/auth/change-password`, {
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
