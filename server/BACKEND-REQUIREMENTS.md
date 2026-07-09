# RunwaySurfer — Requisiti backend (per il CED)

Documento di riferimento per dimensionare l'infrastruttura del **proxy backend
on-premise**. Sintetizza ciò che la demo rende anche interrogabile a runtime via
`GET /requirements`.

## Cos'è il backend
Un **proxy stateless** in Node.js che:
1. riceve dalla sidebar `{query, pages, links}`;
2. sceglie il modello AI in base alla difficoltà (routing → contenimento costi);
3. costruisce il prompt e (in produzione) chiama l'API Anthropic in streaming;
4. custodisce la **API key** (mai nell'estensione distribuita agli agenti).

> In **demo** (`AI_PROVIDER=mock`) NON viene effettuata alcuna chiamata esterna:
> utile per validare architettura e requisiti senza licenze/token.

## Risorse di calcolo
| Voce | Prototipo/demo | Note produzione (30 agenti) |
|------|----------------|------------------------------|
| CPU  | 1 vCPU | I/O bound; scalare orizzontalmente se serve |
| RAM  | 256–512 MB | processo singolo, stateless |
| Disco| minimo | nessuna persistenza; solo log opzionali |
| Runtime | Node.js 20+ | deploy via Docker o systemd |

## Rete
| Direzione | Requisito |
|-----------|-----------|
| **Inbound** | porta HTTP (default `8787`) raggiungibile dai browser degli agenti; **esporre via reverse proxy con TLS** (es. Nginx/Traefik) |
| **Outbound (egress)** | **HTTPS verso `api.anthropic.com:443`** — necessario SOLO con provider reale; in demo nessun egress |
| CORS | `Access-Control-Allow-Origin` = origin dell'estensione (in demo `*`) |

## Segreti
- `ANTHROPIC_API_KEY` fornita via variabile d'ambiente / secret manager **sul
  server**; **mai** inclusa nel bundle dell'estensione.
- Ruotabile senza redeploy dell'estensione (la chiave vive solo nel backend).

## Sicurezza / hardening (consigliato)
- Esecuzione come utente dedicato non privilegiato (vedi `deploy/runwaysurfer.service`).
- TLS terminato dal reverse proxy; backend in rete interna.
- Egress in allowlist verso il solo host Anthropic.
- Con TLS attivo impostare `COOKIE_SECURE=1` (flag `Secure` sul cookie di sessione).

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
- Posizionamento (DMZ / rete interna) e policy di egress verso Internet.
- Reverse proxy/TLS aziendale standard da utilizzare.
- Gestione segreti aziendale (vault) per `ANTHROPIC_API_KEY`.
- Logging/retention dei log d'uso (costi/token per agente).

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
