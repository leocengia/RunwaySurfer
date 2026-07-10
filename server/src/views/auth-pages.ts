// Pagine standalone di login e cambio password (HTML renderizzato lato server).
import { escapeHtml } from './html.js';

// Shared minimal style for the standalone auth pages (login / change password).
const AUTH_PAGE_STYLE = `
    :root { --ink: #0b1f3a; --yellow: #ffcc00; --soft: #f5f7fa; --line: #d8e0ea; --muted: #5f6f82; --err: #a4262c; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: var(--ink); background: var(--soft); display: flex; min-height: 100vh; align-items: center; justify-content: center; }
    .auth-card { width: 340px; background: #fff; border: 1px solid var(--line); border-radius: 8px; padding: 24px; border-top: 4px solid var(--yellow); }
    h1 { margin: 0 0 4px; font-size: 20px; }
    p.sub { margin: 0 0 16px; color: var(--muted); font-size: 13px; }
    label { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--muted); margin: 12px 0 4px; }
    input { width: 100%; border: 1px solid var(--line); border-radius: 6px; padding: 9px; font: inherit; }
    button { width: 100%; margin-top: 18px; border: 1px solid #d8ad00; border-radius: 6px; padding: 10px; background: var(--yellow); color: var(--ink); cursor: pointer; font-weight: 800; font-size: 14px; }
    .error { display: none; margin-top: 12px; padding: 9px; border-radius: 6px; background: #fdecea; color: var(--err); font-size: 13px; }
`;

function authPage(options: {
  title: string;
  subtitle: string;
  formHtml: string;
  script: string;
}): string {
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(options.title)} — RunwaySurfer</title>
  <style>${AUTH_PAGE_STYLE}</style>
</head>
<body>
  <div class="auth-card">
    <h1>${escapeHtml(options.title)}</h1>
    <p class="sub">${escapeHtml(options.subtitle)}</p>
    ${options.formHtml}
    <div class="error" id="error"></div>
  </div>
  <script>
    const errorBox = document.getElementById('error');
    function showError(message) { errorBox.textContent = message; errorBox.style.display = 'block'; }
    ${options.script}
  </script>
</body>
</html>`;
}

export function renderLoginPage(): string {
  return authPage({
    title: 'RunwaySurfer Dashboard',
    subtitle: 'Accedi con le credenziali fornite dal tuo amministratore.',
    formHtml: `
    <form id="login-form">
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" required autofocus />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit">Accedi</button>
    </form>`,
    script: `
    document.getElementById('login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.style.display = 'none';
      const body = Object.fromEntries(new FormData(event.target).entries());
      body.client = 'dashboard';
      try {
        const res = await fetch('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) { showError(data.error || ('Errore ' + res.status)); return; }
        location.href = data.mustChangePassword ? '/change-password' : '/dashboard';
      } catch (e) { showError(String(e)); }
    });`,
  });
}

export function renderChangePasswordPage(mustChange: boolean): string {
  return authPage({
    title: 'Cambio password',
    subtitle: mustChange
      ? 'Devi impostare una nuova password prima di continuare.'
      : 'Imposta una nuova password per il tuo account.',
    formHtml: `
    <form id="change-form">
      <label for="currentPassword">Password attuale</label>
      <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required autofocus />
      <label for="newPassword">Nuova password (min 8 caratteri)</label>
      <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
      <label for="confirmPassword">Conferma nuova password</label>
      <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" minlength="8" required />
      <button type="submit">Cambia password</button>
    </form>`,
    script: `
    document.getElementById('change-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      errorBox.style.display = 'none';
      const body = Object.fromEntries(new FormData(event.target).entries());
      if (body.newPassword !== body.confirmPassword) { showError('Le nuove password non coincidono.'); return; }
      try {
        const res = await fetch('/auth/change-password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currentPassword: body.currentPassword, newPassword: body.newPassword }) });
        const data = await res.json();
        if (!res.ok) { showError(data.error || ('Errore ' + res.status)); return; }
        location.href = '/dashboard';
      } catch (e) { showError(String(e)); }
    });`,
  });
}
