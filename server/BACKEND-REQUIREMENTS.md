# RunwaySurfer — Requisiti backend (per il CED)

Documento di riferimento per dimensionare l'infrastruttura del **proxy backend
on-premise**. Sintetizza ciò che la demo rende anche interrogabile a runtime via
`GET /requirements`.

## Cos'è il backend

Un **proxy** in Node.js che:

1. riceve dalla sidebar `{query, pages, links}`;
2. sceglie il modello AI in base alla difficoltà (routing → contenimento costi);
3. costruisce il prompt e (in produzione) chiama l'API Anthropic in streaming;
4. custodisce la **API key** (mai nell'estensione distribuita agli agenti).

> In **demo** (`AI_PROVIDER=mock`) NON viene effettuata alcuna chiamata esterna:
> utile per validare architettura e requisiti senza licenze/token.

## Risorse di calcolo

| Voce    | Minimo tecnico                                  | Richiesto al CED (30 agenti)                                     |
| ------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| CPU     | 1 vCPU                                          | **2 vCPU** — I/O bound, ma `better-sqlite3` è sincrono: la seconda CPU tiene backup e antivirus fuori dall'event loop |
| RAM     | 256–512 MB (misurato: 60–120 MB RSS)            | **2–3 GB** — sovrabbondante di proposito, non è la risorsa critica |
| Disco   | ~5 GB (OS + runtime + DB)                       | **10–20 GB**, con la rotazione dei log configurata a livello OS   |
| Runtime | Node.js **esattamente 22.x** (vedi `.nvmrc`) | **Ubuntu 24.04 LTS** con systemd (`deploy/runwaysurfer.service`) |

**Il disco è la risorsa che può fermare il servizio, non la RAM.** Il database ha
una retention automatica (90 giorni), i log **no**: l'applicativo scrive su
stdout/stderr e non ruota nulla di proposito, perché la destinazione la decide il
supervisore. Senza una politica di rotazione (`SystemMaxUse` in
`journald.conf`, o `logrotate`) nessun dimensionamento è corretto: cambia solo la
data in cui il disco si riempie, e un disco pieno **corrompe** un database SQLite.

Non usare un'immagine Alpine: `better-sqlite3` pubblica binari precompilati per
Linux glibc e non per musl.

**Sulla versione di Node il vincolo è esatto, non un consiglio.** Il pacchetto
consegnato contiene un componente compilato contro una specifica interfaccia
binaria di Node (ABI 127 = Node 22). Su Node 20 o 24 non si carica, e la
procedura di aggiornamento se ne accorge nei controlli preliminari e **si rifiuta
di procedere** invece di lasciare il servizio a terra. Per questo va chiesto
`apt-mark hold nodejs`: un cambio di major è un'operazione da concordare.

Stessa logica per la distribuzione: **Ubuntu 24.04** è la versione su cui la CI
costruisce il pacchetto, e `glibc` è compatibile solo all'indietro — un binario
costruito su un sistema più recente del bersaglio può non caricarsi. Con build,
prova e produzione allineate la questione non si pone.

## Rete

| Direzione             | Requisito                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Inbound**           | **TCP 443** dalle subnet delle postazioni e dal pool VPN. Il TLS è terminato **direttamente da Node**, senza reverse proxy. La 443 serve anche alla Control Dashboard: è lo stesso servizio, non c'è una porta di amministrazione separata. Facoltativa la **TCP 80** solo per il redirect 301 (`HTTP_REDIRECT_PORT`). **Nessun inbound da Internet.** |
| **Outbound (egress)** | **HTTPS verso `api.anthropic.com:443`** — SOLO con provider reale; in demo nessun egress. Da consentire **per hostname**: l'host è dietro CDN e un'allowlist di indirizzi IP si rompe senza preavviso. |
| **Outbound (ACME)**   | HTTPS verso gli endpoint Let's Encrypt e verso l'API DNS usata per la validazione; **DNS 53 udp/tcp anche verso i nameserver autoritativi** del dominio (un resolver interno con una copia split-horizon della zona farebbe fallire il controllo di propagazione); **NTP 123/udp** — lo scarto d'orologio rompe sia TLS sia ACME. |
| Dalle postazioni      | solo `<hostname>:443` e la KB. **`api.anthropic.com` non serve su nessuna postazione**: la chiave API non lascia il server. |
| CORS                  | `Access-Control-Allow-Origin` = origin dell'estensione (in demo `*`)                                                                         |

> Le risposte di `/ask` restano aperte per minuti (streaming). Qualunque firewall,
> IDS o proxy di uscita con un idle timeout inferiore a ~5 minuti le taglia a
> metà; un proxy di uscita che **ispeziona TLS e bufferizza** riporta il sintomo
> «sembra piantato, poi stampa tutto insieme» anche in assenza di reverse proxy.

## Certificato TLS

- Due file PEM (catena completa + chiave) leggibili dall'utente del servizio.
  Percorso consigliato `/etc/runwaysurfer/tls/`, `0640` con gruppo del servizio.
- Il **rinnovo è esterno all'applicativo**: client ACME (certbot) con il proprio
  timer di sistema, più il deploy hook `deploy/tls-deploy-hook.sh`. L'applicativo
  rilegge i file su `SIGHUP` e comunque ogni 6 ore, e sostituisce il certificato
  **senza riavviare e senza interrompere le risposte in corso**.
- L'host non è raggiungibile da Internet, quindi la validazione può essere solo
  **DNS-01**. Il dettaglio, con quello che serve al CED, è in
  `docs/RISPOSTA-CED-HTTPS.md`.

## Segreti

- `ANTHROPIC_API_KEY` fornita via variabile d'ambiente / secret manager **sul
  server**; **mai** inclusa nel bundle dell'estensione.
- Ruotabile senza redeploy dell'estensione (la chiave vive solo nel backend).

## Sicurezza / hardening (consigliato)

- Esecuzione come utente dedicato non privilegiato (vedi `deploy/runwaysurfer.service`).
  La 443 viene legata con `AmbientCapabilities=CAP_NET_BIND_SERVICE`: nessun
  processo gira come root.
- TLS terminato dal processo Node (scelta del CED: nessun reverse proxy); servizio
  in rete interna, non raggiungibile da Internet.
- Egress in allowlist verso il solo host Anthropic (per hostname).
- `Strict-Transport-Security` e flag `Secure` sul cookie si attivano da sé quando
  il TLS è configurato: nessuna riga di `.env` da ricordare.
- `ALLOWED_ORIGIN` è **obbligatoria** con `AI_PROVIDER=anthropic` (il backend
  rifiuta di avviarsi con CORS aperto e provider reale).
- **Prompt injection**: il crawler invia al modello il testo di pagine KB
  raggiunte via link same-origin. Il system prompt istruisce il modello a
  trattare quel contenuto come dato e non come comando, ma sulla KB aziendale
  reale va comunque valutato chi può modificare le pagine indicizzate: contenuto
  KB scrivibile da terzi = potenziale canale di injection verso il modello.

## Autenticazione

Tutti gli endpoint (tranne `/health` e `/auth/login`) richiedono autenticazione:

- **Dashboard**: login con username + password individuali su `GET /login`;
  sessione via cookie `HttpOnly` (durata 12 ore), logout dalla pagina.
- **Estensione (agenti)**: login nella sidebar; il backend rilascia un token
  Bearer (durata 30 giorni) usato su `POST /ask` e `GET /extension-config`.
- **Password**: hash `scrypt` (crypto nativo Node, nessuna dipendenza extra),
  mai salvate in chiaro. Minimo 8 caratteri. Cambio obbligatorio al primo login.
- **Ruoli**: `admin` (tutto), `team_lead` (dashboard in sola lettura),
  `agent` (solo `/ask` e config estensione).
- **Sessioni**: token opachi salvati hashati (SHA-256) nella tabella `sessions`
  di SQLite; revocabili per singolo utente (reset password, disattivazione).
- **Rate limiting login**: max 5 tentativi falliti per IP+username / 15 minuti.
- **Bootstrap primo admin**: al primo avvio impostare `ADMIN_BOOTSTRAP_PASSWORD`
  (e opzionalmente `ADMIN_USERNAME`, default `admin`); l'account viene creato
  con cambio password obbligatorio. Ignorata se un admin con password esiste già.
- Gli utenti creati prima dell'introduzione del login non hanno password: vanno
  abilitati dall'admin con `POST /users/:id/reset-password` (o dalla dashboard).

## Punti aperti da chiarire col CED

Chiusi con le risposte del 26/08/2026: nessun reverse proxy (TLS in Node),
certificati gratuiti con rinnovo automatico, hostname sotto `aviationsrl.it`,
sizing, installazione su Linux. Restano aperti:

- **Grafia dell'hostname** — `runway-serfer` o `runway-surfer`. Finisce nei
  Certificate Transparency log in modo permanente e nella GPO di ogni postazione.
- **Automazione del record DNS per la validazione DNS-01** — un solo record CNAME
  permanente. Vedi `docs/RISPOSTA-CED-HTTPS.md`: senza questo il rinnovo non può
  essere automatico, e un certificato gratuito rinnovato a mano ogni 60 giorni
  garantisce un fermo totale.
- Esistenza di un record **CAA** su `aviationsrl.it` (se presente e senza
  `letsencrypt.org`, nessun certificato gratuito è emettibile).
- Gestione segreti aziendale (vault) per `ANTHROPIC_API_KEY`.
- **Rotazione dei log** e backup del database nella policy standard.
- Chi riceve gli alert di scadenza e di rinnovo fallito.

## Persistenza dashboard / storico richieste

La demo usa SQLite locale tramite `better-sqlite3`.

File runtime:

```text
server/data/runwaysurfer.db
```

Contiene:

- utenti e team (con hash password `scrypt` per il login);
- sessioni attive (token hashati SHA-256);
- storico richieste con query preview/hash;
- modello, token stimati, costo stimato, durata, stato, errori;
- link selezionati e fonti in JSON;
- settings di concorrenza, budget e retention.

Privacy:

- non viene salvato il testo completo della Knowledge Base per default;
- il DB contiene metadati operativi e va trattato come dato aziendale;
- backup, retention e cancellazione devono seguire policy CED.

Produzione multi-server:

- SQLite e adatto al prototipo / singola istanza;
- per piu istanze dietro load balancer usare Postgres per storico/settings;
- Redis puo essere aggiunto per rate limit e concorrenza condivisa tra istanze.

Retention default:

```text
REQUEST_RETENTION_DAYS=90
```

Endpoint amministrativi principali (richiedono sessione admin/team_lead):

```text
GET /login                          (pagina di accesso, pubblica)
POST /auth/login                    (pubblica, rate-limited)
POST /auth/logout · GET /auth/me · POST /auth/change-password
GET /dashboard
GET /users · POST /users · PATCH /users/:id
POST /users/:id/reset-password      (solo admin)
GET /teams · POST /teams
GET /requests
GET /analytics/summary
GET /settings · PATCH /settings     (PATCH solo admin)
POST /maintenance/prune             (solo admin)
```
