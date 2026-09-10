# Runway Surfer in HTTPS — risposta al CED

**Riferimento:** incontro del 26/08/2026 e risposte ricevute.
**Data:** 27/08/2026 · **Referente:** Leonardo Cengia — cengia.l@aviationsrl.it

Grazie: con le vostre risposte la parte applicativa è **chiusa e già
implementata**. Restano due cose da decidere insieme, una sola delle quali è
bloccante. Questo documento le isola, e riporta le verifiche che abbiamo fatto nel
frattempo per non farvi perdere tempo su domande a cui potevamo rispondere noi.

---

## 1. Cosa è chiuso

| Punto                                      | Deciso                 | Stato lato nostro                                                                                                                        |
| ------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Reverse proxy                              | Nessuno                | ✅ Il TLS è terminato direttamente dal processo Node. Implementato.                                                                      |
| Buffering delle risposte                   | Non serve senza proxy  | ✅ Confermato. Vedi però la nota sull'**egress** al punto 6.                                                                             |
| Rinnovo automatico, fuori dall'applicativo | Sì                     | ✅ L'applicativo legge due file PEM e li ricarica da sé; il rinnovo lo fa un job di sistema vostro. Nessuna dipendenza dall'applicativo. |
| Dimensionamento                            | 10 GB disco / 3 GB RAM | ✅ Va bene. Aggiungiamo due precisazioni al punto 5.                                                                                     |
| Sistema operativo                          | A nostra scelta        | ✅ **Debian o Ubuntu LTS.** Motivi al punto 4.                                                                                           |
| Record DNS dopo l'installazione            | Sì                     | ✅ Nessun problema: possiamo installare e collaudare **prima** che il record esista (punto 7).                                           |

Sul rinnovo, il contratto preciso: voi ci mettete due file in una cartella
(`/etc/runwaysurfer/tls/`), il vostro job li aggiorna quando vuole, e il servizio
li rilegge da solo — **senza riavvio e senza interrompere le risposte in corso**.
Se il vostro job un giorno non parte, il servizio continua a funzionare e comincia
a scrivere un avviso nei log tre settimane prima della scadenza.

---

## 2. Il punto bloccante: come validare il certificato

C'è un'incompatibilità fra due delle vostre risposte, e va risolta prima di
emettere qualsiasi cosa.

Avete chiesto un **certificato gratuito** (tipo Let's Encrypt) e un servizio
raggiungibile **solo da LAN e VPN**. Una CA pubblica, prima di emettere, deve
verificare che il richiedente controlli davvero il nome. Ha tre modi:

| Metodo      | Come funziona                                                                                                                              | Utilizzabile qui?                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| HTTP-01     | La CA si collega dall'Internet pubblico a `http://<hostname>` sulla **porta 80**                                                           | ❌ Il record A punterà a un indirizzo privato, e non vogliamo (né voi né noi) inbound da Internet                              |
| TLS-ALPN-01 | Come sopra, sulla **porta 443**                                                                                                            | ❌ Stesso motivo. In più richiederebbe che la logica di rinnovo stia _dentro_ l'applicativo, l'opposto di quanto avete chiesto |
| **DNS-01**  | La CA legge un record **TXT** su `_acme-challenge.<hostname>` nella zona DNS **pubblica** di `aviationsrl.it`. Non si collega mai all'host | ✅ **L'unica strada**                                                                                                          |

Due conseguenze, una buona e una da concordare.

**La buona.** Con DNS-01 la CA non risolve né contatta l'host: **dove punta il
record A è irrilevante.** Il record A può esistere **solo nel vostro DNS interno
e non essere mai pubblicato**. Ottenete un certificato pubblicamente attendibile
senza esporre un solo indirizzo interno in una zona pubblica. E il certificato si
può ottenere **prima** che il record A esista.

**Da concordare.** Perché il rinnovo sia automatico, qualcosa deve poter scrivere
quel record TXT ogni volta.

---

## 3. La richiesta: un record CNAME, una volta sola

Non vi chiediamo credenziali del DNS. Vi chiediamo **un record permanente**, che
poi non toccherete mai più:

```
_acme-challenge.runway-surfer.aviationsrl.it.   CNAME   <nome in una zona gestita da noi>
```

Il nome esatto a destra ve lo forniamo noi una volta scelta la zona di appoggio.

**Perché è sicuro.** La verifica DNS segue i CNAME come qualunque altra
risoluzione: la CA parte dal vostro nome, segue il rinvio e legge il TXT nella
zona di destinazione. Quindi:

> La credenziale che deteniamo può scrivere **un solo record TXT in una zona che
> non è vostra**. Non può toccare l'A record del sito, gli MX, né nient'altro in
> `aviationsrl.it`. Voi mantenete il controllo completo della zona; noi otteniamo
> l'automazione.

È lo schema standard usato proprio per non dover distribuire chiavi API di zona,
e nel nostro caso è anche una necessità tecnica: vedi il punto 8.

---

## 4. Sistema operativo: Debian / Ubuntu LTS

Se avete già VM Linux in questo rack, e qualcuno che le patcha e le monitora, la
scelta è Linux, per motivi concreti:

- il file di servizio `systemd` esiste già nel repository, testato;
- la nostra integrazione continua compila e testa **solo** su Linux: è l'unica
  piattaforma sotto verifica automatica a ogni modifica;
- l'unico componente nativo dell'applicativo (`better-sqlite3`) ha binari
  precompilati per Linux glibc — quindi **non** un'immagine Alpine;
- la rotazione dei log è gratuita (`journald`), e la rotazione è l'unica cosa che
  può riempire il disco (punto 5);
- il client di rinnovo certificati è un pacchetto `apt` con il proprio timer di
  sistema, che vedete in `systemctl list-timers` come qualunque altro job vostro.

**Se invece la risposta onesta è che non gestite Linux qui**, ditecelo e passiamo a
Windows Server: funziona, ma comporta lavoro extra su rotazione dei log, sulla
verifica che la 443 sia libera (spesso la occupa IIS) e sul meccanismo di
ricarica. Preferiamo una macchina che sappiate gestire alle tre di notte, non
quella tecnicamente più elegante. La domanda utile non è «Linux o Windows», è:
**avete già VM Linux qui, e chi le patcha?**

---

## 5. Dimensionamento: confermato, con due precisazioni

10 GB di disco e 3 GB di RAM vanno bene. Aggiungiamo:

- **2 vCPU** invece di 1. Il carico è di attesa sulla rete, quindi una CPU
  basterebbe; la seconda serve perché l'accesso al database è sincrono e tiene
  backup, antivirus e job di sistema fuori dal percorso delle risposte.
- **La RAM non è la risorsa critica.** Misurata, l'applicazione sta in 60–120 MB.
  3 GB è abbondante e va benissimo così: non chiediamo di ridurla, lo diciamo solo
  perché il numero che conta è un altro.
- **Il disco sì, e a una condizione.** Il database si pulisce da sé (90 giorni di
  storico). I log **no**: l'applicativo scrive su standard output e non ruota
  nulla di proposito, perché la destinazione la decide il supervisore.

> **Senza una politica di rotazione dei log, nessun dimensionamento è corretto:
> cambia solo la data in cui il disco si riempie.** E un disco pieno non degrada
> il servizio, corrompe il database.

Su Linux sono due righe in `journald.conf` (`SystemMaxUse=1G`,
`MaxRetentionSec=90d`). Se rientra nella vostra politica standard, per noi è
chiuso. Nei log **non c'è il testo delle domande degli agenti**, per scelta.

---

## 6. Rete: cosa aprire, e cosa non aprire

### In ingresso al server

| Porta                  | Da                                 | Note                                                                                                                                                                                       |
| ---------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **TCP 443**            | Subnet delle postazioni + pool VPN | È anche la porta della console di amministrazione: è lo stesso servizio, non c'è una porta separata. Se l'accesso amministrativo va limitato, si fa con una ACL sull'indirizzo di origine. |
| TCP 80 _(facoltativa)_ | Stesse origini                     | Solo per un redirect verso https, comodità per chi apre la console da un vecchio segnalibro.                                                                                               |
| SSH                    | Sola subnet amministrativa         |                                                                                                                                                                                            |

> **Nessun inbound da Internet, su nessuna porta.** In particolare la porta 80
> **non** serve al rinnovo del certificato: usiamo la validazione DNS.

### In uscita dal server

| Destinazione                   | Porta      | Quando                                                                                                                                                 |
| ------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.anthropic.com`            | 443        | Solo con il provider reale attivo. **Da consentire per nome, non per indirizzo IP**: l'host è dietro una CDN e gli indirizzi cambiano senza preavviso. |
| Endpoint Let's Encrypt         | 443        | Rinnovo del certificato                                                                                                                                |
| API DNS della zona di appoggio | 443        | Rinnovo del certificato                                                                                                                                |
| DNS                            | 53 udp+tcp | **Anche verso i nameserver pubblici** — vedi punto 8, è importante                                                                                     |
| NTP                            | 123 udp    | Uno scarto d'orologio rompe sia TLS sia il rinnovo                                                                                                     |

### Dalle postazioni

Solo `https://<hostname>` e la Knowledge Base. **`api.anthropic.com` non serve su
nessuna postazione**: la chiave API resta sul server e non la vede nessun client.
È uno dei motivi per cui esiste questo backend.

### Una nota sul buffering, che non è scomparso

Avete ragione: senza reverse proxy non c'è nulla da configurare. Ma le risposte
sono in streaming e una connessione può restare aperta **diversi minuti**. Quindi:

- se l'uscita verso Internet passa da un proxy che **ispeziona TLS e
  bufferizza**, il sintomo «sembra bloccato e poi stampa tutto insieme» torna
  identico, sul lato uscita;
- qualunque apparato in mezzo (firewall, IDS, proxy) con un **idle timeout
  inferiore a 5 minuti** taglia le risposte a metà.

Domanda secca: **l'uscita HTTPS passa da un proxy che autentica o ispeziona il
traffico?**

---

## 7. Ordine di installazione (e perché non aspettiamo il DNS)

Il certificato si ottiene con la validazione DNS, che non richiede che il record A
esista. Quindi possiamo installare e collaudare tutto prima del vostro ticket DNS:

1. VM Debian, indirizzo statico, orologio sincronizzato, VM inserita nei vostri
   inventari di patch, backup e monitoraggio.
2. Node.js 22, utente di servizio dedicato, cartelle.
3. Deploy dell'applicativo e file di configurazione.
4. **Prima installazione in modalità dimostrativa** (`AI_PROVIDER=mock`): nessun
   traffico verso Internet, nessuna chiave API, nessun costo. Così un problema in
   questa fase può essere solo di TLS, DNS o rete — mai del motore AI. Sblocca
   l'installazione dal ticket sull'uscita firewall e dalla consegna della chiave.
5. Emissione del certificato — **prima** di qualunque record A. Con una prova
   preliminare contro l'ambiente di collaudo di Let's Encrypt, per non consumare i
   limiti di produzione (5 tentativi falliti per nome all'ora: si esauriscono in
   un pomeriggio).
6. Avvio del servizio sulla 443 e verifica locale **contro l'hostname reale**,
   ancora senza DNS:
   ```sh
   curl --resolve runway-surfer.aviationsrl.it:443:127.0.0.1 \
        https://runway-surfer.aviationsrl.it/health
   ```
   Questo valida catena e certificato contro il nome vero senza alcuna
   risoluzione DNS.
7. **Vostro ticket: record A interno** → indirizzo del server. Verifica da una
   postazione in ufficio e da una in VPN (controllando che la VPN instradi la
   subnet e passi il DNS interno).
8. Collaudo da una postazione reale: console nel browser senza avvisi, poi una
   domanda dentro la KB verificando che la risposta arrivi **progressivamente** e
   non in blocco.
9. Passaggio al provider reale, dopo la regola di uscita e la consegna della
   chiave.
10. **Prova del rinnovo.** È il passo che si salta sempre: forziamo un rinnovo
    anticipato e verifichiamo che il certificato _servito_ sia cambiato **senza
    riavvio del servizio**.

---

## 8. Verifiche che abbiamo già fatto noi

Per non farvi rispondere a domande evitabili, abbiamo controllato il DNS pubblico
dall'esterno e da una postazione aziendale. Tre risultati, e uno è importante.

**Nessun record CAA sul dominio.** Né su `aviationsrl.it` né sul TLD `.it`.
Significa che non c'è nulla che impedisca l'emissione di un certificato gratuito.
Era la domanda che poteva bloccare tutto in partenza, ed è chiusa. _(Se in futuro
aggiungete un CAA, va incluso `letsencrypt.org` o il servizio si ferma al rinnovo
successivo — vale la pena saperlo.)_

**La zona pubblica è su nameserver KPNQwest, il sito è su Aruba.**
`aviationsrl.it` è servito da `ns.kpnqwest.it` e `ns2.kpnqwest.it`, mentre
l'indirizzo del sito (62.149.175.65) è in una rete Aruba. Da qui la domanda: **in
quale pannello entrate per modificare i record DNS, e ha un'API?** Ce lo chiediamo
perché nessuno degli strumenti standard di rinnovo certificati ha un modulo per
KPNQwest — ed è la ragione tecnica, non politica, per cui al punto 3 vi chiediamo
un CNAME e non delle credenziali: con le credenziali non sapremmo comunque cosa
farne senza scrivere e mantenere codice su misura.

**Esiste una copia interna della zona `aviationsrl.it` sul vostro DNS di
dominio.** Da una postazione aziendale, `aviationsrl.it` risulta servito da
`srvorchideadc1.orchidea.local` / `srvorchideadc2.orchidea.local`, non dai
nameserver pubblici. È una configurazione legittima e diffusa, ma ha una
conseguenza precisa su questo lavoro:

> Il server che chiede il certificato, prima di far verificare la CA, controlla da
> sé che il record TXT sia stato pubblicato. Se interroga il **DNS interno**, non
> lo trova — perché la copia interna della zona non contiene quel record — e il
> rinnovo **fallisce con un errore che sembra non dire nulla**, pur essendo tutto
> corretto sul lato pubblico.

Si risolve consentendo al solo server Runway Surfer di interrogare i **nameserver
pubblici** sulla porta 53 (è la riga «DNS» della tabella al punto 6). Segnaliamo
questo punto in anticipo perché è, con buona probabilità, la causa del primo
fallimento inspiegabile che incontreremmo in fase di installazione.

---

## 9. Domande aperte

**Bloccanti**

1. **La grafia dell'hostname è `runway-serfer` o `runway-surfer`?** Nelle vostre
   risposte compare `runway-serfer`; sospettiamo un errore di battitura.
   Confermatelo prima dell'emissione: il nome finisce in modo **permanente** nei
   registri pubblici di Certificate Transparency e nella policy di ogni
   postazione, e cambiarlo dopo richiede un nuovo certificato **e** una nuova
   distribuzione della policy. Se preferite non decidere ora, possiamo chiedere il
   certificato con **entrambe** le grafie, così un cambio non costa una
   riemissione: diteci solo se va bene.
2. **Il record CNAME del punto 3.** È l'unica cosa che serve per rendere il
   rinnovo automatico.
3. **Avete già VM Linux in questo rack, e chi le patcha e le monitora?** (punto 4)

**Rispondibili durante l'installazione**

4. In quale pannello si modificano i record DNS di `aviationsrl.it`, e ha un'API?
   (punto 8)
5. Consentite al server l'interrogazione dei nameserver pubblici sulla 53?
   (punto 8)
6. Sull'host previsto, la **porta 443 è libera**?
7. L'uscita HTTPS passa da un proxy che autentica o ispeziona TLS? (punto 6)
8. L'uscita verso `api.anthropic.com` può essere consentita **per nome** e non per
   indirizzo IP? (punto 6)
9. Rotazione dei log e backup del database rientrano nella vostra politica
   standard? (punto 5)
10. Chi riceve gli avvisi di **scadenza certificato e rinnovo fallito**, e si può
    aggiungere `cengia.l@aviationsrl.it` come destinatario di riserva?
11. Chi custodisce la chiave API, e vive in un file di configurazione sul server o
    in un vault?

---

## 10. Se il CNAME non è concedibile

Lo diciamo chiaramente, perché è meglio saperlo adesso che fra due mesi:
**«certificato gratuito» + «rinnovo automatico» + «nessuna automazione del DNS»
non è un insieme realizzabile.** Uno dei tre requisiti va lasciato cadere.

I certificati pubblici gratuiti durano 90 giorni e vanno rinnovati ogni ~60. E la
finestra si sta chiudendo per decisione di settore, non per scelta: la durata
massima dei certificati pubblici scende a 100 giorni nel 2027 e a 47 nel 2029,
quindi «a mano ogni due mesi» diventa «a mano ogni mese».

Quando un rinnovo manuale viene dimenticato, il servizio si ferma **per tutti gli
agenti nello stesso istante**, e — poiché la chiamata parte da un'estensione del
browser e non da una pagina — **nessun utente può accettare un'eccezione sul
certificato.** Non esiste alcun aggiramento lato utente: si riparte solo quando
interviene chi conosce la procedura.

In quel caso le alternative, in ordine di preferenza:

1. **CA interna.** Vale la pena una seconda verifica: «non ne abbiamo una»
   significa _non esiste_ o _non vogliamo attivarla_? Siete un ambiente Active
   Directory, e la parte difficile — distribuire la CA radice come attendibile su
   tutte le postazioni via GPO — nella vostra infrastruttura è già risolta. Da lì
   il certificato è un template e cinque minuti, con validità di 1–2 anni, zero
   esposizione pubblica e zero dipendenze da Internet. Per un servizio solo interno
   è **meno lavoro complessivo** di quanto stiamo discutendo.
2. **`step-ca`.** CA interna open source che parla lo stesso protocollo di Let's
   Encrypt: gli strumenti standard funzionano identici, in automatico, senza
   toccare alcun DNS pubblico e senza uscire su Internet. Radice distribuita una
   volta via GPO.
3. **Certificato a pagamento.** Nota: anche una CA commerciale non può validare
   via HTTP un nome che punta a un indirizzo privato, quindi serve **comunque** un
   record TXT — ma una volta ogni ~200 giorni invece di ogni 60. È la versione
   onesta del «lo facciamo a mano»: sostenibile con un promemoria in calendario e
   due persone incaricate. Un certificato gratuito rinnovato a mano non lo è.

Una **wildcard `*.aviationsrl.it`** già in uso per il sito pubblico sarebbe
un'altra via, e avrebbe un vantaggio: l'hostname interno non finirebbe nei
registri pubblici. Ma metterebbe la chiave privata di _tutto_ il dominio su un
server applicativo interno, e la distribuzione andrebbe automatizzata comunque,
altrimenti è la stessa trappola manuale spostata di posto. La segnaliamo per
completezza; se la valutate, va con il vostro benestare esplicito.

---

## Riepilogo: cosa serve da voi per partire

1. Conferma della grafia dell'hostname (o l'ok a chiederle entrambe).
2. Il record CNAME del punto 3 — **o** la scelta di una delle alternative del
   punto 10.
3. Una VM Debian/Ubuntu con 2 vCPU, 3 GB RAM, 10 GB disco, nei vostri inventari
   di patch, backup e monitoraggio.
4. Le regole di rete del punto 6 (compresa la 53 verso i nameserver pubblici).
5. Rotazione dei log configurata.

Con i punti 3, 4 e 5 possiamo installare e collaudare **subito**, in modalità
dimostrativa, senza aspettare né il certificato né il record DNS.
