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

Cuore della sidebar: stato, orchestrazione e JSX.

Contiene:

- stato UI: aperta/chiusa, query, loading, errore, avviso, risultato, thread;
- le tre modalità (`Immersiva` / `Background` / `Analisi Articolo`) come segmented
  control in cima — le **etichette** sono cambiate, i valori interni (`visual` /
  `follow` / `single`) no, perché su quelli ramificano `run()`, il driver del tour
  e `supportedModes` lato server;
- l'interruttore "È un caso Schedule Change?", che scambia il prompt libero col form;
- `searchWholeKb()`: indice KB → `/rank` → lettura (fetch + iframe nascosto). Unico
  punto usato da tre chiamanti: modalità Background, richiesta strutturata e
  allargamento automatico;
- `run()`, il flusso operativo principale;
- `runAsk()`, che accoda ogni turno concluso a `thread` (lo storico rimandato al
  modello vive nel client: il backend è stateless).

La funzione `run()` fa:

```text
1. se il form è compilato → cerca in tutta la KB coi suoi campi e chiude qui
2. legge la pagina corrente ed estrae i link interni
3. modalità Background → searchWholeKb()
   altrimenti, se isOffTopic() → searchWholeKb() + avviso all'agente
4. riusa le pagine dei turni precedenti invece di rileggerle
5. chiama il backend e aggiorna la risposta mentre arriva lo stream
```

### Altri componenti della sidebar

- `Logo.tsx` — marchio condiviso (`shared/logo.svg`), header/launcher/banner.
- `OutcomeView.tsx` — resa della risposta: heading, elenchi, grassetto, chip delle
  fonti. Usato sia dal turno in streaming sia da ogni turno del thread.
- `ThreadView.tsx` — turni conclusi, collassabili; marca quelli usciti dal contesto.
- `ScheduleChangeForm.tsx` — form della richiesta strutturata + checkbox delle
  sezioni di output.
- `TourTimeline.tsx` — avanzamento della modalità immersiva e **unico** punto di stop.
- `useAutoGrow.ts` — la textarea segue il contenuto fino a 200px.
- `useTourDriver.ts` — macchina a stati del tour.

### `entrypoints/sidebar.content/style.css`

Stili della sidebar. I design token **non** stanno qui: arrivano da
`shared/theme.css`, lo stesso file che alimenta dashboard, pagine auth e FX del
tour (`tests/theme-tokens.test.ts` impedisce che qualcuno ne reintroduca una copia).

Classi principali:

- `.rs-launcher`: bottone quando sidebar e chiusa.
- `.rs-panel`: contenitore laterale.
- `.rs-header`: intestazione. `min-height: var(--rs-host-header-h, 56px)` — si
  allinea alla banda blu della KB, misurata a runtime da `lib/host-chrome.ts`.
- `.rs-body` / `.rs-footer`: corpo scorrevole e footer ancorato (utente + logout).
- `.rs-segmented` / `.rs-seg`: selettore di modalità e di Flight Type.
- `.rs-switch`: interruttore Schedule Change.
- `.rs-input`: textarea domanda (altezza gestita da `useAutoGrow`).
- `.rs-form`: form della richiesta strutturata.
- `.rs-submit`: bottone invio. `.rs-new`: "+" che azzera il thread.
- `.rs-plan`: box modello/token/costo/contesto.
- `.rs-outcome` / `.rs-list` / `.rs-sources`: risposta finale.
- `.rs-thread` / `.rs-turn`: turni precedenti.
- `.rs-notice`: avviso non bloccante (es. allargamento della ricerca).

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
- `SHORTLIST_SIZE = 40`: candidati inviati al reranker. È il tetto che il backend
  già accettava (`MAX_RANK_CANDIDATES`); il client ne mandava 30 e quei 10 posti
  erano sprecati.
- `planQuery()`: tutto ciò che dipende dalla sola query, calcolato **una volta**
  invece che per ognuno dei 2964 candidati. Tiene separate le parole scritte
  dall'agente dai sinonimi che iniettiamo noi, perché pesano diversamente: un hit
  su una nostra espansione vale 3 contro i 5 di una parola vera. Pesarli uguale
  seppelliva `asc queues asc` sotto i 21 articoli che scrivono «airline schedule
  change» per esteso — cioè sotto l'espansione di ASC stesso. Il ponte IT→EN non
  ne soffre: in una query tutta italiana ogni match è un'espansione, quindi la
  scala è uniforme.
- `pickRelevantLinks()`: sceglie i link piu rilevanti.
- `shortlistCandidates()`: la shortlist ampia per il reranker, senza i gate di
  `dynamicSelection` — qui il prefiltro deve garantire il **recall**, non scegliere.
- `retrievalEvidence()`: quanti candidati e con che punteggio, per `assessQuery()`.
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
- `banner.ts`: banner di avanzamento fisso in alto (marchio, "passo N/M",
  narrazione typewriter `narrate()`, barra di progresso con percentuale). Non ha
  il bottone Interrompi: si ferma dalla timeline in sidebar (`TourTimeline`),
  unico punto di stop. `setBannerOffset()` scrive `--rs-fx-right` su `<html>` così
  il vetro della barra si arresta al bordo del pannello anche dopo un resize;
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

- `buildSystemPrompt(options)`: istruzioni al modello. Condizionale: cambia con le
  sezioni richieste dal form, e aggiunge righe quando c'è uno storico.
- `buildUserContent()`: impacchetta storico, form, query, pagine KB e link in un
  **singolo messaggio utente**, non in un array `messages[]` — così la stima di
  costo in `routes/ask.ts`, che misura il prompt renderizzato, resta esatta senza
  duplicare la logica di composizione.
- `outcomeSections(requested?)`: le sezioni della risposta. I titoli vengono da
  `shared/sections.json` (unica fonte, letta anche dall'estensione): le fonti sono
  sempre ultime e mai opzionali, perché la sidebar ci aggancia i chip cliccabili.
- `maxOutputTokens()`: budget di output, cresce con pagine e sezioni richieste.
- `systemPromptOptionsFor()`: un solo punto che deriva le opzioni dalla richiesta,
  così stima e chiamata reale non possono costruire prompt diversi.
- `ASSUMED_OUTPUT_TOKENS`, `ANTHROPIC_EGRESS`.

Se vuoi cambiare il formato della risposta AI, parti da qui — e dai titoli in
`shared/sections.json`.

### `server/src/itinerary.ts`

`parseCityPair()`: da "Milano-Parigi" a "MIL-PAR". Mappa seed delle città più
frequenti; ciò che non si risolve passa intatto e viene segnalato.

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

- `max_tokens` (delegato a `maxOutputTokens()`);
- parametri SDK;
- streaming reale;
- eventuali opzioni modello;
- `rankCandidates()`: selezione articoli via `tool_use` forzato su
  `select_articles`. È ciò che rende utile la ricerca su tutta la KB — l'indice
  offre 2964 articoli, ma solo un giudizio semantico sa quale risponde a un quesito
  posto in italiano su articoli scritti in inglese. `parseRankSelection` scarta
  qualunque id non presente fra i candidati, quindi un modello che inventa non può
  far leggere una pagina non richiesta. Su errore la rotta `/rank` risponde
  `{selectedUrls: []}` e il client ricade sullo scoring locale.

## Asset condivisi (`shared/`)

Un solo posto per ciò che serve a più superfici. Il server non può importarli
(`rootDir: "src"`), quindi li legge da disco a runtime tramite
`server/src/shared-assets.ts`; l'estensione li importa direttamente.

- `theme.css` — design token (`:root, :host`). Sidebar, dashboard, pagine auth, FX.
- `logo.svg` — marchio, dimensionato dal contenitore.
- `sections.json` — titoli delle sezioni di output e campi del form Schedule Change.
- `contracts.d.ts` — tipi condivisi con il backend.

## Ricerca su tutta la KB e fuori tema

- `lib/kb-index.json` + `lib/kb-index.ts` — indice statico di tutti gli articoli.
  `cleanKbLabel()` ripara le 14 label con mojibake **senza toccare URL e slug**:
  quella `â` è un em-dash che Salesforce ha mal codificato nello slug stesso, e
  l'URL reale contiene `%C3%A2`. Riscriverlo romperebbe il link.
- `lib/kb-ranges.ts` — la KB archivia i vettori per **intervallo alfabetico**
  (`Global airline schedule change policies I L`), e il nome cercato non compare
  nel titolo: 48 articoli in 21 famiglie. `parseKbRange()` scompone la label in
  famiglia + estremi (scartando gli intervalli discendenti, che sono i due falsi
  positivi reali dell'indice: «only U S» e «team S O»); `nameInitials()` ricava
  l'iniziale del nome cercato — anche da un codice vettore, `TK` → *turkish* →
  `T` — e `rangeInitialBoost()` premia il fratello che la copre. Additivo: nessun
  candidato può uscire dalla shortlist per colpa sua, quindi il caso peggiore è
  il comportamento precedente. Conta soprattutto sul percorso **locale**, quando
  `/rank` scade e non c'è alcuna AI a scegliere il fratello giusto.
- `lib/off-topic.ts` — `isOffTopic()`: la domanda c'entra con la pagina aperta? Due
  segnali, entrambi necessari: bassa copertura dei termini **e** un candidato che
  batte la pagina secondo lo stesso scorer. Serve a evitare la risposta
  strutturalmente sbagliata quando l'agente chiede altro rispetto all'articolo che
  ha davanti — caso normale nell'uso quotidiano, non eccezione.
- `lib/host-chrome.ts` — misura la banda blu della pagina host per allinearci a
  essa. Candidati per nome, sonda geometrica di riserva, `ResizeObserver`, e
  override manuale in `browser.storage.local` (`rs:hostHeaderHeight`) se
  l'euristica sbaglia sulla KB reale.

## Resilienza e dati (verso il rilascio)

Tre moduli piccoli che esistono per motivi operativi, non architetturali.

- `lib/abort.ts` — `withTimeout()`. Non usa `AbortSignal.timeout()`+`any()` perché
  servono due cose che quelle primitive non danno: distinguere "tempo scaduto" da
  "l'agente ha premuto Stop" (con un signal combinato l'abort arriva identico e la
  sidebar mostrerebbe un errore dove non c'è nulla di rotto), e un timeout di
  **inattività** riarmabile a ogni chunk — su uno stream la durata lunga è
  legittima, il silenzio no. Usato da `client.ts` (30s di silenzio su `/ask`),
  `auth.ts` (10s) e `crawl.ts` (8s per pagina).
- `lib/scrub.ts` — `scrubPii()` redige email, PNR, numero di biglietto, carta
  (con Luhn) e telefono **prima** che il testo lasci il browser; `redactionNotice()`
  produce l'avviso mostrato in sidebar, perché una redazione silenziosa lascerebbe
  l'agente senza capire perché la risposta ignora un dettaglio. Non si applica al
  testo degli articoli KB: è contenuto aziendale, e passarlo al setaccio
  corromperebbe la fonte. Un PNR richiede lettere **e** cifre (una parola in
  stampatello non è un codice) e i numeri di volo tipo `LH1234` sono esclusi.
- `server/src/http.ts` — `asyncRoute()`. Express 4 non conosce le Promise: la
  rejection di un handler `async` non raggiunge il middleware d'errore e su Node
  termina il processo. Ogni handler async passa da qui, altrimenti l'error
  middleware in `app.ts` non vedrebbe nulla.

Guardrail di spesa: **budget mensile in euro** (`max_monthly_estimated_cost_eur`,
default €70). La fonte unica è `estimatedCostMonthToDate()` in `server/src/db.ts`
(somma da SQLite dall'inizio del mese UTC); `estimatedCostEurThisMonth()` in
`metrics.ts` la converte con `USD_PER_EUR` — il listino dei modelli è in dollari,
il budget in euro. Lo stesso valore lo applica `canAcceptRequest()` e lo mostra la
dashboard: prima erano due numeri diversi e nessuno dei due copriva un periodo
definito. `metrics.totalEstimatedCostUsd` resta come metrica live dall'ultimo
avvio e **non** è un guardrail. Il cambio è fisso e documentato: va bene per un
tetto di spesa, non per la contabilità.

## Feedback e qualità della risposta

Il canale che dice se il prodotto funziona davvero, che i test non possono dare.

- `entrypoints/sidebar.content/FeedbackPanel.tsx` — 👍/👎 + commento opzionale dal
  footer. Il commento passa da `scrubPii` come la query: è testo libero scritto al
  telefono, il posto più probabile in cui finisca un dato del cliente. Un invio
  fallito non interrompe nulla.
- `server/src/outcome-audit.ts` — `countCitedSources()`. Esiste perché il dato non
  era ricavabile: `requests.sources_json` contiene le pagine **fornite** al modello,
  non quelle citate, e il server non conserva il testo della risposta. Si contano gli
  URL distinti sotto `## Fonti` mentre lo stream passa e si salva **solo il numero**
  in `requests.cited_sources` (migrazione `user_version` 4, nullable: NULL = «non
  misurato», e la dashboard segnala `= 0`, non NULL).
- `listFlaggedRequests()` in `server/src/db.ts` — due regole: `status` error/rejected
  = guasto tecnico; `status='ok' AND cited_sources=0` = il modello non ha citato
  nulla, cioè il modo in cui dice «non l'ho trovato». Il secondo è il segnale più
  utile per capire quali buchi ha la KB.
- `lib/query-quality.ts` — `assessQuery()` suggerisce, non blocca. Copre il buco per
  cui `"e poi?"` partiva senza avvisi: `pageCoverage` scarta le parole sotto 4
  lettere, quindi ritornava 1 (copertura massima), `isOffTopic` diceva no e la
  risposta si appoggiava alla pagina aperta per caso — col router che la
  classificava `simple`, assegnandole il modello meno capace.
  Giudica sull'**evidenza del prefiltro** (`retrievalEvidence()` in
  `lib/crawl.ts`), non contando le parole: la versione a conteggio dava il
  verdetto rovesciato sulle query vere — segnalava `relocation`, che di candidati
  ne ha 323, e taceva su `booking refund`, che ne ha 479. Segnala due casi solo,
  quelli che l'evidenza sostiene: zero candidati, e nessun titolo che contenga i
  termini (il caso dei refusi, `SAFTY` arriva a 4 su una soglia di 5). Non prova
  a segnalare `tier`, che è un disallineamento di significato — l'agente intende
  i livelli fedeltà, la KB l'escalation interna — e che dall'evidenza appare
  identico a `ndc`, che invece è preciso.
- `AiPlan.requestId` (`shared/contracts.d.ts`) esiste solo per legare un feedback
  alla riga di audit. Va generato **prima** della costruzione del plan in
  `routes/ask.ts`.

## Configurazione del rilascio

- `wxt.config.ts` contiene la chiave **pubblica** dell'estensione: l'ID è fisso
  (`ihpknodkjnjcbdfmdneeeollnedbdcpd`) su ogni macchina, quindi
  `ALLOWED_ORIGIN=chrome-extension://<id>` è un solo valore. La privata è fuori dal
  repo (`.gitignore`).
- `entrypoints/options/` — pagina di configurazione dell'URL del backend, con
  "Testa connessione" su `/health`. Prima l'unico modo era scrivere in
  `storage.local` dalla console DevTools, su ogni postazione.
- `getProxyUrl()` in `lib/messaging.ts` legge `storage.managed` (policy aziendale,
  vince sempre) → `storage.local` → default. Lo schema della policy è in
  `public/managed-schema.json`.
- `docs/INSTALLAZIONE-PILOTA.md` e `docs/RUNBOOK-BACKEND.md` — procedura per chi
  installa e per chi tiene in piedi il servizio.
- `docs/build-icons.mjs` — genera `public/icons/{16,32,48,128}.png` da
  `shared/logo_v2_alpha.png`. Decodifica/ricodifica PNG a mano (zlib + CRC32,
  riduzione a box filter con alpha premoltiplicato) per non aggiungere una
  dipendenza nativa alla build per quattro file rigenerati una volta a ogni
  cambio di logo. Gestisce solo PNG 8 bit non interlacciati e si ferma con un
  messaggio esplicito su tutto il resto.

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
