import { defineConfig } from 'wxt';

// RunwaySurfer — Manifest V3 Chrome extension.
//
// KB reale: Salesforce Experience Cloud su traveler.my.site.com (community
// Aura). Le letture riusano la sessione SSO del profilo Chrome via fetch
// same-origin (credentials: 'include'). Wikipedia resta tra i match come
// target pubblico per il demo/dev (stessa meccanica, senza SSO).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'RunwaySurfer',
    description:
      'AI sidebar that helps agents navigate the knowledge base and get an operational outcome.',
    // Minimal permissions: storage (settings), and scripting/activeTab for the
    // injected sidebar. host_permissions scope the same-origin fetch used to
    // read nested KB pages.
    permissions: ['storage', 'activeTab', 'scripting'],
    host_permissions: ['https://traveler.my.site.com/*', '*://*.wikipedia.org/*'],
  },
});
