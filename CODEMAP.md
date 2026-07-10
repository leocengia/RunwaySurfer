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

| Obiettivo                                | File da aprire                                           | Cosa modificare                                            |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| Siti/pagine dove compare l'estensione    | `wxt.config.ts`, `entrypoints/sidebar.content/index.tsx` | `host_permissions` e `matches`                             |
| Testi, layout logico, pulsanti, checkbox | `entrypoints/sidebar.content/App.tsx`                    | JSX, stati React, funzione `run()`                         |
| Form di login / cambio password sidebar  | `entrypoints/sidebar.content/AuthForms.tsx`              | `LoginForm`, `ChangePasswordForm`                          |
| Macchina a stati del tour visivo         | `entrypoints/sidebar.content/useTourDriver.ts`           | fasi `returning/scrolling/navigating/asking`               |
| Aspetto grafico della sidebar            | `entrypoints/sidebar.content/style.css`                  | classi `.rs-*`                                             |
| Cosa viene letto dalla pagina corrente   | `lib/extract.ts`                                         | selettori, pulizia DOM, limite testo                       |
| Quanti link collegati legge              | `lib/crawl.ts`                                           | `MAX_FOLLOW`                                               |
| Come sceglie i link rilevanti            | `lib/crawl.ts`                                           | `scoreLink()`, `keywordsOf()`, `pickRelevantLinks()`       |
| URL del backend usato dalla sidebar      | `lib/messaging.ts`                                       | `DEFAULT_PROXY_URL` oppure `chrome.storage.local.proxyUrl` |
| Chiamata streaming al backend            | `lib/client.ts`                                          | `streamAsk()`                                              |
| Contratti dati extension/backend         | `shared/contracts.d.ts`                                  | `AskRequest`, `AskEvent`, `AiPlan` (unica fonte di verità) |
| Endpoint /ask                            | `server/src/routes/ask.ts`                               | validazione, guardrail, streaming SSE                      |
| Endpoint auth                            | `server/src/routes/auth-routes.ts`                       | login/logout/me/change-password                            |
| Endpoint admin (utenti/team/settings)    | `server/src/routes/admin.ts`                             | guardie `requireAuth(ruolo)`                               |
| Pagine HTML (login/dashboard)            | `server/src/routes/pages.ts`, `server/src/views/`        | template dashboard e pagine auth                           |
| Composizione app Express                 | `server/src/app.ts`                                      | middleware CORS/sicurezza, montaggio route                 |
| Retention automatica dello storico       | `server/src/maintenance.ts`                              | job giornaliero `startMaintenanceScheduler()`              |
| Scelta modello e costi                   | `server/src/router.ts`                                   | `MODELS`, `chooseModel()`, soglie token/pagine             |
| Prompt AI                                | `server/src/provider/shared.ts`                          | `buildSystemPrompt()`, `buildUserContent()`                |
| Risposta demo/mock                       | `server/src/provider/mock.ts`                            | `buildOutcome()`                                           |
| Provider AI reale                        | `server/src/provider/anthropic.ts`                       | `max_tokens`, parametri SDK, streaming                     |
| Deploy container                         | `server/Dockerfile`                                      | immagine, porta, env default                               |
| Deploy Linux systemd                     | `server/deploy/runwaysurfer.service`                     | path, utente, env file                                     |

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
DEFAULT_PROXY_URL = 'http://localhost:8787';
```

In produzione dovrebbe puntare a un endpoint aziendale, oppure essere configurato via `chrome.storage.local.proxyUrl`.

### `lib/fx/` — effetti del Tour visivo

Effetti scenografici iniettati nella pagina host durante il tour (vanilla
DOM+CSS, un solo `<style id="rs-fx-style">`, tutto con prefisso `rs-fx-`,
`prefers-reduced-motion` rispettato ovunque):

- `motion.ts`: easing, `sleep`, `smoothScrollTo` (scroll cinematico rAF ~950ms,
  annullato da un gesto dell'utente);
- `banner.ts`: banner di avanzamento fisso in alto (brand, "passo N/M",
  narrazione typewriter `narrate()`, barra progresso, bottone Interrompi che
  emette l'evento `rs-tour-abort` + scrive il flag storage `rs:tourAbort`);
- `spotlight.ts`: overlay a riflettore (gradiente radiale con buco che segue
  il link) + alone giallo pulsante su `.rs-tour-highlight`;
- `cursor.ts`: cursore AI fantasma che plana sul link con curva di Bézier e
  "clicca" con onda ripple prima della navigazione;
- `scan.ts`: fascio di scansione che percorre la pagina seguita mentre le
  keyword corrispondenti si illuminano (`mark.rs-scan-hit`, max 15, revert
  completo);
- `index.ts`: stili, `teardownFx()` idempotente (pulizia totale su stop/fine/
  re-init) e safety net bfcache su `pageshow`.

Orchestrazione: `useTourDriver()` in `entrypoints/sidebar.content/useTourDriver.ts`
(estratto da `App.tsx`); la scelta dell'URL finale del tour è la logica pura di
`lib/tour-target.ts`. Timing in `lib/tour.ts` (`dwellMs` 900 = hover sul link,
`scanMs` 1600 = durata scansione). `lib/highlight.ts` contiene solo
`findLinkElement()`.

## Backend

### Struttura `server/src/`

Il vecchio `index.ts` monolitico è stato spezzato:

- `index.ts`: entry point — guardie di configurazione, `initDb()`,
  `bootstrapAdmin()`, scheduler di retention, `listen`.
- `app.ts`: factory `createApp()` — CORS, header di sicurezza, montaggio route.
  Esportata senza `listen`, così i test la usano con supertest.
- `config.ts`: variabili d'ambiente e costanti globali.
- `metrics.ts`: metriche live in memoria + guardrail concorrenza/costo.
- `status.ts`: `extensionConfig()` e `dashboardData()`.
- `maintenance.ts`: job giornaliero di retention (storico + sessioni scadute).
- `routes/`: `ask.ts`, `auth-routes.ts`, `admin.ts`, `pages.ts`.
- `views/`: HTML di login/cambio password (`auth-pages.ts`) e dashboard
  (`dashboard.ts`), separati dalla logica delle route.

Dentro `POST /ask` (`routes/ask.ts`) succede:

```text
1. valida e sanifica il body (sanitizeRequest, esportata per i test)
2. applica i guardrail (concorrenza, budget)
3. sceglie modello e stima token/costo
4. manda evento plan
5. streamma risposta (provider mock o anthropic)
6. registra metrica live + storico SQLite
```

Variabili ambiente:

- `PORT`: porta backend, default `8787`.
- `ALLOWED_ORIGIN`: CORS, default `*` (solo demo; obbligatoria con provider reale).
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

## Test e Qualità

- `tests/` (radice): test dell'estensione con Vitest + happy-dom — scoring link
  (`crawl`), estrazione DOM (`extract`), parser SSE (`client`), scelta URL del
  tour (`tour-target`).
- `server/tests/`: test backend con Vitest — unit (router, auth, db su SQLite
  temporaneo) e integrazione dell'app Express con supertest (`api.test.ts`).
- Lint: ESLint flat config (`eslint.config.js` in radice e in `server/`).
- Formattazione: Prettier (`.prettierrc.json`), controllata in CI.
- CI: `.github/workflows/ci.yml` — compile, lint, format check, test e build
  per entrambi i package.

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

## Aggiornamento Backend SQL / Dashboard

### `server/src/db.ts`

Layer SQLite basato su `better-sqlite3`.

Gestisce:

- creazione automatica di `server/data/runwaysurfer.db`;
- schema `teams`, `users`, `requests`, `settings`, `sessions`;
- migrazione dello schema via `PRAGMA user_version` (colonne `password_hash` e
  `must_change_password` aggiunte ai DB creati prima del login);
- helper per credenziali e sessioni (`setUserPassword`, `getSessionWithUser`,
  `deleteUserSessions`, `sanitizeUser`, ...);
- storico richieste con query preview/hash, token, costo, modello, durata, stato;
- settings persistenti per limiti di concorrenza, budget, pagine/link e retention.

Il DB non salva il testo completo della KB per default.

### `server/src/auth.ts`

Layer autenticazione (solo `node:crypto`, nessuna dipendenza nuova):

- hash password `scrypt` (`hashPassword`/`verifyPassword`), formato
  `scrypt$N=...$salt$hash`;
- sessioni con token opachi (salvati SHA-256 in `sessions`): cookie `rs_session`
  HttpOnly per la dashboard (12h), Bearer per l'estensione (30 giorni);
- middleware `requireAuth(minRole)` per le API JSON e `requirePage(minRole)`
  per le pagine HTML (redirect a `/login` / `/change-password`);
- rate limiting in-memory sui login (5 tentativi / 15 min per IP+username);
- `bootstrapAdmin()`: crea il primo admin da `ADMIN_BOOTSTRAP_PASSWORD` /
  `ADMIN_USERNAME` al primo avvio.

### Endpoint backend aggiunti

In `server/src/routes/` (guardie: `admin` > `team_lead` > `agent`):

- `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`,
  `POST /auth/change-password`: ciclo di vita sessioni.
- `GET /login`, `GET /change-password`: pagine HTML di accesso.
- `GET /dashboard`: dashboard HTML operativa (login richiesto; team_lead in sola lettura).
- `GET /dashboard-data`: stato complessivo JSON (team_lead+).
- `GET /metrics`: contatori live in memoria (team_lead+).
- `GET /extension-config`: policy/config per l'estensione (autenticato).
- `GET /users` (team_lead+), `POST /users` (admin, richiede `tempPassword`),
  `PATCH /users/:id` (admin, disattivazione revoca le sessioni),
  `POST /users/:id/reset-password` (admin): gestione utenti.
- `GET /teams` (team_lead+), `POST /teams` (admin): gestione team.
- `GET /requests`, `GET /requests/:id`: storico richieste persistente (team_lead+).
- `GET /analytics/summary`: riepilogo storico da SQLite (team_lead+).
- `GET /settings` (team_lead+), `PATCH /settings` (admin): policy persistenti.
- `POST /maintenance/prune` (admin): rimozione storico oltre retention.
- `POST /ask`: ora richiede token Bearer; l'identità (`agent_id`) viene dalla
  sessione, gli header `x-agent-id`/`x-user-email` non sono più accettati.

### Dashboard eseguibile

La dashboard ora usa `fetch` lato browser per chiamare gli endpoint (il cookie
di sessione viaggia automaticamente, essendo same-origin):

- header con utente loggato e pulsante Logout;
- pulsanti health/metrics/config/requirements;
- form per creare team e utenti (con password temporanea) e reset password — solo admin;
- form per modificare settings — solo admin;
- filtri per storico richieste;
- form demo per inviare una richiesta `/ask` (attribuita all'utente loggato).

### Login nell'estensione

- `lib/auth.ts`: `login`/`logout`/`fetchMe`/`changePassword` + token in
  `chrome.storage.local` (`rs:authToken`).
- `lib/client.ts`: `streamAsk()` invia `Authorization: Bearer`; su 401 emette
  l'evento `auth-required` (definito in `lib/outcome.ts`).
- `entrypoints/sidebar.content/App.tsx`: stati `checking/loggedOut/mustChange/in`,
  form di login e cambio password nella sidebar, pulsante Logout.

### File runtime

`server/data/` e ignorato da git. Per backup o retention salvare/cancellare
`server/data/runwaysurfer.db` secondo policy aziendale.
