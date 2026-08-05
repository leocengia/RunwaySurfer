// Le view non avevano copertura. Questi test guardano due cose che possono
// rompersi in silenzio:
//  1. gli asset condivisi (shared/theme.css, shared/logo.svg) sono letti a
//     runtime da disco, non importati: un path sbagliato darebbe una dashboard
//     senza palette solo a boot, mai in compilazione;
//  2. lo sfoltimento e il gating per ruolo, che sono decisioni di prodotto
//     facili da annullare per sbaglio riscrivendo il template.
import { beforeAll, describe, expect, it } from 'vitest';
import type { AuthContext } from '../src/auth.js';
import { initDb } from '../src/db.js';
import { renderDashboard } from '../src/views/dashboard.js';
import { renderChangePasswordPage, renderLoginPage } from '../src/views/auth-pages.js';
import { LOGO_SVG, THEME_CSS } from '../src/shared-assets.js';

function authContext(role: 'admin' | 'team_lead'): AuthContext {
  const now = new Date().toISOString();
  return {
    user: {
      id: 1,
      external_id: 'lead@example.com',
      name: 'Lead',
      email: 'lead@example.com',
      role,
      status: 'active',
      team_id: null,
      password_hash: null,
      must_change_password: 0,
      created_at: now,
    },
    session: {
      token_hash: 'hash',
      user_id: 1,
      kind: 'cookie',
      created_at: now,
      last_seen_at: now,
      expires_at: now,
    },
    via: 'cookie',
  } as AuthContext;
}

describe('asset condivisi', () => {
  it('legge i design token da shared/theme.css', () => {
    expect(THEME_CSS).toMatch(/--rs-primary:\s*#000099/i);
    expect(THEME_CSS).toMatch(/:root\s*,\s*:host\s*\{/);
  });

  it('legge il marchio da shared/logo.svg', () => {
    expect(LOGO_SVG).toContain('<svg');
    expect(LOGO_SVG).toContain('rs-logo-plate');
  });
});

describe('renderDashboard', () => {
  let admin = '';
  let lead = '';

  beforeAll(() => {
    initDb(); // la dashboard legge settings/analytics dal DB
    admin = renderDashboard(authContext('admin'));
    lead = renderDashboard(authContext('team_lead'));
  });

  it('inlina i token condivisi invece di una palette propria', () => {
    expect(admin).toContain('--rs-primary: #000099');
    // Nessun blocco `:root` fatto in casa oltre a quello condiviso.
    expect(admin.match(/--rs-primary:/g)).toHaveLength(1);
  });

  it('mostra il marchio e il nome staccato', () => {
    expect(admin).toContain('rs-logo-plate');
    expect(admin).toContain('Runway Surfer');
    expect(admin).not.toContain('RunwaySurfer');
  });

  it('tiene il response panel accanto alle API actions', () => {
    const actions = admin.indexOf('Executable API actions');
    const panel = admin.indexOf('Response panel');
    expect(actions).toBeGreaterThan(-1);
    expect(panel).toBeGreaterThan(actions);
    // Prima c'erano quattro sezioni e ~800px in mezzo. L'unica apertura di
    // sezione fra i due è quella del pannello stesso.
    expect(admin.slice(actions, panel).match(/<section class="card"/g)).toHaveLength(1);
  });

  it('non ha più le sezioni rimosse nello sfoltimento', () => {
    for (const page of [admin, lead]) {
      expect(page).not.toContain('Demo ask request');
      expect(page).not.toContain('Active agents');
      expect(page).not.toContain('Request filters');
      expect(page).not.toContain('Per-agent limit');
    }
  });

  it('tiene le sezioni che restano', () => {
    for (const label of [
      'Control-plane draft',
      'Model distribution',
      'Recent requests',
      'Stato completo (JSON)',
    ]) {
      expect(admin).toContain(label);
    }
  });

  it('non duplica più i KPI dentro le card guardrail', () => {
    // "Active" e "Est. cost" erano sia KPI sia card con barra.
    expect(admin).not.toContain('<div class="label">Active</div>');
    expect(admin).not.toContain('<div class="label">Est. cost</div>');
    expect(admin).toContain('Total concurrency');
    expect(admin).toContain('Cost guardrail');
  });

  it('mostra 8 riquadri nella striscia KPI', () => {
    // Il conteggio è una scelta di layout (griglia 4×2 a 1100px): se qualcuno
    // aggiunge o toglie una card, la griglia si spaiala e il test lo dice.
    const strip = admin.slice(admin.indexOf('<section class="grid">'), admin.indexOf('</section>'));
    expect(strip.match(/<div class="card">/g)).toHaveLength(8);
    expect(strip).toContain('Errori');
  });

  it('mantiene il gating per ruolo', () => {
    // Sui form, non sulle etichette: le stringhe dei toast vivono nello script
    // condiviso da tutti i ruoli, quindi "Settings" compare comunque.
    for (const id of ['user-form', 'team-form', 'reset-password-form', 'settings-form']) {
      expect(admin).toContain(`id="${id}"`);
      expect(lead).not.toContain(`id="${id}"`);
    }
    // Prune è admin-only e ora ha una UI: prima non era raggiungibile da nessuna parte.
    expect(admin).toContain('id="prune-btn"');
    expect(lead).not.toContain('id="prune-btn"');
  });
});

describe('renderDashboard · schede', () => {
  let admin = '';
  let lead = '';

  beforeAll(() => {
    initDb();
    admin = renderDashboard(authContext('admin'));
    lead = renderDashboard(authContext('team_lead'));
  });

  it('espone tre schede con i ruoli ARIA corretti', () => {
    // Solo il markup: lo script contiene querySelectorAll('[role="tab"]').
    const markup = admin.slice(0, admin.indexOf('<script>'));
    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup.match(/role="tabpanel"/g)).toHaveLength(3);
    for (const name of ['diagnostica', 'utenti', 'configurazione']) {
      expect(markup).toContain(`data-tab="${name}"`);
      expect(markup).toContain(`id="panel-${name}"`);
    }
  });

  it('apre su Diagnostica e tiene nascoste le altre', () => {
    expect(admin).toContain('id="tab-diagnostica" data-tab="diagnostica"');
    expect(admin).toMatch(/id="panel-diagnostica"[^>]*>/);
    expect(admin).toMatch(/id="panel-utenti"[^>]*hidden/);
    expect(admin).toMatch(/id="panel-configurazione"[^>]*hidden/);
  });

  it('la diagnostica resta nella prima scheda', () => {
    const panel = admin.slice(
      admin.indexOf('id="panel-diagnostica"'),
      admin.indexOf('id="panel-utenti"'),
    );
    for (const label of [
      'Provider',
      'Total concurrency',
      'Executable API actions',
      'Recent requests',
    ]) {
      expect(panel).toContain(label);
    }
    // I settings NON sono diagnostica: stanno in Configurazione.
    expect(panel).not.toContain('id="settings-form"');
  });

  it('la configurazione raccoglie guardrail, config estensione e JSON', () => {
    const panel = admin.slice(admin.indexOf('id="panel-configurazione"'));
    expect(panel).toContain('id="settings-form"');
    expect(panel).toContain("Configurazione dell'estensione");
    expect(panel).toContain('Stato completo (JSON)');
    expect(panel).toContain('max_history_turns');
  });

  it('un team_lead vede la configurazione in sola lettura', () => {
    const panel = lead.slice(lead.indexOf('id="panel-configurazione"'));
    expect(panel).toContain("Configurazione dell'estensione");
    expect(panel).not.toContain('id="settings-form"');
  });

  it('spiega al team_lead perché non vede la gestione utenti', () => {
    expect(lead).toContain('Gestione utenti');
    expect(lead).toContain('admin');
  });

  it('espone i riscontri che prima non esistevano', () => {
    expect(admin).toContain('id="toast-host"');
    expect(admin).toContain("aria-pressed', 'false'");
    expect(admin).toContain('prefers-reduced-motion');
  });
});

describe('pagine auth', () => {
  it('usano i token condivisi e il marchio', () => {
    for (const html of [renderLoginPage(), renderChangePasswordPage(true)]) {
      expect(html).toContain('--rs-primary: #000099');
      expect(html).toContain('rs-logo-plate');
      expect(html).toContain('Runway Surfer');
    }
  });
});
