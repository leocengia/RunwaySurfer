// Form di autenticazione della sidebar: login e cambio password obbligatorio.
import { useState } from 'react';
import { changePassword, login, type AuthUser } from '../../lib/auth';
import { getProxyUrl } from '../../lib/messaging';

export function LoginForm({ onLoggedIn }: { onLoggedIn: (user: AuthUser) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const submit = async () => {
    if (!username.trim() || !password || busy) return;
    setBusy(true);
    setAuthError('');
    try {
      const user = await login(await getProxyUrl(), username.trim(), password);
      onLoggedIn(user);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="rs-auth"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="rs-auth-note">
        Accedi con le credenziali fornite dal tuo amministratore per usare RunwaySurfer.
      </div>
      <label className="rs-label" htmlFor="rs-username">
        Username
      </label>
      <input
        id="rs-username"
        className="rs-field"
        autoComplete="username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <label className="rs-label" htmlFor="rs-password">
        Password
      </label>
      <input
        id="rs-password"
        className="rs-field"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {authError && <div className="rs-error">{authError}</div>}
      <button className="rs-submit" type="submit" disabled={busy || !username.trim() || !password}>
        {busy ? 'Accesso...' : 'Accedi'}
      </button>
    </form>
  );
}

export function ChangePasswordForm({ onChanged }: { onChanged: (user: AuthUser) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const submit = async () => {
    if (busy) return;
    if (next !== confirm) {
      setAuthError('Le nuove password non coincidono.');
      return;
    }
    setBusy(true);
    setAuthError('');
    try {
      const user = await changePassword(await getProxyUrl(), current, next);
      onChanged(user);
    } catch (e) {
      setAuthError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="rs-auth"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="rs-auth-note">Devi impostare una nuova password prima di continuare.</div>
      <label className="rs-label" htmlFor="rs-current-password">
        Password attuale
      </label>
      <input
        id="rs-current-password"
        className="rs-field"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <label className="rs-label" htmlFor="rs-new-password">
        Nuova password (min 8 caratteri)
      </label>
      <input
        id="rs-new-password"
        className="rs-field"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      <label className="rs-label" htmlFor="rs-confirm-password">
        Conferma nuova password
      </label>
      <input
        id="rs-confirm-password"
        className="rs-field"
        type="password"
        autoComplete="new-password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
      />
      {authError && <div className="rs-error">{authError}</div>}
      <button
        className="rs-submit"
        type="submit"
        disabled={busy || !current || next.length < 8 || !confirm}
      >
        {busy ? 'Salvataggio...' : 'Cambia password'}
      </button>
    </form>
  );
}
