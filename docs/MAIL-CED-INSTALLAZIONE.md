# Mail al CED — allineamento e specifica per l'installazione

> Testo pronto da copiare in una mail. L'appendice tecnica in fondo può restare nel
> corpo o diventare un allegato. Il documento lungo già inviato è
> `docs/RISPOSTA-CED-HTTPS.md`: qui viene citato, non ripetuto.
>
> **Da compilare prima di inviare:** il nome della zona DNS di appoggio al punto 1
> (te lo diamo noi quando scegli il provider), e il nome utente SSH al punto 4.

---

**Oggetto:** Runway Surfer — allineamento certificato e specifica per la VM sul rack

Buongiorno,

grazie per le risposte: la parte applicativa è chiusa e già implementata. Vi scrivo
per confermare l'allineamento sul certificato e per darvi tutto il necessario a
preparare la macchina, così potete procedere senza altri passaggi con noi.

---

## 1. Certificato: siamo allineati

Confermato: **certificato pubblico, rinnovo ogni 90 giorni.** Va benissimo.

Un dettaglio che vi semplifica la vita: **il servizio rilegge da sé i file del
certificato.** Non serve fermarlo né riavviarlo dopo un rinnovo, e le risposte in
corso non vengono interrotte. Voi aggiornate due file in una cartella; al resto pensa
l'applicativo, entro pochi minuti o subito con un `systemctl reload`.

Poiché il servizio non sarà raggiungibile da Internet, la verifica di proprietà del
nome da parte dell'autorità di certificazione avviene in entrambi i casi tramite un
**record TXT nel DNS pubblico** di `aviationsrl.it` (il dettaglio tecnico è nel
documento che vi ho inviato). Resta quindi da scegliere solo *come* lo scrivete:

**Opzione A — automatico (consigliata).** Aggiungete **un solo record CNAME
permanente**, e poi non toccate più il DNS:

```
_acme-challenge.runway-surfer.aviationsrl.it.   CNAME   <nome che vi forniamo>
```

Il record punta a una zona gestita da noi. La credenziale che deteniamo può scrivere
**un solo record TXT in una zona che non è vostra**: non può modificare l'A record del
sito, gli MX, né nient'altro in `aviationsrl.it`. Da quel momento il rinnovo è
completamente automatico e nessuno deve ricordarsene.

**Opzione B — manuale ogni 90 giorni.** Funziona, e non abbiamo obiezioni. Servono
tre cose:

- una persona incaricata del rinnovo (e una di riserva);
- un promemoria in calendario;
- `cengia.l@aviationsrl.it` fra i destinatari dell'avviso di scadenza.

Per darvi margine: l'applicativo comincia a segnalare la scadenza **21 giorni prima**,
nei log e sulla pagina di controllo. La finestra è ampia, ma la scadenza non è
recuperabile all'ultimo momento: quando il certificato scade, lo strumento si ferma
per tutti gli agenti nello stesso istante e — poiché la chiamata parte da
un'estensione del browser e non da una pagina — **nessun utente può accettare
un'eccezione**. Non esiste un aggiramento lato utente.

Fateci sapere quale preferite: cambia solo la procedura vostra, non il software.

---

## 2. Cosa NON serve

Per evitarvi lavoro inutile, mettiamo per iscritto anche i non-requisiti:

- **nessun reverse proxy** — il TLS è terminato direttamente dal servizio, come da
  vostra indicazione;
- **nessun accesso a Internet dalla macchina** per installarla o aggiornarla: il
  pacchetto che consegniamo è autoportante e non richiede né npm, né GitHub, né un
  compilatore sul server;
- **nessun inbound da Internet**, su nessuna porta. In particolare **la porta 80 non
  serve** al rinnovo del certificato;
- **nessuna dipendenza** da IIS, Apache o altri componenti web preinstallati;
- nessun database server: il servizio usa un singolo file SQLite locale.

---

## 3. Specifica della VM

| Voce | Valore |
| --- | --- |
| Sistema operativo | **Ubuntu 24.04 LTS**, installazione minimale, **senza ambiente grafico** |
| vCPU | **2** |
| RAM | **2–3 GB** |
| Disco | **20 GB** consigliati (10 GB è il minimo praticabile) |
| Filesystem | ext4, preferibilmente su **LVM**, così le dimensioni si possono ampliare senza reinstallare |
| Rete | IP statico, FQDN impostato correttamente, **NTP attivo** |

Sul dimensionamento, per trasparenza: la RAM non è la risorsa critica — l'applicativo
misurato sta in 60–120 MB, e 2–3 GB sono abbondanti. **La risorsa che può fermare il
servizio è il disco**, e il motivo sono i log (vedi il punto 3.2).

### 3.1 Suddivisione del disco

Fra parentesi la variante a 10 GB.

| Punto di mount | Dimensione | Contiene | Perché separato |
| --- | --- | --- | --- |
| `/boot` | 1 GB (512 MB) | kernel | standard |
| swap | 2 GB (1 GB) | — | |
| `/` | 10 GB (6 GB) | sistema, Node.js, applicativo (`/opt/runwaysurfer`) **e i backup del database** | L'applicativo occupa ~130 MB per versione e ne conserva 5, più una copia del database prima di ogni aggiornamento |
| `/var/log` | 3 GB (1,5 GB) | log di sistema e del servizio | È la **sola voce di disco senza limite superiore**: isolandola, un log che cresce non riempie la radice |
| `/var/lib/runwaysurfer` | 2 GB (1 GB) | database | Isolato **dai log**: un disco pieno corrompe un database SQLite, e i log sono ciò che lo riempirebbe |

Se preferite un partizionamento più semplice, il requisito minimo che vi chiediamo di
rispettare è: **i log e il database non sullo stesso filesystem.**

### 3.2 Rotazione dei log

L'applicativo scrive su standard output e **non ruota nulla, di proposito**: la
destinazione la decide il supervisore, cioè voi. Vi chiediamo tre righe in un file
`/etc/systemd/journald.conf.d/10-runwaysurfer.conf` (un drop-in, così un
aggiornamento di distribuzione non chiede cosa fare del file modificato):

```
[Journal]
Storage=persistent
SystemMaxUse=1G
MaxRetentionSec=90d
```

e, **indispensabile perché le prime due abbiano effetto**, la cartella che Ubuntu
non crea da sé:

```
sudo mkdir -p /var/log/journal && sudo systemd-tmpfiles --create --prefix /var/log/journal
sudo systemctl restart systemd-journald
```

Il motivo di `Storage=persistent`: Ubuntu arriva con `Storage=auto`, che significa
«persistente **solo se `/var/log/journal` esiste**». Senza quella cartella il journal
resta in RAM, `MaxRetentionSec=90d` non ha alcun effetto, i log si azzerano a ogni
riavvio e la partizione `/var/log` che vi chiediamo resterebbe vuota. Sarebbe il
peggiore dei casi: l'unico registro di cosa ha fatto il servizio mancherebbe proprio
dopo l'evento su cui indagare.

90 giorni per far combaciare la conservazione dei log con quella dei dati
applicativi. Senza un tetto, nessun dimensionamento del disco è corretto: cambia solo
la data in cui si riempie.

Nei log **non c'è il testo delle domande degli agenti**, per scelta progettuale.

### 3.3 Software da installare

| Pacchetto | A cosa serve |
| --- | --- |
| `nodejs` **esattamente 22.x LTS** (repository NodeSource) | runtime dell'applicativo |
| `gnupg` | serve a installare la chiave del repository NodeSource |
| `sudo` | usato dall'accesso limitato per gli aggiornamenti (punto 4) |
| `sqlite3` | backup coerente del database |
| `curl`, `tar`, `ca-certificates` | installazione e verifica |
| `certbot` (+ plugin DNS, solo con l'opzione A) | rinnovo del certificato |

**Una richiesta specifica: bloccate la major version di Node** (`apt-mark hold
nodejs`). Motivo concreto: l'applicativo usa un componente compilato contro una
specifica interfaccia binaria di Node. Se un aggiornamento automatico porta la
macchina da Node 22 a Node 24, il servizio non riparte finché non gli consegniamo un
pacchetto ricompilato. La nostra procedura di aggiornamento se ne accorge e si
rifiuta di procedere invece di lasciare il servizio a terra, ma è meglio prevenirlo.
Un cambio di major è un'operazione da concordare, non da subire.

### 3.4 Utente di servizio

Un utente di sistema `runwaysurfer`, **senza shell e senza home**. Il servizio non
gira come root: la porta 443 viene assegnata tramite una capability dichiarata nel
file di servizio (`CAP_NET_BIND_SERVICE`), che vi consegniamo già pronto.

---

## 4. Accesso per gli aggiornamenti

Lo sviluppo di Runway Surfer è ancora in corso, quindi gli aggiornamenti saranno
frequenti — settimanali all'inizio. Per non dover impegnare una persona del CED ogni
volta, vi chiedo un **accesso SSH** con privilegi limitati alle sole operazioni sul
servizio.

La procedura di aggiornamento è un singolo comando che riceve un file:

```
sudo runwaysurfer-update /tmp/runwaysurfer-server-<versione>.tar.gz
```

Verifica il pacchetto, fa il backup del database, sostituisce l'applicativo, riavvia
e controlla che il servizio risponda. **Se qualcosa non torna, rimette da sé la
versione precedente.** Esiste anche `--dry-run`, che esegue solo i controlli senza
toccare nulla.

Regola `sudoers` che ci basta (nessun accesso amministrativo generale). I percorsi
sono `/usr/bin/...` e non `/bin/...`: su Ubuntu 24.04 `/bin` è un collegamento a
`/usr/bin`, e `sudo` **non** risolve i collegamenti prima di confrontare — con
`/bin/systemctl` nella regola, chi digita `sudo systemctl status runwaysurfer` si
sentirebbe rispondere «not allowed».

```
runway-deploy ALL=(root) NOPASSWD: /usr/local/sbin/runwaysurfer-update, \
                                   /usr/bin/systemctl status runwaysurfer, \
                                   /usr/bin/systemctl restart runwaysurfer, \
                                   /usr/bin/systemctl reload runwaysurfer, \
                                   /usr/bin/journalctl -u runwaysurfer *
```

Se preferite non concedere accesso SSH, l'alternativa funziona identica: depositiamo
il pacchetto su una **cartella condivisa** e il comando lo esegue una persona del CED.
Ditemi quale delle due preferite e quale percorso usare.

**Una richiesta collegata:** se avete la possibilità di darci una **VM di prova
usa-e-getta** (stesse caratteristiche, anche senza certificato e senza record DNS),
vorremmo provare la procedura di installazione e di aggiornamento lì prima di
toccare il rack. Non è indispensabile, ma è il modo più economico di non scoprire un
problema durante l'installazione vera.

---

## 5. Due punti ancora aperti

1. **Grafia dell'hostname.** Nelle vostre risposte compare
   `runway-serfer.aviationsrl.it`: ci sembra un errore di battitura per
   `runway-surfer`. Confermatecelo prima dell'emissione, perché il nome finisce in
   modo permanente nei registri pubblici di Certificate Transparency e nella
   configurazione di ogni postazione. Se preferite non decidere adesso, possiamo
   chiedere il certificato con **entrambe le grafie**: così un eventuale cambio non
   costa una riemissione. Fateci sapere se va bene.

2. **Interrogazione dei nameserver pubblici.** Da una postazione aziendale
   `aviationsrl.it` risulta servito dai vostri server di dominio, non dai nameserver
   pubblici: c'è quindi una copia interna della zona. È una configurazione legittima,
   ma ha una conseguenza precisa: il server che richiede il certificato deve poter
   interrogare i **nameserver pubblici** sulla porta 53, altrimenti il controllo di
   pubblicazione del record TXT non trova nulla e il rinnovo **fallisce con un errore
   che sembra non dire niente**. Ve lo segnaliamo in anticipo perché è, con buona
   probabilità, la causa del primo intoppo che incontreremmo.

---

## 6. Regole di rete

Sono quelle già dettagliate al punto 6 del documento che vi ho inviato
(`Runway Surfer in HTTPS — risposta al CED`). In sintesi: **in ingresso** solo TCP 443
dalle subnet delle postazioni e dal pool VPN; **in uscita** l'endpoint del fornitore
AI (da consentire **per nome**, non per indirizzo IP: è dietro una CDN), gli endpoint
del certificato, DNS sulla 53 anche verso i nameserver pubblici, e NTP.

Due voci da aggiungere rispetto a quel documento:

- **SSH** dalla sola subnet amministrativa (punto 4);
- **nessuna regola in uscita** è necessaria per gli aggiornamenti.

Un'avvertenza che vale la pena ripetere: le risposte del servizio sono in streaming e
una connessione può restare aperta **diversi minuti**. Qualunque apparato in mezzo con
un timeout di inattività inferiore a 5 minuti le interrompe a metà, e un proxy in
uscita che ispeziona il traffico e lo accumula riproduce il sintomo «sembra bloccato,
poi stampa tutto insieme» anche in assenza di reverse proxy. Se l'uscita HTTPS passa
da un proxy che autentica o ispeziona, segnalatecelo.

---

## Riepilogo: cosa serve da voi

1. La scelta fra opzione A e opzione B per il rinnovo del certificato (punto 1).
2. Conferma della grafia dell'hostname (punto 5.1).
3. La VM come da specifica al punto 3, con la rotazione dei log impostata e la major
   di Node bloccata.
4. Un accesso SSH limitato, oppure il percorso di una cartella condivisa (punto 4).
5. Le regole di rete del punto 6, compresa la 53 verso i nameserver pubblici.

Con i punti 3, 4 e 5 possiamo installare e collaudare **subito**, in modalità
dimostrativa — senza chiave del fornitore AI, senza traffico verso Internet e senza
costi — mentre si definisce il certificato. E il certificato può essere ottenuto
**prima** che il record DNS esista, quindi nemmeno quello è un blocco
all'installazione.

Resto a disposizione, anche per una call se è più rapido.

Grazie,
Leonardo Cengia
cengia.l@aviationsrl.it — +39 328 052 1769


# La mia versione della mail
Buongiorno,

prima di procedere con l’installazione sul server, vorrei testare Runway Surfer in ambiente Linux, dato che finora ha girato solamente sul mio PC Windows.

Vi chiederei quindi di abilitare sul mio PC **WSL2 con Ubuntu 24.04 LTS e systemd**, installando al suo interno:

* Node.js 22.x LTS e npm;
* Git;
* SQLite3;
* `curl`, `tar` e `ca-certificates`;
* Codex CLI;
* OpenCode.

Codex e OpenCode mi servirebbero per completare lo sviluppo, eseguire i test e preparare il pacchetto da distribuire sul server.

L’iter che propongo è il seguente:

1. prima validazione in ambiente Linux sul mio PC tramite WSL2;
2. correzione dell’applicativo e preparazione del pacchetto Linux;
3. installazione e collaudo su una VM temporanea predisposta dal CED;
4. installazione della versione validata sulla VM definitiva nel rack.

La VM temporanea mi permetterebbe di verificare il pacchetto nell’infrastruttura aziendale prima di intervenire sull’ambiente definitivo.

Per l’installazione finale, ritengo preferibile una **VM Linux minimale**, possibilmente Ubuntu 24.04 LTS, rispetto a una Windows. Potrò così utilizzare lo stesso ambiente già validato durante i test, semplificando installazione, aggiornamenti, gestione del servizio e diagnostica.

Una volta completata la prima validazione in WSL, vi fornirò le specifiche definitive della VM e il pacchetto pronto per il collaudo.

Fatemi sapere se potete procedere o se servono richieste separate per WSL, Codex e OpenCode.

Grazie,
Leonardo

# Prompt per nuova chat
alla fine ho mandato al CED la mia versione della mail che mi avevi preparato (la trovi infondo al file docs/MAIL-CED-INSTALLAZIONE.md , c'è altro che possiamo fare mentre aspettiamo risposta?