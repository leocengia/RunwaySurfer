import { defineConfig } from 'wxt';

// RunwaySurfer — Manifest V3 Chrome extension.
//
// DEMO: the content script runs on Wikipedia, which is KB-like (many nested
// internal links) and public, so no SSO is needed to demo the architecture.
// The page-reading + same-origin link-following mechanism is identical to the
// one that will reuse the agent's authenticated SSO session on the real Runway
// KB in production — at that point only `matches`/`host_permissions` change.
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
    host_permissions: ['*://*.wikipedia.org/*'],
  },
});
