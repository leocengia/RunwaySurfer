# Guida: collegare OpenRouter (modello a scelta libera per fascia)

## A cosa serve

Oggi il backend può girare in tre modalità: `AI_PROVIDER=mock` (default, nessuna chiamata reale),
`AI_PROVIDER=anthropic` (Claude diretto, vedi `docs/GUIDA-API-KEY.md`), oppure
`AI_PROVIDER=openrouter` — questa guida. OpenRouter è un unico endpoint che dà accesso al
catalogo di **qualunque fornitore** (Anthropic, OpenAI, Google, Meta, e altri): con questo
provider si può scegliere liberamente **quale modello risponde a ciascuna delle tre fasce di
difficoltà** (`cheap`/`balanced`/`capable`, vedi `server/src/router.ts`) e quale fa da reranker
per `POST /rank`, senza toccare il codice — solo variabili d'ambiente.

Il resto dell'architettura (streaming SSE, stima costi, guardrail di spesa, anti-allucinazione del
reranker) non cambia: `OpenRouterProvider` (`server/src/provider/openrouter.ts`) implementa la
stessa interfaccia `AiProvider` di `AnthropicProvider`, sopra l'API Chat Completions
(compatibile OpenAI) che OpenRouter espone.

## 1. Procurare la chiave

1. Vai su **openrouter.ai** e accedi (o crea un account).
2. Aggiungi credito (**Settings → Credits**) — è a consumo, non un abbonamento.
3. **Settings → Keys → Create Key**. Dai un nome riconoscibile (es. `runwaysurfer-test`).
4. La chiave (`sk-or-…`) si vede per intero solo alla creazione: copiala subito in un posto sicuro
   (un password manager, non un file nel repo).

## 2. Scegliere i modelli per fascia

Sfoglia il catalogo su **openrouter.ai/models**: ogni scheda modello mostra l'id esatto da usare
(es. `anthropic/claude-opus-4-8`, `openai/gpt-5-mini`, `google/gemini-3-pro`) e il prezzo in
USD per milione di token, separato per input e output — sono i due numeri che vanno riportati
nelle variabili `_INPUT_PER_MTOK`/`_OUTPUT_PER_MTOK` qui sotto. Un criterio di partenza ragionevole,
analogo a come sono scelti oggi i tre Claude di default:

- **`cheap`**: un modello piccolo/veloce per lookup semplici (1 pagina, query corta).
- **`balanced`**: un modello intermedio per la maggioranza delle domande (fino a 6 pagine).
- **`capable`**: un modello di punta per sintesi multi-pagina o contesti grandi.

Il router (`chooseTier()`) decide **solo la fascia**, mai il modello concreto: cambiare questi tre
modelli non altera in alcun modo la logica che sceglie fra `cheap`/`balanced`/`capable`.

## 3. Configurare il backend

Nella cartella `server/`:

```
cp .env.example .env
```

Apri `server/.env` e imposta:

```dotenv
AI_PROVIDER=openrouter
OPENROUTER_API_KEY=sk-or-...

# Le tre fasce sono OBBLIGATORIE con openrouter: id e prezzi vanno impostati
# INSIEME, mai uno senza gli altri (mezza configurazione non è un default
# plausibile, stessa regola già in vigore per TLS_CERT_PATH/TLS_KEY_PATH).
MODEL_CHEAP=openai/gpt-5-mini
MODEL_CHEAP_INPUT_PER_MTOK=0.25
MODEL_CHEAP_OUTPUT_PER_MTOK=2

MODEL_BALANCED=google/gemini-3-pro
MODEL_BALANCED_INPUT_PER_MTOK=1.25
MODEL_BALANCED_OUTPUT_PER_MTOK=10

MODEL_CAPABLE=anthropic/claude-opus-4-8
MODEL_CAPABLE_INPUT_PER_MTOK=5
MODEL_CAPABLE_OUTPUT_PER_MTOK=25

ALLOWED_ORIGIN=https://traveler.my.site.com,chrome-extension://ihpknodkjnjcbdfmdneeeollnedbdcpd
```

(Gli id e i prezzi sopra sono solo un esempio — verifica sempre id e tariffe correnti su
openrouter.ai/models prima di impostarli: il listino cambia nel tempo e questa guida non lo tiene
sincronizzato.)

**Con `AI_PROVIDER=openrouter` il server rifiuta di partire** se manca `OPENROUTER_API_KEY`, se
manca anche solo una delle tre fasce (id o un prezzo senza l'altro), o se `ALLOWED_ORIGIN` è `*`
— stesse guardie fail-fast già in vigore per `anthropic`, generalizzate a qualunque provider reale.

Il reranker (`POST /rank`) è **facoltativo** anche con openrouter: senza `RANK_MODEL` eredita lo
slot `cheap` già risolto sopra (quindi il modello economico scelto, non un Claude cablato). Per
usare un modello diverso solo per il rerank:

```dotenv
RANK_MODEL=openai/gpt-5-mini
RANK_MODEL_INPUT_PER_MTOK=0.25
RANK_MODEL_OUTPUT_PER_MTOK=2
```

Qui è tollerato anche un id da solo, senza prezzi (usa il prezzo del fallback) — utile per un
esperimento rapido, ma la stima di costo sarà imprecisa se il modello sperimentale ha un prezzo
diverso.

## 4. Avviare e verificare

```
cd server
npm run dev
```

Verifica in ordine:

- Nessun errore `[config]` in avvio (in caso contrario, il messaggio nomina esattamente la
  variabile mancante o mal configurata).
- Apri la pagina delle opzioni dell'estensione e premi **Test connessione**: deve rispondere OK.
- Da una pagina reale della KB, fai una domanda nella sidebar: verifica che la risposta sia
  coerente e nella lingua attesa — il system prompt (`buildSystemPrompt`,
  `server/src/provider/shared.ts`) è tarato sul comportamento di Claude; con un modello di un
  altro fornitore la qualità/aderenza alle istruzioni va **verificata manualmente**, non è
  automatizzabile.
- `GET /dashboard-data` (autenticato) mostra la card **"Modelli per fascia (attivi)"** con i 4
  id/prezzi realmente in uso — la conferma che la configurazione letta è quella intesa.

## 5. Affidabilità del tool-calling forzato sul reranker — verifica prima di fidarsi in produzione

Il reranker (`POST /rank`) forza il modello a chiamare uno strumento (`tool_choice` forzato,
equivalente OpenAI del meccanismo Anthropic) invece di rispondere con prosa libera — è il modo in
cui la selezione degli articoli resta strutturata e non richiede un parser di linguaggio naturale.
**Non tutti i modelli del catalogo OpenRouter rispettano questa forzatura con la stessa
affidabilità di Claude.** Se un modello la ignora, `OpenRouterProvider.rankCandidates` lo rileva e
**lancia un errore visibile** invece di degradare in silenzio a "nessun candidato pertinente" —
`routes/rank.ts` lo registra con `status:'error'`.

Prima di affidare il rerank a un modello non-Claude in produzione, verifica quante volte questo
succede realmente:

```
GET /requests?kind=rank&status=error
```

Se compaiono molte righe, il modello scelto per `RANK_MODEL` (o per lo slot `cheap`, se
`RANK_MODEL` non è impostata) non è adatto al rerank: sceglierne uno diverso, più affidabile nel
tool-calling forzato. Un rerank fallito non è comunque mai peggio del comportamento senza AI: il
client ricade sullo scoring locale.

## 6. Costi, guardrail e limiti noti

I tetti di spesa sono gli stessi già in vigore per `anthropic`, e si applicano identici qui
(`server/.env.example`, poi modificabili dalla dashboard):

```dotenv
MAX_MONTHLY_ESTIMATED_COST_EUR=70
MAX_REQUESTS_PER_HOUR_PER_AGENT=30
```

Il budget mensile si calcola dalla somma reale in `requests` (SQLite), non da un contatore in
memoria — sopravvive ai riavvii. La stima di costo per richiesta usa i prezzi dichiarati in
`MODEL_*_INPUT_PER_MTOK`/`_OUTPUT_PER_MTOK`: se il listino OpenRouter cambia e queste variabili non
vengono aggiornate, la stima si allontana dal costo reale (il servizio non lo scopre da solo).

Limiti espliciti di questa integrazione, da tenere presenti:

- **Nessun prompt caching**: `cache_control` è un meccanismo specifico Anthropic, non disponibile
  sull'API Chat Completions. Con `AI_PROVIDER=openrouter` ogni richiesta invia per intero il
  prefisso di sistema, anche per follow-up ravvicinati sulla stessa conversazione.
- **Nessun controllo dello sforzo di ragionamento** (l'equivalente di `effort` su Claude): non
  esiste un parametro universale OpenAI-compatibile per questo.
- **Costo reale non tracciato**: solo la stima upfront (prima della chiamata) alimenta il
  guardrail mensile; il costo effettivo per-richiesta riportato da OpenRouter non è ancora
  registrato in una colonna dedicata.
- **Compliance/data retention**: instradare via OpenRouter aggiunge un soggetto terzo nel flusso
  dati rispetto ad Anthropic diretto (OpenRouter inoltra la richiesta al fornitore del modello
  scelto). Verifica le impostazioni di data retention del tuo account OpenRouter e trattane
  esplicitamente con il CED prima di un uso in produzione con dati reali di agenti/clienti.

## 7. Igiene della chiave

- La chiave sta **solo sul server**, mai nell'estensione: l'unico punto che la legge è
  `OpenRouterProvider` (`new OpenAI({ apiKey: process.env.OPENROUTER_API_KEY })`).
- `server/.env` è già in `.gitignore` — non finisce mai in un commit per errore.
- Se la chiave è mai finita altrove per sbaglio (log, chat, screenshot), **revocala** da
  openrouter.ai/settings/keys e creane una nuova: è gratis e istantaneo.
- In produzione la chiave vive in `/etc/runwaysurfer/runwaysurfer.env` (permessi ristretti,
  leggibile solo dall'utente di servizio), non nel `.env` di sviluppo.

## 8. Tornare a mock o anthropic

Basta rimettere `AI_PROVIDER=mock` (o `anthropic`, con `ANTHROPIC_API_KEY` impostata) e riavviare.
Le variabili `MODEL_*`/`RANK_MODEL` restano innocue se lasciate impostate: con `anthropic`/`mock`
sono facoltative — se presenti vengono comunque usate (permettono per esempio di aggiornare un id
Claude senza toccare il codice), altrimenti si torna ai tre Claude di sempre.
