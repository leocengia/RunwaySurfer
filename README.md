# RunwaySurfer

Vedi anche [CODEMAP.md](CODEMAP.md) per una mappa operativa dei file e dei punti di modifica.

Sidebar Extension for Runway KB (T1 & Relo Workflow Automation).

AI sidebar che aiuta gli agenti di call center a navigare la Knowledge Base e a ottenere un outcome operativo: procedura, eccezioni, risposta al cliente e fonti.

## Stato

- Estensione Chrome MV3 reale con sidebar React, iniettata via Shadow DOM.
- Proxy backend reale: model routing, stima token/costo, streaming SSE.
- Dashboard backend reale: health/config/metrics, storico SQLite, utenti/team e azioni eseguibili via browser.
- Chiamate AI stubbate di default con `AI_PROVIDER=mock`.
- KB demo = Wikipedia (`*.wikipedia.org`), con lettura pagina e fetch same-origin dei link.

## Struttura

```text
entrypoints/         estensione browser
lib/                 estrazione DOM, crawl same-origin, client SSE, contratti dati
server/              proxy backend, dashboard, provider mock/anthropic
server/data/         DB SQLite runtime, ignorato da git
server/BACKEND-REQUIREMENTS.md   requisiti server/rete per il CED
```

## Avvio della demo

### 1. Backend

```bash
cd server
npm install
ADMIN_BOOTSTRAP_PASSWORD=cambiami-subito npm run dev
```

`ADMIN_BOOTSTRAP_PASSWORD` serve solo al primo avvio: crea l'utente `admin`
(personalizzabile con `ADMIN_USERNAME`) con cambio password obbligatorio al
primo login. Ai riavvii successivi viene ignorata.

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

Apri una pagina Wikipedia, premi il launcher in basso a destra ed effettua il
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

`server/data/` e ignorata da git: fare backup o retention di `runwaysurfer.db` secondo policy aziendale. La retention default dello storico e 90 giorni.

## Passare alle chiamate AI reali

Nel backend imposta:

```bash
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...
```

La API key vive solo nel backend. L'estensione continua a parlare con il proxy.

## Configurazione URL proxy

La sidebar usa `http://localhost:8787` di default. In futuro puo essere sovrascritta da configurazione centralizzata o da `chrome.storage.local.proxyUrl`.
