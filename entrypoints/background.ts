// Background service worker.
//
// La sidebar (content script) parla direttamente col proxy via streaming fetch,
// e il proxy risponde con gli header CORS. Attenzione al dettaglio che decide la
// configurazione del backend: un content script NON eredita alcun bypass CORS
// dalle host_permissions (Chrome l'ha rimosso nella 85), quindi quelle chiamate
// portano l'Origin della pagina KB e ALLOWED_ORIGIN deve contenerlo.
// Qui il background resta minimo.
//
// PRODUCTION OPTION: portare la chiamata al proxy dentro il background,
// facendo da ponte per lo stream SSE su una Port di chrome.runtime; i contratti
// dei messaggi per quella strada stanno in lib/messaging.ts. È la risposta
// architetturalmente corretta in MV3 — l'Origin diventerebbe
// chrome-extension://, e ALLOWED_ORIGIN potrebbe tornare a una voce sola — ma
// va pesata contro la terminazione del service worker durante uno stream lungo.
// Serve anche come piano B se il backend non potrà avere un certificato TLS: il
// background ha origine estensione e non subisce il blocco mixed-content.
import { browser } from 'wxt/browser';
export default defineBackground(() => {
  // Click sull'icona nella barra di Chrome → pagina di configurazione. È l'unico
  // modo per cui l'installatore possa impostare l'URL del backend senza aprire
  // la console DevTools su ogni postazione.
  browser.action?.onClicked.addListener(() => {
    void browser.runtime.openOptionsPage();
  });
});
