# Riassunto per la nuova chat — collaudo Runway Surfer in WSL2

Copia tutto quello che segue nella nuova chat Claude Code, aperta sullo stesso repository (`RunwaySurfer`, cartella `C:\Users\cengia.l\Documents\Work from home\Claude Code Directory\Runway Surfer\RunwaySurfer`).

---

## Contesto

Runway Surfer è un'estensione Chrome + backend Node/Express che assiste gli agenti di un call center. Il backend va installato su un server Linux (rack aziendale, Ubuntu 24.04) tramite systemd, con TLS terminato nativamente da Node e un sistema di aggiornamento a pacchetto offline con rollback automatico. Tutto il codice e la documentazione sono già scritti e mergiati su `main`, con CI verde. Non è mai stato eseguito su una macchina Linux vera: questo è il collaudo prima di consegnarlo al CED (l'IT aziendale) per l'installazione sul rack.

> **Usa l'ultimo pacchetto su `main`, non quello di `e5fb721`.** Rileggendo lo script di
> aggiornamento in preparazione a questo collaudo sono emersi tre difetti che colpivano
> proprio S1–S4b: il backup del database che si interrompeva in silenzio se restava un
> `.part` da un tentativo precedente; il rollback automatico che si interrompeva quando la
> release precedente non aveva un `RELEASE.json` (il caso `0000.preesistente`, che lo script
> stesso può creare); e il controllo dell'ABI che misurava un Node diverso da quello cablato
> in `ExecStart`. Sono corretti, e la CI ora passa `shellcheck` sugli script di deploy.

**Stato attuale (verificato il 2026-09-10):** WSL2 **non c'è**, e la causa è più a monte di
un `wsl --install`. `wsl --status` risponde «Il sottosistema Windows per Linux non è
installato», e sul PC:

| Verifica                                  | Esito                                                                       |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `Microsoft-Windows-Subsystem-Linux`       | **Disabled**                                                                |
| `VirtualMachinePlatform`                  | **Disabled**                                                                |
| `HypervisorPresent`                       | True → virtualizzazione già attiva nel firmware, **nessun intervento BIOS** |
| `ORCHIDEA\cengia.l` amministratore locale | **No** — non è autoinstallabile                                             |
| docker / podman / multipass / VirtualBox  | nessuno installato, nessuna alternativa locale                              |

Serve quindi il CED per abilitare due feature Windows e riavviare. La richiesta di
follow-up, con questi dettagli, è in `docs/MAIL-CED-INSTALLAZIONE.md`.

**Prima di iniziare qualunque test, ricontrolla**, con:

```powershell
wsl --status
wsl --list --verbose
```

Se non c'è, il lavoro si ferma lì finché non arriva.

La prima mail al CED (`docs/MAIL-CED-INSTALLAZIONE.md`) chiedeva Ubuntu 24.04 LTS +
systemd con Node 22, git, sqlite3, curl, tar, ca-certificates, Codex e OpenCode.
**Non** chiedeva `gnupg`, che serve al passo 2 del runbook per la chiave NodeSource, né
`shellcheck`: sono nella richiesta di follow-up.

## Dove prendere il pacchetto da installare

L'ultima esecuzione della CI su `main` (push, non PR) produce due artifact scaricabili da GitHub Actions:

- `runway-surfer-server-bundle` (~6 MB) — il pacchetto offline del backend: `dist/`, `node_modules` di produzione (incluso il binario nativo Linux di `better-sqlite3`), `package.json`, `deploy/` (unit systemd, script di aggiornamento, modello `.env`), `RELEASE.json`.
- `runway-surfer-extension` (~0.3 MB) — lo zip dell'estensione, non serve per questo collaudo.

Recuperabile con l'API pubblica di GitHub (nessuna credenziale necessaria per leggere, il repo è `leocengia/RunwaySurfer`):

```bash
curl -s "https://api.github.com/repos/leocengia/RunwaySurfer/actions/runs?branch=main&per_page=1"
# poi /actions/runs/<id>/artifacts per il link di download (richiede login browser per lo zip)
```

In pratica è più semplice scaricarlo a mano dal browser: repo → Actions → l'ultima esecuzione su `main` → sezione Artifacts.

## Il documento da seguire alla lettera

**`docs/RUNBOOK-BACKEND.md`, sezione «Prima installazione»** (inizia riga 25) contiene la procedura completa in 9 passi, scritta apposta per questo collaudo: pacchetti di base, Node 22 da NodeSource con verifica dell'ABI, journald persistente, utente di servizio, estrazione di `deploy/` dal pacchetto, file di configurazione, installazione di unit e script, `--dry-run`, aggiornamento vero, verifica.

**Segui quella sezione come Pass 1**, criterio di successo per criterio di successo — non improvvisare i comandi, sono già lì e sono stati pensati per intercettare difetti specifici.

## Gli scenari da eseguire dopo Pass 1 (Pass 2)

Nello stesso ambiente WSL2, in quest'ordine. I pacchetti "rotti" per questi scenari si fabbricano **sulla VM stessa** ri-scompattando il pacchetto buono, modificando `RELEASE.json` e ricomprimendo (non servono nuove build dalla CI).

**Non farlo a mano:** `deploy/collaudo/` (dentro il pacchetto) contiene
`fabbrica-pacchetto.sh`, che produce ogni variante, e `scenari.sh`, che esegue gli scenari
verificando i criteri di successo. Prima di tutto va eseguito `deploy/collaudo/00-preflight.sh`:
intercetta le trappole di WSL2 che farebbero fallire uno scenario per il motivo sbagliato.

⚠️ **Gli id fabbricati devono conservare il prefisso data** `AAAA-MM-GG.NNNN.commit`. La
potatura ordina gli id **lessicograficamente** (`sort -r`), non per data: un id tipo `test1`
o `rotto` fa potare la release sbagliata e S1 misurerebbe una cosa falsa.

| #            | Scenario                                                                                               | Comando/modifica                                                                                  | Cosa deve succedere                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **S1**       | Secondo aggiornamento, poi fino al sesto                                                               | Ripacchetta con un `id`/`shortCommit` diverso, `sudo runwaysurfer-update <nuovo>.tar.gz` ripetuto | Backup del DB, `/health` con commit nuovo, `user_version` e conteggio utenti **invariati**, potatura a 5 release mantenute                                                                                                           |
| **S2**       | `--activate <precedente>`, poi senza id, poi con id inesistente                                        | `sudo runwaysurfer-update --activate <id>`                                                        | Rollback manuale ok; senza id → messaggio d'errore chiaro (non una morte silenziosa); id inesistente → errore che nomina il path                                                                                                     |
| **S3** ⚠️    | Pacchetto con `dist/index.js` cancellato → crash-loop                                                  | Ripacchetta con quel file rimosso, installa                                                       | **Rollback automatico riuscito**, simlink tornato alla release precedente. Se questo fallisce con «ROLLBACK FALLITO ANCHE LUI» mentre il simlink è comunque tornato a posto, è una regressione seria — segnalalo subito              |
| **S3b**      | Pacchetto con `node_modules/better-sqlite3/build` rimosso                                              | Ripacchetta, installa                                                                             | Rifiuto pulito **prima** di toccare qualunque cosa, nulla cambiato                                                                                                                                                                   |
| **S4**       | `schemaVersion` abbassato a 4 a mano nel `RELEASE.json`                                                | Ripacchetta, installa; poi prova anche `--activate` su una release con schema abbassato           | Rifiuto con messaggio esplicito sulla guardia forward-only, in entrambi i percorsi                                                                                                                                                   |
| **S4b** ⚠️⚠️ | Release precedente con schema abbassato **e** pacchetto nuovo rotto insieme                            | Combina S3 + S4 — **ma non come verrebbe naturale: vedi sotto**                                   | Deve comparire il blocco «ROLLBACK AUTOMATICO NON ESEGUITO», e **vanno eseguiti per davvero i CINQUE comandi che stampa** per verificare che funzionino. È il test di più alto valore di tutto il collaudo: nessuno l'ha mai provato |
| **S5** ⚠️    | `systemctl enable --now runwaysurfer` **prima** della prima installazione (su un'installazione pulita) | Su un ambiente azzerato (`systemctl disable`, `reset-failed`, `rm -rf /opt/runwaysurfer`)         | Non deve bloccare la prima installazione vera che segue                                                                                                                                                                              |

Per gli scenari marcati ⚠️ ripeti la prova, perché sono le correzioni che giustificano il lavoro fatto in precedenza.

### S4b: come va costruito davvero

Costruito «combinando S3 e S4» alla lettera, **S4b non può riuscire**, e fallirebbe per un
artefatto della procedura invece che per un difetto vero. Due ostacoli:

1. **Un pacchetto a `schemaVersion` 4 non è installabile**: la guardia forward-only lo
   blocca (è proprio ciò che prova S4). Quindi la release «precedente» a schema 4 non si
   installa: va fabbricata modificando a mano il `RELEASE.json` della release **già
   installata**, dopo l'installazione.
   ```bash
   sudo nano /opt/runwaysurfer/releases/<prev>/RELEASE.json   # schemaVersion: 5 → 4
   ```
2. **Il backup ripristinato ha ancora `user_version = 5`.** Quindi l'ultimo dei cinque
   comandi (`--activate <prev>`) sbatte contro la stessa guardia forward-only e muore: la
   procedura di ripristino _sembrerebbe rotta_, ma sarebbe colpa del test. Serve un backup
   con uno schema davvero 4, **prima** di eseguire i cinque comandi:

   ```bash
   sudo cp /opt/runwaysurfer/backups/<backup>.db /tmp/s4b.db
   sudo sqlite3 /tmp/s4b.db "PRAGMA user_version = 4"
   # e usare /tmp/s4b.db come sorgente nel `cp` del secondo comando
   ```

   Così `--activate` confronta 4 con 4, la guardia non scatta, e i cinque comandi si provano
   per davvero — che è il punto dello scenario.

   Abbassare `user_version` a mano **non corrompe niente**: ogni gradino di `migrate()` è
   protetto da un controllo sulle colonne già presenti, quindi la migrazione 5 rigira, vede
   che `truncated` c'è già, non fa la ALTER e si limita a rimettere `user_version = 5`.

Nota su cosa il `RELEASE.json` può e non può falsificare: `shortCommit` viene letto dal file
(quindi modificarlo cambia davvero ciò che `/health` risponde, ed è così che funziona S1),
ma `schemaVersion` a runtime viene **riletto dal codice compilato** e non dal file. Il
`RELEASE.json` modificato a mano inganna quindi le guardie _dello script di aggiornamento_,
che è esattamente ciò che serve provare, ma non il servizio.

I cinque comandi stampati sono: `systemctl stop`, `cp` del backup, `rm -f` dei file
`-wal`/`-shm`, `chown`, `--activate`. **Il `rm` dei due file WAL non va saltato**: lasciarli
farebbe replicare a SQLite un WAL appartenente a un altro database, che è la corruzione
silenziosa classica.

## Pass 0 — le trappole di WSL2

WSL2 non è Ubuntu su ferro. Sei differenze possono far fallire uno scenario **per il motivo
sbagliato**, che è il modo peggiore di sprecare un collaudo. `deploy/collaudo/00-preflight.sh`
le controlla tutte; qui sono elencate perché servono anche a leggere un esito strano.

1. **`systemd` va acceso a mano.** Senza `[boot] systemd=true` in `/etc/wsl.conf`,
   `systemctl cat` fallisce e lo script di aggiornamento _mente_: dice «la unit systemd non
   è installata».
2. **Le direttive di sandboxing della unit** (`ProtectSystem=strict`, `ProtectHome`,
   `PrivateTmp`, `PrivateDevices`, `ProtectKernelTunables`, `ProtectControlGroups`) hanno
   bisogno di mount namespace e cgroup2. Sotto WSL possono dare `status=226/NAMESPACE`,
   **indistinguibile da un crash-loop**: falserebbe sia Pass 1 sia S3. Provarle isolate:
   ```bash
   systemd-run --wait -p ProtectSystem=strict -p ProtectHome=yes \
               -p PrivateTmp=yes -p PrivateDevices=yes /bin/true
   ```
3. **`network-online.target`**: la unit lo mette in `After=`/`Wants=`, ma WSL non ha un
   `wait-online`. La unit non fissa `TimeoutStartSec`, quindi vale il default di 90 s di
   systemd — **più del `HEALTH_TIMEOUT` di 60 s** dello script → rollback spurio.
   Controllare `systemctl is-active network-online.target` e `systemctl list-units --failed`.
4. **Collisione sulla porta 8787.** Con la rete WSL2 in modalità _mirrored_,
   `curl 127.0.0.1:8787` può raggiungere un `npm run dev` in esecuzione **su Windows**, che
   risponde `commit:"dev"` → «risponde ma con il commit sbagliato» → rollback spurio.
   Chiudere ogni dev server Windows prima di iniziare.
5. **CRLF nell'env file.** Lo script pulisce i `\r` quando legge, ma `EnvironmentFile=` di
   systemd **no**: un file creato da Windows consegna al servizio `AI_PROVIDER=mock\r` →
   abort `[config]`, mentre i controlli dello script passano lo stesso. L'env file va creato
   **da dentro WSL** e verificato con `cat -A`.
6. **`/opt/runwaysurfer` deve stare su ext4**, mai sotto `/mnt/c`: su DrvFs symlink e
   permessi non si comportano come servono a `swap_link`.

## Cosa NON provare in WSL2 (rimandare alla VM del CED)

- **Il riavvio vero della macchina** (WSL non ha un vero shutdown/boot systemd — usare al massimo `wsl --shutdown` come approssimazione, sapendo che non prova tutto).
- Partizioni separate per log e database.
- Raggiungibilità di rete reale dalle postazioni.
- Tutto ciò che riguarda il certificato TLS vero (ACME/certbot), l'hostname reale, il firewall del CED, il provider AI reale, il carico con più agenti contemporanei.

## File di riferimento nel repository

- `docs/RUNBOOK-BACKEND.md` — procedura «Prima installazione» (§ da riga 25) e runbook operativo completo.
- `server/deploy/runwaysurfer.service` — unit systemd.
- `server/deploy/runwaysurfer-update.sh` — script di aggiornamento (preflight, backup, scambio simlink, rollback automatico).
- `server/deploy/runwaysurfer.env.example` — modello di configurazione di produzione (attenzione: mai lasciare righe `VAR=` vuote — è la causa di un bug già corretto una volta, di perdita silenziosa del database).
- `server/deploy/collaudo/` — l'harness: `00-preflight.sh`, `fabbrica-pacchetto.sh`, `scenari.sh`, `azzera.sh`. Viaggia **dentro il pacchetto**, quindi c'è anche sulla VM del CED, che non ha GitHub.
- `docs/MAIL-CED-INSTALLAZIONE.md` — la mail già inviata al CED, più la richiesta di follow-up con i dettagli su WSL2.

## Una cosa da tenere a mente durante il collaudo

Se qualcosa non torna, **non fidarti di un test locale che "passa" senza aver capito perché** — in questa stessa sessione un `node_modules` accumulato ha nascosto per giorni un bug che un `npm ci` pulito avrebbe mostrato subito. Quando qualcosa sembra funzionare, verifica che sia per il motivo giusto, non per un effetto collaterale dell'ambiente.
