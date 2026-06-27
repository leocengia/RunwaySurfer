# RunwaySurfer Code Map

Guida rapida per capire cosa fa cosa e dove intervenire.

## In 30 Secondi

RunwaySurfer ha due parti:

- `entrypoints/` + `lib/`: estensione Chrome. Legge la pagina KB, mostra la sidebar, invia la richiesta.
- `server/`: backend proxy. Riceve la richiesta, sceglie il modello, costruisce il prompt, streamma la risposta.

Flusso principale:

```text
Pagina web KB
  -> content script WXT
  -> sidebar React
  -> estrazione testo/link pagina
  -> POST /ask al backend
  -> router modello/costo
  -> provider mock o Anthropic
  -> risposta streaming nella sidebar
```

## Se Vuoi Cambiare...

| Obiettivo | File da aprire | Cosa modificare |
| --- | --- | --- |
| Siti/pagine dove compare l'estensione | `wxt.config.ts`, `entrypoints/sidebar.content/index.tsx` | `host_permissions` e `matches` |
| Testi, layout logico, pulsanti, checkbox | `entrypoints/sidebar.content/App.tsx` | JSX, stati React, funzione `run()` |
| Aspetto grafico della sidebar | `entrypoints/sidebar.content/style.css` | classi `.rs-*` |
| Cosa viene letto dalla pagina corrente | `lib/extract.ts` | selettori, pulizia DOM, limite testo |
| Quanti link collegati legge | `lib/crawl.ts` | `MAX_FOLLOW` |
| Come sceglie i link rilevanti | `lib/crawl.ts` | `scoreLink()`, `keywordsOf()`, `pickRelevantLinks()` |
| URL del backend usato dalla sidebar | `lib/messaging.ts` | `DEFAULT_PROXY_URL` oppure `chrome.storage.local.proxyUrl` |
| Chiamata streaming al backend | `lib/client.ts` | `streamAsk()` |
| Contratti dati extension/backend | `lib/outcome.ts`, `server/src/types.ts` | `AskRequest`, `AskEvent`, `AiPlan` |
| Endpoint backend | `server/src/index.ts` | `/health`, `/requirements`, `/ask` |
| Scelta modello e costi | `server/src/router.ts` | `MODELS`, `chooseModel()`, soglie token/pagine |
| Prompt AI | `server/src/provider/shared.ts` | `buildSystemPrompt()`, `buildUserContent()` |
| Risposta demo/mock | `server/src/provider/mock.ts` | `buildOutcome()` |
| Provider AI reale | `server/src/provider/anthropic.ts` | `max_tokens`, parametri SDK, streaming |
| Deploy container | `server/Dockerfile` | immagine, porta, env default |
| Deploy Linux systemd | `server/deploy/runwaysurfer.service` | path, utente, env file |

## File Chiave

### `wxt.config.ts`

Configura l'estensione Chrome generata da WXT.

Qui sono importanti:

- `manifest.name`: nome estensione.
- `permissions`: permessi Chrome.
- `host_permissions`: domini su cui l'estensione puo leggere/fare fetch.

Per passare da Wikipedia alla KB reale, questo e uno dei file da modificare.

### `entrypoints/sidebar.content/index.tsx`

Punto di ingresso del content script.

Fa tre cose:

- decide su quali URL partire con `matches`;
- crea uno Shadow DOM;
- monta il componente React `App`.

Se la sidebar non appare su un sito, controllare prima questo file e `wxt.config.ts`.

### `entrypoints/sidebar.content/App.tsx`

Cuore della sidebar.

Contiene:

- stato UI: aperta/chiusa, query, loading, errore, risultato;
- checkbox per leggere pagine collegate;
- funzione `run()`, cioe il flusso operativo principale;
- rendering del piano AI, risposta, pagine usate.

La funzione `run()` fa:

```text
1. legge la pagina corrente
2. estrae link interni
3. se abilitato, segue alcuni link
4. chiama il backend
5. aggiorna la risposta mentre arriva lo stream
```

### `entrypoints/sidebar.content/style.css`

Stili della sidebar.

Classi principali:

- `.rs-launcher`: bottone quando sidebar e chiusa.
- `.rs-panel`: contenitore laterale.
- `.rs-header`: intestazione.
- `.rs-input`: textarea domanda.
- `.rs-submit`: bottone invio.
- `.rs-plan`: box modello/token/costo.
- `.rs-outcome`: risposta finale.

## Lettura Pagine Web

### `lib/extract.ts`

Legge la pagina corrente dal DOM gia caricato nel browser.

Punti importanti:

- `MAX_PAGE_CHARS`: limite caratteri per pagina.
- `CONTENT_SELECTORS`: selettori usati per trovare il contenuto principale.
- `extractPageText()`: pulisce e compatta il testo.
- `extractInternalLinks()`: raccoglie link same-origin.
- `extractCurrentPage()`: costruisce l'oggetto `KbPage`.

Questa parte e custom, non una libreria di scraping esterna.

### `lib/crawl.ts`

Segue alcuni link collegati.

Punti importanti:

- `MAX_FOLLOW = 3`: massimo pagine collegate lette.
- `pickRelevantLinks()`: sceglie i link piu rilevanti.
- `fetchPage()`: scarica la pagina con `credentials: 'include'`.
- `shallowFollow()`: esegue il mini-crawl a un livello.

Nota aziendale: `credentials: 'include'` riusa la sessione browser. Su KB aziendale significa riusare SSO dell'agente.

### `lib/client.ts`

Client HTTP streaming.

`streamAsk()` fa `POST /ask` al backend e legge eventi SSE:

- `plan`: modello/costo/token.
- `delta`: pezzi incrementali della risposta.
- `done`: completato.
- `error`: errore.

### `lib/messaging.ts`

Contiene il default backend:

```ts
DEFAULT_PROXY_URL = 'http://localhost:8787'
```

In produzione dovrebbe puntare a un endpoint aziendale, oppure essere configurato via `chrome.storage.local.proxyUrl`.

## Backend

### `server/src/index.ts`

Server Express.

Endpoint:

- `GET /health`: controllo vita.
- `GET /requirements`: requisiti server/rete per CED.
- `POST /ask`: endpoint principale.

Dentro `/ask` succede:

```text
1. valida body
2. sceglie provider mock/anthropic
3. sceglie modello
4. stima token e costo
5. manda evento plan
6. streamma risposta
```

Variabili ambiente:

- `PORT`: porta backend, default `8787`.
- `ALLOWED_ORIGIN`: CORS, default `*`.
- `AI_PROVIDER`: `mock` o `anthropic`.
- `ANTHROPIC_API_KEY`: chiave provider reale, solo lato server.

### `server/src/router.ts`

Decide quale modello usare.

Punti importanti:

- `MODELS`: id modello e prezzi.
- `estimateTokens()`: stima grezza caratteri/token.
- `chooseModel()`: regole di routing.
- `estimateCostUsd()`: stima costo.

Regole attuali:

- richiesta semplice -> Haiku;
- contesto medio -> Sonnet;
- sintesi multipagina/grande -> Opus.

### `server/src/provider/shared.ts`

Contiene prompt e interfaccia provider.

Punti importanti:

- `buildSystemPrompt()`: istruzioni generali al modello.
- `buildUserContent()`: impacchetta query, pagine KB e link.
- `ASSUMED_OUTPUT_TOKENS`: output previsto per stima costi.
- `ANTHROPIC_EGRESS`: host esterno dichiarato nei requisiti.

Se vuoi cambiare il formato della risposta AI, parti da qui.

### `server/src/provider/mock.ts`

Provider demo.

Non chiama nessuna AI. Genera una risposta simulata e la streamma a blocchi.

Da modificare se vuoi una demo piu realistica senza usare token AI.

### `server/src/provider/anthropic.ts`

Provider reale.

Usato solo con:

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=...
```

Qui si modificano:

- `max_tokens`;
- parametri SDK;
- streaming reale;
- eventuali opzioni modello.

## Checklist Per Interventi Rapidi

### Far funzionare su KB reale

1. Cambia `host_permissions` in `wxt.config.ts`.
2. Cambia `matches` in `entrypoints/sidebar.content/index.tsx`.
3. Verifica i selettori in `lib/extract.ts`.
4. Imposta backend aziendale in `lib/messaging.ts` o via storage.
5. Configura CORS nel backend con `ALLOWED_ORIGIN`.

### Cambiare comportamento della risposta AI

1. Modifica `buildSystemPrompt()` in `server/src/provider/shared.ts`.
2. Modifica le sezioni attese in `lib/outcome.ts`, se serve.
3. Aggiorna rendering in `App.tsx`, se cambi formato.
4. Se sei in demo, aggiorna anche `server/src/provider/mock.ts`.

### Cambiare strategia costi/modelli

1. Apri `server/src/router.ts`.
2. Aggiorna `MODELS`.
3. Cambia soglie in `chooseModel()`.
4. Verifica che `server/src/provider/anthropic.ts` supporti gli id modello scelti.

### Migliorare lettura pagine

1. Apri `lib/extract.ts`.
2. Aggiungi selettori specifici della KB in `CONTENT_SELECTORS`.
3. Aggiungi classi/elementi da rimuovere nella query dentro `extractPageText()`.
4. Aumenta o riduci `MAX_PAGE_CHARS`.
5. Se serve piu contesto, aumenta `MAX_FOLLOW` in `lib/crawl.ts`.

### Debug veloce

Backend:

```bash
cd server
npm run dev
```

Health:

```bash
curl http://localhost:8787/health
```

Requirements:

```bash
curl http://localhost:8787/requirements
```

Estensione:

```bash
npm run dev
```

Build estensione:

```bash
npm run build
```

Type check:

```bash
npm run compile
cd server
npm run compile
```

## Regola Mentale

Quando devi capire dove intervenire:

- problema UI -> `App.tsx` o `style.css`;
- problema sito/permessi -> `wxt.config.ts` e `index.tsx`;
- problema testo letto -> `lib/extract.ts`;
- problema pagine collegate -> `lib/crawl.ts`;
- problema connessione backend -> `lib/client.ts` e `lib/messaging.ts`;
- problema risposta AI -> `server/src/provider/shared.ts`;
- problema demo mock -> `server/src/provider/mock.ts`;
- problema modello/costo -> `server/src/router.ts`;
- problema deploy -> `server/Dockerfile` o `server/deploy/runwaysurfer.service`.

