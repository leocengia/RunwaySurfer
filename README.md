# RunwaySurfer

Sidebar Extension for Runway KB (T1 & Relo Workflow Automation).

AI sidebar che aiuta gli agenti di call center a navigare la Knowledge Base e a
ottenere un **outcome operativo** (procedura, eccezioni, risposta al cliente, fonti).

## Stato: DEMO architetturale (walking skeleton)
- **Estensione Chrome (MV3)** reale con sidebar React, iniettata via Shadow DOM.
- **Proxy backend** reale: routing modello per difficoltà, stima token/costo, streaming SSE.
- **Chiamate AI stubbate** (`AI_PROVIDER=mock`): si vede *dove e cosa* il backend
  chiamerebbe (modello, prompt, stima token, egress) senza chiave/licenza.
- **KB demo = Wikipedia** (`*.wikipedia.org`): KB-like, link annidati, pubblica. Il
  meccanismo di lettura pagina + fetch same-origin dei link è identico a quello che su
  Runway userà la sessione **SSO** dell'agente.

## Struttura
```
entrypoints/         estensione (background, sidebar content-script React)
lib/                 estrazione DOM, crawl same-origin, client SSE, contratti dati
server/              proxy backend on-premise (router + provider mock/anthropic)
server/BACKEND-REQUIREMENTS.md   requisiti server/rete per il CED
```

## Avvio della demo

### 1. Backend (mock, nessuna chiamata esterna)
```bash
cd server
npm install
npm run dev            # avvia su http://localhost:8787
# verifica:
curl http://localhost:8787/health
curl http://localhost:8787/requirements
```
Oppure via Docker:
```bash
cd server && docker build -t runwaysurfer-proxy . && docker run -p 8787:8787 runwaysurfer-proxy
```

### 2. Estensione
```bash
npm install
npm run dev            # apre Chrome con l'estensione in dev (WXT)
# oppure: npm run build  → carica .output/chrome-mv3 come "unpacked" in chrome://extensions
```
Apri una pagina **Wikipedia**, premi il launcher 🏄 in basso a destra, scrivi una
richiesta (es. *"come funziona…"*) e invia.

## Passare alle chiamate AI reali (quando licenze/token sono pronti)
Nel backend imposta:
```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```
Nessun'altra modifica all'architettura: il router sceglie Haiku/Sonnet/Opus per
difficoltà e il provider reale effettua lo streaming da Claude.

## Configurazione URL proxy
La sidebar usa `http://localhost:8787` di default; sovrascrivibile salvando `proxyUrl`
in `chrome.storage.local` (poi: pagina opzioni dedicata).
