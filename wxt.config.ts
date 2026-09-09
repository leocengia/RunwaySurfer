import { defineConfig } from 'wxt';

// RunwaySurfer — Manifest V3 Chrome extension.
//
// KB reale: Salesforce Experience Cloud su traveler.my.site.com (community
// Aura). Le letture riusano la sessione SSO del profilo Chrome via fetch
// same-origin (credentials: 'include').
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Runway Surfer',
    description:
      'Assistente per gli agenti: cerca nella Knowledge Base e produce la risposta operativa.',
    // Chiave PUBBLICA dell'estensione. Fissa l'extension ID a
    //   ihpknodkjnjcbdfmdneeeollnedbdcpd
    // su OGNI macchina. Senza, un'installazione unpacked deriva l'ID dal percorso
    // della cartella: dieci agenti = dieci ID diversi, e il backend con
    // AI_PROVIDER=anthropic rifiuta di partire con ALLOWED_ORIGIN='*', quindi non
    // esisterebbe un valore che funzioni per tutti. Da qui:
    //   ALLOWED_ORIGIN=https://traveler.my.site.com,chrome-extension://ihpknodkjnjcbdfmdneeeollnedbdcpd
    // NB: l'origin dell'estensione è la SECONDA voce e serve alla pagina delle
    // opzioni. La prima è l'origin della KB, perché la sidebar è un content
    // script e in MV3 il suo fetch porta l'Origin della pagina ospite (Chrome
    // ha rimosso il bypass CORS per i content script nella 85). Ammettere solo
    // questo ID farebbe funzionare il test di connessione e fallire la sidebar.
    // La chiave PRIVATA corrispondente NON sta nel repo (vedi .gitignore): serve
    // solo per firmare un .crx, ma perderla significa non poter più aggiornare
    // mantenendo lo stesso ID.
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtKvotfFSjONE4yfAj50TDt8uH1QLuxH+OOfyvs0jwcFC7jusaYjq61dNewjr/6ocnQ6cDNYE9u+HP+tqrFyjEUhTfz8EfvglpIasYIDE36Td8M/g3ya5dJHMQAtA9cpitCdpttRnfTy4J6QaAMcfkn2lKTnJMPxJezd2AsrMJB28FXixVsnvVgGicFoDNxpqke9LU3iHr1XteFzkQnrBlmnvf5prZdkewL1onMeZT534130QiB+n/8zfRuYSq4T87EFuahZ+3V6+UumY5f5xh0b/2Fq0PnFiI5ZhPCcn1VL7oVwK/GxtMth7lt4E6CK8n3yuaK76vNDeOe15mK1byQIDAQAB',
    // Un permesso in più è una riga in più nel consenso all'installazione, e
    // quella schermata è la prima cosa che vede l'agente (e il CED). Qui c'è
    // solo `storage` per le impostazioni: `activeTab` e `scripting` non erano
    // usati da nessuna riga di codice, la sidebar è un content script dichiarato.
    permissions: ['storage'],
    // Solo la KB. Prima c'era anche `*://*.wikipedia.org/*` per le prove: il
    // consenso diceva "Leggi e modifica i tuoi dati su wikipedia.org" e la
    // sidebar si iniettava su ogni pagina Wikipedia aperta dall'agente per sé.
    host_permissions: ['https://traveler.my.site.com/*'],
    // Icona nella barra di Chrome: apre la pagina di configurazione. Senza,
    // l'unico segno che l'estensione è installata è la sidebar iniettata, e
    // l'installatore non ha modo di impostare l'URL del backend.
    action: { default_title: 'Runway Surfer — configurazione' },
    // Generate da shared/logo_v2_alpha.png con `node docs/build-icons.mjs`.
    // La cartella è `icons/` (plurale) di proposito: WXT scoprirebbe da sé
    // `public/icon/`, e due sorgenti per lo stesso campo del manifest sono un
    // modo garantito di non capire più quale vince.
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    // Permette al CED di imporre l'URL del backend via policy aziendale invece
    // di configurare dieci postazioni a mano (vedi lib/messaging.ts).
    storage: { managed_schema: 'managed-schema.json' },
  },
});
