# RunwaySurfer

Vedi anche [CODEMAP.md](CODEMAP.md) per una mappa operativa dei file e dei punti di modifica.

Sidebar Extension for Runway KB (T1 & Relo Workflow Automation).

AI sidebar che aiuta gli agenti di call center a navigare la Knowledge Base e a ottenere un outcome operativo: procedura, eccezioni, risposta al cliente e fonti.

## Stato

- Estensione Chrome MV3 reale con sidebar React, iniettata via Shadow DOM.
- Proxy backend reale: model routing, stima token/costo, streaming SSE.
- Dashboard backend reale: health/config/metrics, storico SQLite, utenti/team e azioni eseguibili via browser.
- Chiamate AI stubbate di default con `AI_PROVIDER=mock`.
- KB reale = Salesforce Experience Cloud (`https://traveler.my.site.com/Runway/*`),
  con lettura pagina e fetch same-origin dei link, riusando la sessione SSO
  dell'agente.

## Struttura

```text
entrypoints/         estensione browser (sidebar React, form auth, driver del tour)
lib/                 estrazione DOM, crawl same-origin, client SSE, auth, tour
shared/              contratti dati condivisi estensione/backend (solo tipi)
server/src/          proxy backend: app Express, routes/, views/, provider mock/anthropic
server/tests/        test backend (Vitest + supertest)
tests/               test estensione (Vitest + happy-dom)
server/data/         DB SQLite runtime, ignorato da git
server/BACKEND-REQUIREMENTS.md   requisiti server/rete per il CED
.github/workflows/   CI: typecheck, lint, format check, test e build
```

## Avvio della demo

Prerequisito: Node.js 20 o superiore (consigliata la LTS 22, vedi `.nvmrc`).
Scaricabile da <https://nodejs.org> oppure via `nvm use`.

### 1. Backend

```bash
cd server
npm install
cp .env.example .env     # e imposta almeno ADMIN_BOOTSTRAP_PASSWORD
npm run dev
```

`server/.env` viene letto davvero all'avvio (vedi `src/load-env.ts`); le
variabili già presenti nell'ambiente vincono sul file, quindi un
`PORT=9000 npm run dev` continua a funzionare. Su Windows conviene il file,
perché la sintassi `VAR=x comando` non esiste in `cmd.exe` né in PowerShell.

`ADMIN_BOOTSTRAP_PASSWORD` serve solo al primo avvio: crea l'utente `admin`
(personalizzabile con `ADMIN_USERNAME`) con cambio password obbligatorio al
primo login. Ai riavvii successivi viene ignorata — senza di essa, su un database
vuoto il servizio parte ma la dashboard è inaccessibile, e l'unico segnale è una
riga `[auth]` nei log.

Per provare il percorso HTTPS di produzione in locale, senza il rack:

```bash
TLS_CERT_PATH=tests/fixtures/tls/test-only.crt \
TLS_KEY_PATH=tests/fixtures/tls/test-only.key \
PORT=8443 npm run dev
```

Verifica:

```bash
curl http://localhost:8787/health
```

Dashboard (richiede login):

```text
http://localhost:8787/dashboard
```

Oppure via Docker:

```bash
cd server
docker build -t runwaysurfer-proxy .
docker run -p 8787:8787 runwaysurfer-proxy
```

### 2. Estensione

```bash
npm install
npm run dev
```

Carica `.output/chrome-mv3-dev` da `chrome://extensions` → Modalità sviluppatore →
_Carica estensione non pacchettizzata_.

La sidebar si inietta **solo** sugli articoli della KB reale
(`https://traveler.my.site.com/Runway/*`), quindi per vederla serve una sessione
autenticata su quel sito: non esiste una KB di prova locale. Apri un articolo,
premi il launcher in basso a destra ed effettua il
login con le credenziali fornite dall'amministratore (create dalla dashboard);
al primo accesso viene richiesto il cambio della password temporanea. Poi
scrivi una richiesta e invia. Il token di sessione resta in
`chrome.storage.local` per 30 giorni o fino al logout/revoca.

## Dashboard, utenti e storico SQL

Il backend usa SQLite tramite `better-sqlite3` e crea automaticamente:

```text
server/data/runwaysurfer.db
```

Il DB locale contiene metadati operativi, non il testo completo della KB:

- utenti e team (con hash password `scrypt` per il login);
- sessioni attive di dashboard ed estensione (token hashati);
- richieste con query preview/hash;
- modello scelto, token stimati, costo stimato, durata e stato;
- link selezionati e fonti in JSON;
- settings di concorrenza/budget usati da `/extension-config`.

Endpoint principali (tutti autenticati tranne `/health` e `/auth/login`):

```bash
# login (rilascia un token Bearer per gli esempi curl)
curl -X POST http://localhost:8787/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"...","client":"extension"}'

TOKEN=...   # dal campo "token" della risposta
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/users
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/teams
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/requests
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/analytics/summary
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/settings
```

La dashboard permette di eseguire questi endpoint direttamente, creare
utenti/team (con password temporanea e cambio obbligatorio al primo login),
resettare password, modificare settings e inviare una richiesta demo a `/ask`.
Ruoli: `admin` ha pieno controllo, `team_lead` vede la dashboard in sola
lettura, `agent` accede solo a `/ask` e `/extension-config` dall'estensione.

`server/data/` e ignorata da git: fare backup di `runwaysurfer.db` secondo policy aziendale. La retention dello storico (default 90 giorni, setting `retention_days`) viene applicata automaticamente da un job giornaliero all'avvio del backend; `POST /maintenance/prune` resta disponibile per una pulizia manuale immediata.

## Passare alle chiamate AI reali

Nel backend imposta:

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
ALLOWED_ORIGIN=https://traveler.my.site.com,chrome-extension://<id-estensione>
```

La API key vive solo nel backend. L'estensione continua a parlare con il proxy.
Con il provider reale `ALLOWED_ORIGIN` è obbligatoria: il server rifiuta di
avviarsi con CORS aperto (`*`) o senza l'origin della KB.

Sono **due** origin di proposito. La sidebar è un content script dentro la pagina
della KB e in Manifest V3 le sue chiamate portano l'`Origin` della pagina
(`https://traveler.my.site.com`), non dell'estensione: senza quella voce il
browser blocca tutto. La seconda serve alla pagina delle opzioni e al suo
pulsante «Test connessione».

## Sviluppo

In entrambi i package (radice = estensione, `server/` = backend):

```bash
npm run compile   # typecheck (tsc --noEmit)
npm run lint      # ESLint
npm test          # test Vitest
```

Alla radice sono disponibili anche `npm run format` / `format:check` (Prettier).
La CI (`.github/workflows/ci.yml`) esegue tutti i controlli su push e pull request.

## Configurazione URL proxy

La sidebar risolve l'indirizzo del backend in tre livelli (`getProxyUrl` in
`lib/messaging.ts`):

1. `storage.managed` — policy aziendale via GPO: vince su tutto e appare bloccata
   nella pagina di configurazione;
2. `storage.local` — valore salvato dalla pagina di configurazione
   (icona nella barra di Chrome);
3. `http://localhost:8787` come default, che resta tale di proposito: è l'unico
   valore che funziona senza infrastruttura. L'hostname di produzione **non** sta
   nel codice, così cambiarlo è un valore di policy e non una nuova build da
   ridistribuire.
