# Runbook del backend Runway Surfer

Per chi tiene in piedi il servizio durante il pilota. Scritto per essere letto
alle nove di sera, quando qualcosa non va: le procedure vengono prima delle
spiegazioni.

**Da compilare al primo avvio** (queste informazioni non sono nel codice):

| Voce                                    | Valore                                                       |
| --------------------------------------- | ------------------------------------------------------------ |
| Macchina che ospita il servizio         | _in attesa del CED_                                          |
| Chi ha accesso amministrativo           | _in attesa del CED_                                          |
| Cartella di installazione               | _in attesa del CED_                                          |
| Cartella dei log                        | _in attesa del CED_                                          |
| Backup: dove e con che frequenza        | _in attesa del CED_                                          |
| Chi custodisce `ANTHROPIC_API_KEY`      | _in attesa del CED_                                          |
| Chi riceve le segnalazioni degli agenti | Leonardo Cengia — cengia.l@aviationsrl.it — +39 328 052 1769 |
| Budget mensile concordato               | €70 (`MAX_MONTHLY_ESTIMATED_COST_EUR`)                       |

---

## Avvio in produzione

```bash
cd server
npm ci
npm run build      # compila in dist/
npm start          # node dist/index.js
```

`start_runway_surfer.bat` **non** è una procedura di produzione: lancia
`npm run dev` (tsx watch) in una finestra che muore al logoff. Va usato solo in
sviluppo.

Il servizio deve ripartire da sé al riavvio della macchina. Su Windows le due
strade sono un servizio con NSSM oppure l'Utilità di pianificazione con trigger
«All'avvio del sistema» ed esecuzione anche senza utente connesso. Con
`uncaughtException` il processo esce con codice diverso da zero **apposta**, per
farsi riavviare pulito: se non c'è un supervisore che lo riavvia, quella scelta
si trasforma in un servizio spento.

### Configurazione minima per il provider reale

In `server/.env` (il modello completo è `.env.example`):

```
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=<la chiave>
ALLOWED_ORIGIN=chrome-extension://ihpknodkjnjcbdfmdneeeollnedbdcpd
COOKIE_SECURE=1
```

Il servizio **si rifiuta di avviarsi** se `AI_PROVIDER=anthropic` e manca la
chiave, oppure se `ALLOWED_ORIGIN` è `*`. È voluto: entrambi gli errori
altrimenti si manifesterebbero alla prima richiesta di un agente, non all'avvio.

### Reverse proxy: le due righe che contano

Il backend ascolta in HTTP su `127.0.0.1:8787` e va esposto in HTTPS. Oltre al
certificato, servono due accortezze — le risposte di `/ask` sono in streaming
(`text/event-stream`):

```nginx
location / {
  proxy_pass http://127.0.0.1:8787;
  proxy_buffering off;        # senza questo la risposta arriva tutta insieme
  proxy_read_timeout 120s;    # una risposta può restare aperta più di un minuto
  gzip off;
}
```

Con il buffering attivo l'applicativo non dà errori: **sembra piantato** per
venti secondi e poi stampa tutto di colpo. È la segnalazione più fuorviante che
possa arrivare dagli agenti, e si risolve solo qui.

---

## Log

Il servizio scrive su stdout/stderr; è il supervisore a deciderne la
destinazione (con NSSM: `AppStdout` / `AppStderr`). Righe da conoscere:

| Prefisso                     | Significato                                                            |
| ---------------------------- | ---------------------------------------------------------------------- |
| `[ask:<id>]`                 | una richiesta accettata: agente, modello, pagine, token, costo stimato |
| `[error] POST /ask:`         | errore non gestito su una richiesta; il servizio resta in piedi        |
| `[fatal:unhandledRejection]` | anomalia asincrona catturata; **il servizio continua**                 |
| `[fatal:uncaughtException]`  | il processo esce per farsi riavviare                                   |
| `[maintenance]`              | passata giornaliera di retention                                       |
| `[config]`                   | problema di configurazione all'avvio (blocca l'avvio)                  |

**Nei log non c'è il testo delle domande degli agenti**, per scelta: nel database
resta un hash più un'anteprima corta, e stampare la query su stdout vanificava
quella scelta (i log finiscono in file, backup e ticket). Se serve capire _cosa_
è stato chiesto in una richiesta specifica, si parte dal `requestId` nella
Control Dashboard.

La rotazione non è gestita dall'applicativo: va configurata sul supervisore o con
uno script pianificato, altrimenti il file cresce senza limite.

---

## Backup del database

Un solo file SQLite, per default `server/data/runwaysurfer.db`. È in modal
**WAL**, e questo cambia la procedura di backup:

**Da preferire** — una copia coerente a servizio acceso:

```bash
sqlite3 server/data/runwaysurfer.db "VACUUM INTO '/backup/runwaysurfer-$(date +%F).db'"
```

**Alternativa** — copia dei file, che devono essere presi **tutti e tre insieme**:

```
runwaysurfer.db
runwaysurfer.db-wal
runwaysurfer.db-shm
```

Copiare solo il `.db` mentre il servizio scrive produce un backup **incompleto e
apparentemente valido**: è l'errore classico con WAL, e lo si scopre solo al
ripristino. In alternativa si ferma il servizio, si copia, si riavvia.

Cosa c'è dentro: utenti (password con hash scrypt), team, sessioni, e lo storico
delle richieste in forma privacy-minimised. Non ci sono dati dei clienti: la
redazione avviene nel browser dell'agente, prima dell'invio.

**Ripristino:** ferma il servizio, sostituisci il file, riavvia. Le migrazioni
sono versionate (`PRAGMA user_version`) e si applicano da sé all'avvio.

---

## Cosa guardare nella Control Dashboard

`https://<host>/` con le credenziali di amministratore. Nella scheda
**Diagnostica**:

- **Provider** — deve dire `anthropic` e `Ready`. `Missing API key` significa che
  il servizio è partito in modalità finta: gli agenti ricevono risposte non reali.
- **Cost guardrail** — spesa stimata del **mese in corso** (UTC) sul budget in
  euro. È esattamente il numero che blocca le richieste: se la barra è piena, gli
  agenti stanno ricevendo 429 e lo resteranno **fino al primo del mese**, a meno
  che il budget non venga alzato. La riga sotto la barra riporta anche il valore
  in dollari e il cambio usato per la conversione.
- **Total concurrency** — richieste in corso sul limite globale.
- **Errori** fra i riquadri in alto — se sale, guarda **Recent requests**: la
  colonna dell'errore dice se è un problema di provider, di guardrail o di rete.

### Alzare o abbassare i tetti

Scheda **Configurazione** → _Guardrail del backend_. Si applicano subito, senza
riavvio. I due che contano:

- **Budget mensile €** — con €70 e un costo medio di ~€0,05 per domanda sono
  circa **1.400 domande al mese**. Su 10 agenti e 21 giorni lavorativi fanno
  **~7 domande al giorno per agente**: è un budget stretto, e va tenuto
  d'occhio nella prima settimana. Se il router sceglie spesso il modello
  economico il numero raddoppia o triplica; se sceglie il più capace, si dimezza.
- **Richieste/ora per agente** — 30 basta a una giornata pesante e ferma un ciclo
  impazzito. Con un budget mensile stretto, però, il vincolo che si incontra
  prima è il budget, non questo: se un agente lo raggiunge, guarda **Recent
  requests** — di solito è la sidebar che ritenta, non un agente che lavora molto.

Due note sul budget:

- Si applica leggendo la somma reale da SQLite, quindi un riavvio del servizio
  **non** lo azzera. Se serve sbloccare subito, l'unica via è alzare la soglia.
- Il confronto avviene convertendo la spesa (che il listino dei modelli esprime in
  dollari) con un **cambio fisso**, `USD_PER_EUR` in `.env` (default 1.05). Va
  bene per un tetto di spesa, non per la contabilità: se il cambio si muove del
  10%, il tetto effettivo si muove del 10%. Vale la pena rivederlo una volta ogni
  tanto.

---

## Procedure

### Reset della password di un agente

Dashboard → scheda **Utenti** → _Reset password_. Genera una password
temporanea da comunicare all'agente; al primo accesso gli verrà chiesto di
cambiarla. Il reset **revoca tutte le sessioni** di quell'utente: se aveva la
sidebar aperta, si ritroverà il form di login.

### Disattivare un agente

Dashboard → **Utenti** → stato `disabled`. Le richieste vengono rifiutate con 403
e le sessioni esistenti smettono di funzionare.

### Il servizio non risponde

1. Il processo è vivo? (`Get-Process node`, o lo stato del servizio)
2. Risponde in locale? `curl http://127.0.0.1:8787/health`
3. Se sì in locale ma no dall'esterno → è il reverse proxy o la rete, non
   l'applicativo.
4. Guarda le ultime righe di log: un `[config]` all'avvio blocca la partenza e
   dice cosa manca.

### Gli agenti dicono «Backend non raggiungibile»

Quel messaggio arriva dalla sidebar quando `/auth/me` non risponde. Vuol dire
servizio spento, proxy giù o rete assente — **non** sessione scaduta: gli agenti
non devono rifare il login, basta che il servizio torni su e premano _Riprova_.

### Certificato TLS in scadenza

Il giorno della scadenza lo strumento si ferma per tutti insieme, senza
preavviso: il browser blocca le chiamate e la sidebar mostra «Backend non
raggiungibile». Segna la data di scadenza nella tabella in cima a questo
documento e chi la rinnova.

---

## Manutenzione automatica

Un job gira all'avvio e poi ogni 24 ore: applica la retention dello storico
richieste (`retention_days`, default 90) e rimuove le sessioni scadute. Lascia
una riga `[maintenance]` nei log. La pulizia si può forzare dalla dashboard con
il pulsante _Prune_ (solo amministratori).
