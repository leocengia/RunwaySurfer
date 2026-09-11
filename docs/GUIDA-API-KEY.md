# Guida: collegare la API key Anthropic reale

## A cosa serve

Oggi il backend gira in `AI_PROVIDER=mock` (default): risponde in modo deterministico, senza
nessuna chiamata a un modello vero, senza costi. Questa guida configura `AI_PROVIDER=anthropic`
per validare il comportamento reale — in particolare il **reranker** (`POST /rank`,
`server/src/provider/anthropic.ts`), che oggi in mock si limita a riordinare per punteggio
locale e quindi non misura nulla di nuovo.

Serve anche a sbloccare la **Fase 6** già progettata (vedi la memoria di progetto
`reranker-stato-fasi-1-5.md`): registrare le vere risposte del reranker una volta, con
`ReplayProvider` + `server/scripts/record-rank.ts` (da scrivere), così i test restano offline
per sempre dopo la prima registrazione. Non è necessaria per il tuning del prefiltro locale
appena fatto (I0-I4): quello si misura tutto offline, con `npx vitest run tests/rank-eval.test.ts`.

## 1. Procurare la chiave

1. Vai su **console.anthropic.com** e accedi (o crea un account).
2. Serve un metodo di pagamento collegato all'organizzazione (scheda **Billing**) — una carta
   aziendale va bene; è a consumo, non un abbonamento.
3. **Settings → API Keys → Create Key**. Dai un nome riconoscibile (es. `runwaysurfer-test`), così
   in futuro puoi revocarla senza toccare altre chiavi.
4. La chiave (`sk-ant-…`) si vede **una sola volta**: copiala subito in un posto sicuro (un
   password manager, non un file nel repo).

## 2. Configurare il backend

Nella cartella `server/`:

```
cp .env.example .env
```

`server/.env` è già letto all'avvio (`server/src/load-env.ts`) — non serve altro. In sviluppo
l'ambiente vince comunque sul file (`VAR=x npm run dev` funziona), in produzione questo file
non viene usato affatto (la unit systemd legge `/etc/runwaysurfer/runwaysurfer.env`).

Apri `server/.env` e imposta **tre variabili obbligatorie**:

```dotenv
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-...

# La KB è l'origin che conta: la sidebar è un content script iniettato nella
# pagina KB, e in Manifest V3 le sue chiamate viaggiano con l'Origin della
# PAGINA, non dell'estensione. Il secondo valore serve solo alla pagina delle
# opzioni (pulsante "Test connessione"). L'extension ID è fisso.
ALLOWED_ORIGIN=https://traveler.my.site.com,chrome-extension://ihpknodkjnjcbdfmdneeeollnedbdcpd
```

**Con `AI_PROVIDER=anthropic` il server rifiuta di partire se `ALLOWED_ORIGIN` è `*`**
(`server/src/config.ts:200-243`) — è deliberato: con il provider reale, mezza configurazione CORS
è un errore troppo costoso da scoprire in esercizio, quando gli agenti vedono solo un generico
"Backend non raggiungibile".

Facoltativa ma comoda per il primo accesso alla dashboard (`/dashboard`):

```dotenv
ADMIN_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=una-password-temporanea
```

## 3. Avviare e verificare

```
cd server
npm run dev
```

Cerca questa riga fra i log di avvio — conferma che `.env` è stato letto davvero:

```
[config] caricato .../server/.env
```

Poi:

- Apri la pagina delle opzioni dell'estensione e premi **Test connessione**: deve rispondere OK
  (usa la seconda origin di `ALLOWED_ORIGIN`).
- Da una pagina reale della KB, fai una domanda nella sidebar: se il rerank funziona, la
  scelta finale può differire da quella dello scoring locale — è il segnale che l'AI sta
  davvero giudicando, non solo passando comunque i punteggi locali (in `mock` coincidono sempre,
  per costruzione — `server/src/provider/mock.ts`).
- `GET /health` (vedi `server/src/routes/`) conferma che il processo risponde.

## 4. Costi e guardrail

Una domanda costa **circa $0,02-0,09** (dipende dal modello che il router sceglie in base alla
complessità, `server/src/router.ts`). Il rerank pesa pochissimo a parte: gira sempre su Haiku
con `max_tokens: 256` — anche poche decine di chiamate per validare il comportamento costano
pochi centesimi in tutto.

I tetti di spesa sono già nel prodotto, con default prudenti in `server/.env.example` e modificabili
in seguito dalla dashboard:

```dotenv
MAX_MONTHLY_ESTIMATED_COST_EUR=70   # ~800-3500 domande/mese, secondo il modello scelto
MAX_REQUESTS_PER_HOUR_PER_AGENT=30  # frena un ciclo impazzito lato client
```

Il budget mensile si calcola dalla somma reale in `requests` (SQLite), quindi sopravvive ai
riavvii del servizio — non è un contatore in memoria che si azzera.

## 5. Igiene della chiave

- La chiave sta **solo sul server**, mai nell'estensione: l'unico punto che la legge è
  `AnthropicProvider` (`new Anthropic()`, legge `ANTHROPIC_API_KEY` dall'ambiente).
- `server/.env` è già in `.gitignore` — non finisce mai in un commit per errore.
- Se la chiave è mai finita altrove per sbaglio (log, chat, screenshot), **revocala** da
  console.anthropic.com e creane una nuova: è gratis e istantaneo.
- In produzione la chiave vive in `/etc/runwaysurfer/runwaysurfer.env` (permessi ristretti,
  leggibile solo dall'utente di servizio), non in questo `.env` di sviluppo.

## 6. Tornare a mock

Per smettere di spendere, basta rimettere `AI_PROVIDER=mock` (o cancellare la riga: `mock` è il
default) e riavviare. Nessun'altra modifica necessaria — è lo scopo della factory in
`server/src/provider/index.ts`.
