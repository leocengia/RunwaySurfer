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
| Hostname pubblicato                     | `runway-surfer.aviationsrl.it` _(grafia da confermare)_       |
| Scadenza del certificato TLS            | _da compilare alla prima emissione_                          |
| Chi rinnova il certificato              | automatico (certbot) — referente: _in attesa del CED_         |
| Chi riceve le segnalazioni degli agenti | Leonardo Cengia — cengia.l@aviationsrl.it — +39 328 052 1769 |
| Budget mensile concordato               | €70 (`MAX_MONTHLY_ESTIMATED_COST_EUR`)                       |

---

## Prima installazione

Da eseguire una volta, come root, su una **Ubuntu 24.04 LTS** minimale senza
ambiente grafico. Serve solo il pacchetto (`.tar.gz` + `.sha256`) copiato sulla
macchina: **niente npm, niente GitHub, niente compilatore.**

> Ubuntu 24.04 e non un'altra versione per un motivo preciso: è la stessa su cui
> la CI costruisce il pacchetto. `glibc` è compatibile solo all'indietro, quindi
> un binario nativo costruito su un sistema più recente del bersaglio può non
> caricarsi. Con build, prova e produzione sulla stessa versione la questione non
> si pone. Se il rack dovesse cambiare versione, va cambiato **prima** il runner
> in `.github/workflows/ci.yml`.

**1. Pacchetti di base**

```bash
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg tar sqlite3
```

**2. Node 22 da NodeSource, bloccato**

```bash
install -d -m 0755 /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
  | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
chmod 0644 /etc/apt/keyrings/nodesource.gpg
echo 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main' \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update && apt-get install -y nodejs && apt-mark hold nodejs
```

Verificare **prima di andare avanti**, perché tutto il resto lo dà per fatto:

```bash
command -v node                    # DEVE essere /usr/bin/node — la unit lo cabla
node -v                            # v22.x
node -p process.versions.modules   # 127, e deve combaciare con nodeAbi del pacchetto
apt-mark showhold                  # nodejs
```

Un Node installato via `nvm`, `snap` o `fnm` finisce altrove e `ExecStart` si
rompe. `apt-mark hold` esiste perché il modulo nativo è legato a una specifica
interfaccia binaria di Node: un salto automatico a Node 24 ferma il servizio
finché non gli si consegna un pacchetto ricompilato.

**3. Log persistenti** — vedi la sezione «Log»: senza `/var/log/journal` i log
vivono in RAM e si azzerano a ogni riavvio.

**4. Utente di servizio e cartelle**

```bash
useradd --system --no-create-home --shell /usr/sbin/nologin runwaysurfer
install -d -m 0755 -o root -g root         /opt/runwaysurfer
install -d -m 0750 -o root -g runwaysurfer /etc/runwaysurfer /etc/runwaysurfer/tls
```

**Non** creare `/var/lib/runwaysurfer` a mano: la crea systemd con
`StateDirectory=`, con proprietario e permessi giusti.

**5. Verificare il pacchetto ed estrarne gli artefatti di deploy**

```bash
cd /root
sha256sum -c runwaysurfer-server-<id>.tar.gz.sha256      # -> "...tar.gz: OK"
mkdir -p /root/boot
tar -xzf runwaysurfer-server-<id>.tar.gz -C /root/boot --no-same-owner ./deploy
ls -l /root/boot/deploy
```

Questo passo è facile da non immaginare: **la unit systemd e lo script di
aggiornamento viaggiano dentro il pacchetto**, e su una macchina senza accesso a
GitHub non esistono da nessun'altra parte. `--no-same-owner` perché l'archivio
porta l'uid dell'utente che lo ha creato in CI.

**6. File di configurazione**

```bash
install -m 0640 -o root -g runwaysurfer \
  /root/boot/deploy/runwaysurfer.env.example /etc/runwaysurfer/runwaysurfer.env
nano /etc/runwaysurfer/runwaysurfer.env
```

Per un primo collaudo bastano quattro righe, e **nessuna riga vuota**:

```
AI_PROVIDER=mock
ALLOWED_ORIGIN=*
ADMIN_USERNAME=admin
ADMIN_BOOTSTRAP_PASSWORD=<una password temporanea>
```

Senza `ADMIN_BOOTSTRAP_PASSWORD` il servizio parte e `/health` risponde, ma la
dashboard resta inaccessibile: lo script di aggiornamento si rifiuta di procedere
alla prima installazione proprio per questo.

**7. Unit e script di aggiornamento**

```bash
install -m 0644 -o root -g root /root/boot/deploy/runwaysurfer.service /etc/systemd/system/
install -m 0755 -o root -g root /root/boot/deploy/runwaysurfer-update.sh /usr/local/sbin/runwaysurfer-update
systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/runwaysurfer.service   # nessun output = ok
systemctl enable runwaysurfer     # SENZA --now: il codice non c'è ancora
```

`enable` **senza** `--now`, e non è pedanteria: `WorkingDirectory` punta a un
symlink che nascerà solo col primo aggiornamento, quindi un avvio adesso
fallirebbe cinque volte di seguito e systemd smetterebbe di riprovare per un
minuto — proprio mentre si lancia il comando successivo.

**8. Prima installazione del codice**

```bash
runwaysurfer-update --dry-run /root/runwaysurfer-server-<id>.tar.gz   # solo controlli
runwaysurfer-update /root/runwaysurfer-server-<id>.tar.gz
```

**9. Verifica**

```bash
systemctl is-active runwaysurfer                  # active
systemctl is-enabled runwaysurfer                 # enabled
curl -s http://127.0.0.1:8787/health              # in mock, HTTP sulla 8787
journalctl -u runwaysurfer -n 25 --no-pager
runwaysurfer-update --list
```

Nella riga di avvio il campo che conta è **`db=/var/lib/runwaysurfer/runwaysurfer.db`**:
se fosse vuoto o dentro una cartella di release, la configurazione è sbagliata e
i dati non sopravviverebbero. Non devono comparire righe `[db]`, `[config]` o
`[tls]`.

Poi, quando ci sono certificato e hostname, si aggiungono `TLS_CERT_PATH` e
`TLS_KEY_PATH` all'env file e si riavvia: il servizio passa da solo alla 443.

---

## Avvio e aggiornamento in produzione

**Sul server non si compila niente.** Il pacchetto arriva già costruito dalla CI
e si porta dietro `dist/` e `node_modules` di produzione, compreso il binario
nativo di `better-sqlite3` per Linux: la macchina non ha bisogno di `npm`, né di
accesso a Internet, né di un compilatore.

```bash
sudo runwaysurfer-update /percorso/runwaysurfer-server-<id>.tar.gz
```

Un comando, un argomento. Verifica il pacchetto, fa il backup del database,
scambia la release, riavvia e controlla che il servizio risponda **con la
versione attesa**; se non ci riesce, torna da sé alla release precedente.

| Comando | Cosa fa |
| --- | --- |
| `sudo runwaysurfer-update <pacchetto>` | aggiorna |
| `sudo runwaysurfer-update --dry-run <pacchetto>` | **solo controlli, non tocca niente** |
| `sudo runwaysurfer-update --list` | release presenti, quella attiva, quella in esecuzione, schema del database |
| `sudo runwaysurfer-update --activate <id>` | torna a una release precedente |

Da dove viene il pacchetto: artifact `runway-surfer-server-bundle` di ogni
esecuzione della CI (`.github/workflows/ci.yml`), **insieme al suo file
`.sha256`** — copiare entrambi, lo script verifica il checksum perché l'errore
vero è un file troncato da uno SCP interrotto. Un pacchetto si può costruire
anche da un branch, con `workflow_dispatch`.

### Layout su disco

```
/opt/runwaysurfer/
├── server -> releases/<id>      il symlink che la unit usa come WorkingDirectory
├── releases/<id>/               dist, node_modules, deploy, RELEASE.json
├── backups/                     copia del database presa prima di ogni aggiornamento
└── update.log                   storico degli aggiornamenti
```

Fuori da `/opt`, e quindi **intoccati da qualunque aggiornamento**:
`/etc/runwaysurfer/runwaysurfer.env`, `/etc/runwaysurfer/tls/` e il database in
`/var/lib/runwaysurfer/`.

### Verificare che l'aggiornamento sia andato

```bash
curl -sk https://127.0.0.1/health      # {"status":"ok","version":"...","commit":"..."}
```

La stessa coppia versione/commit è nella prima riga di log all'avvio, nella card
**Versione** della dashboard, e la vede anche l'agente premendo «Test connessione»
nella pagina opzioni dell'estensione. Se la dashboard dice `dev`, sul server sta
girando qualcuno da sorgente e non un pacchetto.

### Tornare indietro

`sudo runwaysurfer-update --activate <id-precedente>`.

**Il rollback riporta il codice, non il database.** Le migrazioni sono a senso
unico: non esiste il gradino inverso. Se l'aggiornamento aveva migrato lo schema,
la release precedente si rifiuta di partire (lo dice con una riga `[db]`, ed è
voluto: partire su uno schema sconosciuto corromperebbe i dati in silenzio). In
quel caso lo script **non fa il rollback da solo** e stampa i comandi da eseguire
— codice *e* database — avvisando che si perdono i dati scritti dopo il backup.
Quella è una decisione da prendere con il referente, non da eseguire di corsa.

Lo script dice in anticipo quando un aggiornamento migrerà lo schema: la riga
`NOTA: questo aggiornamento migrerà il database…` compare fra i controlli, e
`--dry-run` la mostra senza toccare nulla.

### Cosa si perde a ogni riavvio

Sessioni, storico, tetto di spesa e impostazioni stanno in SQLite e
sopravvivono: **gli agenti non devono rifare il login.** Si azzerano le metriche
live della dashboard, la lista *Recent requests*, il contatore orario per agente
e i tentativi di login falliti. E **gli stream `/ask` aperti in quel momento
vengono interrotti**: un agente che stava leggendo una risposta la vede troncata.
Per questo un aggiornamento va fatto fuori dalle ore di punta, o accettando quel
costo.

`start_runway_surfer.bat` **non** è una procedura di produzione: lancia
`npm run dev` (tsx watch) in una finestra che muore al logoff. Va usato solo in
sviluppo.

Il servizio deve ripartire da sé al riavvio della macchina, e per questo la unit
va **abilitata**: `sudo systemctl enable runwaysurfer`. Lo script di
aggiornamento non lo fa da sé — non è il suo compito — ma **avvisa** se trova la
unit non abilitata, perché un servizio che gira e non è abilitato sembra sano
fino al primo riavvio della macchina.

Il target è **Ubuntu 24.04 LTS con systemd** (vedi «Prima installazione»): la
unit pronta è `server/deploy/runwaysurfer.service`.

Con `uncaughtException` il processo esce con codice diverso da zero **apposta**,
per farsi riavviare pulito: se non c'è un supervisore che lo riavvia, quella
scelta si trasforma in un servizio spento.

> Non usare Alpine per un'eventuale immagine container: `better-sqlite3`
> pubblica binari precompilati per glibc e non per musl, quindi lì compila da
> sorgente e serve un toolchain. Il `Dockerfile` è su `node:22-bookworm-slim`.

### Configurazione minima per il provider reale

In **`/etc/runwaysurfer/runwaysurfer.env`** — non in `server/.env`, che è il
modello di *sviluppo*. Il modello di produzione è
`server/deploy/runwaysurfer.env.example`, e viaggia dentro il pacchetto.

> **Mai lasciare una chiave a `VAR=` vuoto.** `EnvironmentFile=` di systemd
> sovrascrive le direttive `Environment=` della unit, quindi una riga vuota
> vince sul valore che la unit aveva impostato. Il caso peggiore era
> `RUNWAYSURFER_DB_PATH=`: il servizio apriva un database **in memoria**,
> `/health` rispondeva `ok`, e ogni riavvio cancellava utenti, sessioni e
> storico. Il codice ora tratta vuoto come assente, ma la regola resta —
> cancellare la riga o commentarla, non svuotarla.

```
AI_PROVIDER=anthropic
ANTHROPIC_API_KEY=<la chiave>
ALLOWED_ORIGIN=https://traveler.my.site.com,chrome-extension://ihpknodkjnjcbdfmdneeeollnedbdcpd
TLS_CERT_PATH=/etc/runwaysurfer/tls/fullchain.pem
TLS_KEY_PATH=/etc/runwaysurfer/tls/privkey.pem
```

`COOKIE_SECURE` non serve più impostarla: con il TLS configurato il flag `Secure`
sul cookie si accende da sé.

Il servizio **si rifiuta di avviarsi** se `AI_PROVIDER=anthropic` e manca la
chiave, oppure se `ALLOWED_ORIGIN` è `*` o non contiene l'origin della KB. È
voluto: tutti e tre gli errori altrimenti si manifesterebbero alla prima
richiesta di un agente, non all'avvio.

Le **due** origin di `ALLOWED_ORIGIN` non sono ridondanti. La sidebar è un
content script dentro la pagina della KB, e in Manifest V3 le sue chiamate
portano l'`Origin` della **pagina** (`https://traveler.my.site.com`), non
dell'estensione: senza quella voce il browser blocca ogni richiesta degli
agenti. La seconda (`chrome-extension://…`) serve alla pagina delle opzioni e al
suo pulsante «Test connessione».

Il sintomo di una `ALLOWED_ORIGIN` incompleta è la segnalazione più fuorviante
del sistema, dopo il buffering: gli agenti vedono «Backend non raggiungibile»
(che sembra rete o VPN), **il test di connessione riesce** perché gira dall'altro
origin, e nei log del server non c'è nulla — vede solo `OPTIONS` 204. All'avvio
il servizio stampa le origin accettate:

```
[config] origin CORS ammesse: https://traveler.my.site.com chrome-extension://ihpk...
```

È la riga da controllare per prima quando «non funziona per nessuno».

### TLS nativo: nessun reverse proxy

Il CED ha escluso il reverse proxy, quindi **il processo Node termina l'HTTPS**.
Basta indicargli due file:

```
TLS_CERT_PATH=/etc/runwaysurfer/tls/fullchain.pem
TLS_KEY_PATH=/etc/runwaysurfer/tls/privkey.pem
```

Con entrambe impostate il servizio parte in HTTPS **sulla 443** (il default
cambia da solo quando il TLS è attivo) e il flag `Secure` sul cookie di sessione
si accende da sé. Con entrambe vuote parte in HTTP sulla 8787, che è la modalità
di sviluppo. Impostarne **una sola** blocca l'avvio: mezza configurazione TLS è
sempre un errore di deploy.

Su Linux la 443 come utente non privilegiato richiede
`AmbientCapabilities=CAP_NET_BIND_SERVICE` nella unit systemd — è già in
`server/deploy/runwaysurfer.service`. Senza, l'avvio si ferma con un `[config]`
che lo dice.

Il buffering delle risposte non è più un problema di nessuno: senza proxy davanti
non c'è niente che possa accumulare lo stream. L'header `X-Accel-Buffering: no`
resta come assicurazione se un proxy venisse mai inserito. Attenzione però: se
l'**egress** passa da un proxy che ispeziona TLS, il buffering si ripresenta lì,
con lo stesso sintomo (sembra piantato, poi stampa tutto di colpo).

### Rinnovo del certificato

Il rinnovo **non** è compito dell'applicativo: lo fa certbot con il proprio timer,
e un deploy hook copia i file dove l'utente del servizio può leggerli.

```sh
sudo install -m 0755 server/deploy/tls-deploy-hook.sh \
     /etc/letsencrypt/renewal-hooks/deploy/10-runwaysurfer.sh
sudo certbot renew --dry-run --run-deploy-hooks   # <- il flag NON è opzionale
systemctl list-timers | grep certbot
```

Un `certbot renew --dry-run` **semplice non esegue i deploy hook**: senza
`--run-deploy-hooks` si testa «con successo» un rinnovo il cui hook non è mai
partito, e lo si scopre sessanta giorni dopo a servizio fermo.

L'host non è raggiungibile da Internet, quindi la validazione può essere solo
**DNS-01** (HTTP-01 e TLS-ALPN-01 richiedono che i validatori della CA arrivino
sulla 80 o sulla 443). Conseguenza utile: il certificato si può ottenere **prima**
che il record A esista, e si verifica in locale con

```sh
curl --resolve runway-surfer.aviationsrl.it:443:127.0.0.1 \
     https://runway-surfer.aviationsrl.it/health
```

che valida catena e SNI contro l'hostname reale senza alcun DNS. Vedi
`docs/RISPOSTA-CED-HTTPS.md` per la parte da concordare con il CED.

**Dopo un rinnovo non serve riavviare.** Il servizio rilegge i file su `SIGHUP`
(`systemctl reload runwaysurfer`, che il hook invia da sé) e comunque da solo ogni
6 ore (`TLS_RELOAD_POLL_MS`). La ricarica sostituisce il contesto TLS senza
interrompere le connessioni già aperte: uno stream `/ask` in corso da tre minuti
non si accorge di nulla. Il rovescio è che una connessione aperta continua a
mostrare il **vecchio** fingerprint fino a che non si chiude — è atteso, non è un
difetto. La conferma sta nei log:

```
[tls] certificato ricaricato senza riavvio: subject=... scadenza=... fingerprint=...
```

Per verificare che sia il certificato **servito** a essere cambiato, e non solo
il file su disco:

```sh
openssl s_client -connect runway-surfer.aviationsrl.it:443 \
  -servername runway-surfer.aviationsrl.it </dev/null 2>/dev/null \
  | openssl x509 -noout -dates -subject
```

---

## Log

Il servizio scrive su stdout/stderr; è il supervisore a deciderne la
destinazione: su questo target è journald (`journalctl -u runwaysurfer`). Righe
da conoscere:

| Prefisso                     | Significato                                                            |
| ---------------------------- | ---------------------------------------------------------------------- |
| `[ask:<id>]`                 | una richiesta accettata: agente, modello, pagine, token, costo stimato |
| `[error] POST /ask:`         | errore non gestito su una richiesta; il servizio resta in piedi        |
| `[fatal:unhandledRejection]` | anomalia asincrona catturata; **il servizio continua**                 |
| `[fatal:uncaughtException]`  | il processo esce per farsi riavviare                                   |
| `[maintenance]`              | passata giornaliera di retention                                       |
| `[config]`                   | problema di configurazione all'avvio (blocca l'avvio)                  |
| `[tls]`                      | certificato caricato o ricaricato, e avvisi di scadenza                |
| `[db]`                       | database scritto da una build più recente: **blocca l'avvio**           |
| `[auth]`                     | bootstrap del primo amministratore                                     |

La prima riga di log dopo l'avvio è la più informativa del sistema:

```
RunwaySurfer 0.2.0 (9d3025b) su https://0.0.0.0:443 — provider=anthropic,
CORS=https://traveler.my.site.com, chrome-extension://ihpk..., schema=5,
db=/var/lib/runwaysurfer/runwaysurfer.db, node=v22.14.0
```

Versione e commit dicono se l'aggiornamento ha avuto effetto; `CORS=` è il
controllo da fare quando «non funziona per nessuno»; `db=` serve ad accorgersi se
`RUNWAYSURFER_DB_PATH` è sparito dall'env file e il database è finito dentro una
directory di release, dove la potatura lo cancellerebbe.

**Nei log non c'è il testo delle domande degli agenti**, per scelta: nel database
resta un hash più un'anteprima corta, e stampare la query su stdout vanificava
quella scelta (i log finiscono in file, backup e ticket). Se serve capire _cosa_
è stato chiesto in una richiesta specifica, si parte dal `requestId` nella
Control Dashboard.

La rotazione non è gestita dall'applicativo: va configurata sul supervisore o con
uno script pianificato, altrimenti il file cresce senza limite. **È l'unica voce
di disco senza un limite superiore** — il database ha la sua retention, i log no.

Su Ubuntu/Debian servono **tre** righe e una cartella, e la cartella è la parte
che si dimentica:

```bash
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal
sudo mkdir -p /etc/systemd/journald.conf.d
sudo tee /etc/systemd/journald.conf.d/10-runwaysurfer.conf >/dev/null <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=1G
MaxRetentionSec=90d
EOF
sudo systemctl restart systemd-journald
journalctl --header | head -3     # deve puntare a /var/log/journal/..., non a /run
```

**`Storage=persistent` non è un dettaglio.** Ubuntu e Debian arrivano con
`Storage=auto`, che significa «persistente **solo se `/var/log/journal`
esiste**» — e non la creano. Senza quella cartella il journal vive in `/run`,
cioè in RAM: `MaxRetentionSec=90d` non ha effetto, i log **si azzerano a ogni
riavvio**, e un'eventuale partizione dedicata a `/var/log` resta vuota. L'unico
registro durevole di cosa ha fatto il servizio mancherebbe esattamente dopo
l'evento che si andrebbe a indagare.

Il drop-in in `journald.conf.d/` invece di modificare `journald.conf`: così un
aggiornamento di distribuzione non chiede cosa fare del file modificato.

90 giorni per far combaciare la retention dei log con quella dei dati
(`REQUEST_RETENTION_DAYS`), così non resta traccia di richieste che dal database
sono già state cancellate.

---

## Backup del database

Un solo file SQLite. In produzione è **`/var/lib/runwaysurfer/runwaysurfer.db`**
(la unit lo impone con `StateDirectory` + `RUNWAYSURFER_DB_PATH`); in sviluppo,
girando da sorgente, è `server/data/runwaysurfer.db`. La riga di log all'avvio
riporta il percorso effettivo nel campo `db=`: è quello che fa fede. È in modal
**WAL**, e questo cambia la procedura di backup:

**Da preferire** — una copia coerente a servizio acceso:

```bash
sqlite3 /var/lib/runwaysurfer/runwaysurfer.db \
  "VACUUM INTO '/opt/runwaysurfer/backups/runwaysurfer-$(date +%F).db'"
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

**Ripristino** — quattro comandi, e i due di mezzo non sono opzionali:

```bash
sudo systemctl stop runwaysurfer
sudo cp /opt/runwaysurfer/backups/<file>.db /var/lib/runwaysurfer/runwaysurfer.db
sudo rm -f /var/lib/runwaysurfer/runwaysurfer.db-wal /var/lib/runwaysurfer/runwaysurfer.db-shm
sudo chown runwaysurfer:runwaysurfer /var/lib/runwaysurfer/runwaysurfer.db
sudo systemctl start runwaysurfer
```

I file `-wal` e `-shm` vanno rimossi: lasciarli fa replicare a SQLite un WAL che
appartiene a un **altro** database, ed è la corruzione silenziosa classica. Il
`chown` serve perché la copia la fa root e il servizio gira come
`runwaysurfer`. Sono gli stessi comandi che lo script di aggiornamento stampa
quando un rollback non può essere automatico: se qui e là dicessero cose diverse,
uno dei due sarebbe sbagliato.

Le migrazioni sono versionate (`PRAGMA user_version`) e si applicano da sé
all'avvio. Nel verso opposto no: una build che conosce uno schema **inferiore** a
quello del file si rifiuta di partire con una riga `[db]`, invece di lavorare in
silenzio su uno schema che non conosce.

---

## Cosa guardare nella Control Dashboard

`https://<host>/` con le credenziali di amministratore. Nella scheda
**Diagnostica**:

- **Provider** — deve dire `anthropic` e `Ready`. `Missing API key` significa che
  il servizio è partito in modalità finta: gli agenti ricevono risposte non reali.
- **Certificato TLS** — giorni residui alla scadenza. Diventa giallo sotto
  `TLS_EXPIRY_WARN_DAYS` (21 giorni), e siccome certbot rinnova con 30 giorni di
  margine, il giallo significa che il rinnovo automatico si è fermato. È l'unico
  preavviso di un fermo che poi arriva per tutti gli agenti insieme. Il dettaglio
  (subject, scadenza, fingerprint) è nel tooltip del riquadro.
  `HTTP (nessun TLS)` in produzione vuol dire che le variabili `TLS_*` non sono
  impostate: dentro la KB il browser bloccherebbe ogni chiamata.
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

1. Il processo è vivo? (`systemctl status runwaysurfer`)
2. Risponde in locale? `curl -k https://127.0.0.1/health` (in sviluppo:
   `curl http://127.0.0.1:8787/health`)
3. Se sì in locale ma no dall'esterno → è la rete, il firewall o il DNS, non
   l'applicativo. Verifica anche catena e SNI con l'hostname reale:
   `curl --resolve <host>:443:127.0.0.1 https://<host>/health`
4. Guarda le ultime righe di log: un `[config]` o un `[tls]` all'avvio blocca la
   partenza e dice cosa manca.

Con il TLS terminato da Node, il processo **è** il terminatore TLS: un
`[fatal:uncaughtException]` non è più solo un disservizio applicativo, è il
servizio HTTPS che cade. `Restart=on-failure` con `RestartSec=3` non è
hardening, è la rete di sicurezza che tiene su il servizio — se qualcuno la
rimuove dalla unit, un'eccezione singola diventa un fermo fino al riavvio manuale.

### Gli agenti dicono «Backend non raggiungibile»

Quel messaggio arriva dalla sidebar quando `/auth/me` non risponde. Vuol dire
servizio spento, proxy giù o rete assente — **non** sessione scaduta: gli agenti
non devono rifare il login, basta che il servizio torni su e premano _Riprova_.

### Certificato TLS in scadenza

Il giorno della scadenza lo strumento si ferma per tutti insieme, senza
preavviso: il browser blocca le chiamate e la sidebar mostra «Backend non
raggiungibile». Dentro la KB nessun agente può accettare un'eccezione sul
certificato, perché la chiamata parte da un'estensione: **non esiste workaround
lato utente**.

Il preavviso arriva da due parti:

- la card **Certificato TLS** in Diagnostica, che conta i giorni residui;
- una riga `[tls]` nei log a ogni controllo, quando si scende sotto
  `TLS_EXPIRY_WARN_DAYS` (default 21). certbot rinnova con 30 giorni di margine,
  quindi quell'avviso significa una cosa sola: **il rinnovo automatico non sta
  girando**. Si verifica con `systemctl list-timers | grep certbot` e
  `journalctl -u certbot`.

Segna comunque la data di scadenza nella tabella in cima a questo documento e chi
la rinnova.

### `[config] permesso negato sulla porta 443`

Il servizio gira come utente non privilegiato e manca la capability per legare una
porta bassa. Verifica che
`AmbientCapabilities=CAP_NET_BIND_SERVICE` sia nella unit
(`systemctl cat runwaysurfer`), poi `systemctl daemon-reload` e riavvia. In
alternativa, per un test rapido, `PORT=8443`.

### `[tls] ... non leggibile dall'utente del servizio`

I file del certificato non sono stati copiati dal deploy hook, o lo sono stati con
proprietario sbagliato. certbot scrive `privkey.pem` come `0600 root:root` e
l'utente del servizio non può nemmeno attraversare `/etc/letsencrypt`: non va
puntato lì. Riesegui il hook
(`sudo /etc/letsencrypt/renewal-hooks/deploy/10-runwaysurfer.sh` non funziona da
solo, serve `certbot renew --run-deploy-hooks`) e controlla:

```sh
ls -l /etc/runwaysurfer/tls/     # fullchain 0644, privkey 0640, gruppo runwaysurfer
```

---

## Manutenzione automatica

Un job gira all'avvio e poi ogni 24 ore: applica la retention dello storico
richieste (`retention_days`, default 90) e rimuove le sessioni scadute. Lascia
una riga `[maintenance]` nei log. La pulizia si può forzare dalla dashboard con
il pulsante _Prune_ (solo amministratori).
