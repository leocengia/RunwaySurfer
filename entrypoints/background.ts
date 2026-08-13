// Background service worker.
//
// In the demo the sidebar (content script) talks to the backend proxy directly
// via streaming fetch — the proxy returns CORS headers, so no host permission
// is needed. The background is kept minimal here.
//
// PRODUCTION OPTION: route the proxy call through the background instead (e.g.
// to centralize auth headers or per-agent identity), bridging the SSE stream to
// the sidebar over a chrome.runtime Port. The message contracts for that path
// live in lib/messaging.ts. Serve anche come piano B se il backend non potrà
// avere un certificato TLS: il background ha origine estensione e non subisce il
// blocco mixed-content della pagina.
import { browser } from 'wxt/browser';
export default defineBackground(() => {
  // Click sull'icona nella barra di Chrome → pagina di configurazione. È l'unico
  // modo per cui l'installatore possa impostare l'URL del backend senza aprire
  // la console DevTools su ogni postazione.
  browser.action?.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });
});
