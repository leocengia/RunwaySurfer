// Pagine standalone di login e cambio password (HTML renderizzato lato server).
import { escapeHtml } from './html.js';
import { LOGO_MARK, THEME_CSS } from '../shared-assets.js';

// Stile delle pagine auth. I token arrivano da shared/theme.css, gli stessi di
// sidebar e dashboard: è la prima schermata che un agente vede, e prima aveva la
// sua copia divergente della palette.
const AUTH_PAGE_STYLE = `
${THEME_CSS}
    * { box-sizing: border-box; }
    body {
      margin: 0; font-family: var(--rs-font); color: var(--rs-navy);
      background:
        radial-gradient(1000px 560px at 15% -10%, rgba(0, 0, 153, 0.18), transparent 60%),
        radial-gradient(820px 480px at 100% 0%, rgba(255, 204, 0, 0.14), transparent 55%),
        linear-gradient(180deg, #e9eef4, var(--rs-soft));
      background-attachment: fixed;
      display: flex; min-height: 100vh; align-items: center; justify-content: center;
    }
    .auth-card {
      position: relative;
      width: 340px; background: var(--rs-glass); border: 1px solid var(--rs-glass-border);
      border-radius: var(--rs-r-lg); padding: 24px;
      border-top: 4px solid var(--rs-yellow);
      -webkit-backdrop-filter: var(--rs-glass-blur); backdrop-filter: var(--rs-glass-blur);
      box-shadow: var(--rs-glass-edge), 0 18px 50px rgba(0, 0, 153, 0.22);
    }
    /* Riflesso speculare in cima alla lastra. */
    .auth-card::before {
      content: ''; position: absolute; inset: 0 0 auto; height: 38%; pointer-events: none;
      border-radius: var(--rs-r-lg) var(--rs-r-lg) 0 0;
      background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), transparent);
    }
    .auth-card > * { position: relative; }
    .brand { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .brand .mark { flex-shrink: 0; width: 34px; height: 34px; border-radius: 22%; filter: drop-shadow(0 2px 6px rgba(0, 0, 153, 0.28)); }
    .brand strong { font-family: var(--rs-font-brand); font-size: 17px; font-weight: 700; letter-spacing: -0.01em; }
    h1 { margin: 0 0 4px; font-size: 20px; }
    p.sub { margin: 0 0 16px; color: var(--rs-muted); font-size: 13px; }
    label { display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; color: var(--rs-muted); margin: 12px 0 4px; }
    input {
      width: 100%; border: 1px solid var(--rs-line); border-radius: var(--rs-r-sm); padding: 9px; font: inherit; color: var(--rs-navy);
      background: var(--rs-glass-strong);
      -webkit-backdrop-filter: var(--rs-glass-blur); backdrop-filter: var(--rs-glass-blur);
      transition: border-color var(--rs-dur) var(--rs-ease), box-shadow var(--rs-dur) var(--rs-ease);
    }
    input:focus { outline: none; border-color: var(--rs-primary); box-shadow: var(--rs-focus-ring); }
    button {
      width: 100%; margin-top: 18px; border: 1px solid var(--rs-yellow-line); border-radius: var(--rs-r-sm); padding: 10px;
      background: linear-gradient(180deg, var(--rs-yellow-hi), var(--rs-yellow)); color: var(--rs-navy);
      cursor: pointer; font-weight: 800; font-size: 14px;
      box-shadow: var(--rs-glass-edge), 0 4px 14px rgba(216, 173, 0, 0.28);
      transition: background var(--rs-dur) var(--rs-ease), transform var(--rs-dur) var(--rs-ease);
    }
    button:hover:not(:disabled) { background: linear-gradient(180deg, #ffe066, #ffd633); }
    button:active:not(:disabled) { transform: translateY(1px) scale(0.995); }
    button:focus-visible { outline: none; box-shadow: var(--rs-focus-ring), 0 4px 14px rgba(216, 173, 0, 0.28); }
    button:disabled { opacity: 0.55; cursor: progress; }
    .error {
      display: none; margin-top: 12px; padding: 9px; border-radius: var(--rs-r-sm);
      background: rgba(253, 238, 236, 0.86); border: 1px solid rgba(180, 35, 24, 0.22);
      color: var(--rs-danger); font-size: 13px;
    }
    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      .auth-card, input { background: #fff; }
    }
    @media (prefers-reduced-transparency: reduce) {
      body { background: var(--rs-soft); }
      .auth-card, input { background: #fff; -webkit-backdrop-filter: none; backdrop-filter: none; }
      .auth-card::before { display: none; }
    }
    @media (prefers-reduced-motion: reduce) {
      input, button { transition: none !important; }
    }
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
  <title>${escapeHtml(options.title)} — Runway Surfer</title>
  <style>${AUTH_PAGE_STYLE}</style>
</head>
<body>
  <div class="auth-card">
    <div class="brand">
      <img class="mark" src="${LOGO_MARK}" alt="" aria-hidden="true" />
      <strong>Runway Surfer</strong>
    </div>
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
    title: 'Control Dashboard',
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
