# Collaudo prima del pilota

Le cose che i test automatici **non possono dire**. I test dimostrano che il codice
si comporta come previsto; questa lista serve a scoprire se l'agente vede una
sidebar sensata quando qualcosa va storto.

Da eseguire in Chrome, sulla KB reale, con l'estensione caricata da
`.output/chrome-mv3-dev` (`npm run dev`) o dallo zip della CI.

**Come si legge:** ogni scenario ha _cosa fare_ e **cosa deve accadere**. Se
l'esito è diverso, annota il testo esatto del messaggio che vedi — i messaggi sono
scritti per essere distinguibili l'uno dall'altro proprio per questo.

---

## A. Resilienza: la sidebar non deve incastrarsi

Sono i quattro guasti che bloccavano il lavoro.

### A1 · Backend spento all'apertura

Ferma il backend, poi apri un articolo della KB.

**Deve** comparire «Backend non raggiungibile» con un pulsante **Riprova**, e la
frase che dice che la sessione è ancora valida. **Non deve** comparire il form di
login: farebbe digitare le credenziali per poi mostrare un errore di rete.

Riavvia il backend e premi Riprova: si entra senza rifare l'accesso.

### A2 · Backend fermato a metà risposta

Fai una domanda e, mentre la risposta scorre, ferma il backend.

**Deve** comparire un messaggio che invita a riprovare, e il pulsante **Ricerca
deve tornare cliccabile**. Il testo già arrivato resta a schermo.

> Prima di questa correzione il pulsante restava disabilitato su «Generazione...»
> **per sempre**: l'unica via d'uscita era ricaricare la pagina.

### A3 · Backend che accetta e non risponde

Metti un breakpoint in `/ask` (o sospendi il processo) e fai una domanda.

**Deve** scattare il timeout dopo ~30 secondi di silenzio, con un messaggio, e la
sidebar deve sbloccarsi.

### A4 · Sessione revocata durante un tour

Avvia una ricerca in **Immersiva**, e mentre cammina revoca la sessione
dell'agente dalla dashboard (Utenti → reset password).

**Deve** fermarsi, dire perché, e **non navigare altrove**. Prima proseguiva e
lasciava l'agente su un'altra pagina col form di login, dopo minuti di tour.

---

## B. Il tour immersivo

Sono i tre guasti osservati nel primo uso reale.

### B1 · Nessuna scheda nuova

Scegli un articolo che compaia **anche** nel menu di testata o in «Trending
Articles» (è il caso normale), e fai una domanda che porti il tour a visitarlo.

**Deve** navigare nella stessa scheda. **Non deve** aprirsi nessuna scheda nuova,
e alla fine devi ritrovarti sulla pagina di partenza.

> Causa originale: la ricerca dell'anchor scandiva tutto il documento e prendeva
> il primo, che sulla KB è quello nel menu — con `target="_blank"`.

### B2 · Il cursore non finisce nell'angolo

Osserva il cursore fantasma per un tour intero, poi **fanne subito un secondo**.

**Non deve** comparire in alto a sinistra, né saltarci a metà percorso, né in
nessuno dei due tour. Il secondo è il caso che sfuggiva: la posizione sopravviveva
al primo tour.

### B3 · Follow-up che non ricammina

Fai una domanda in Immersiva, aspetta la risposta, poi fai una **seconda domanda
sullo stesso tema** — a cui la pagina aperta può rispondere.

**Deve** rispondere subito, **senza animazione di camminata**. Il pannello sotto la
risposta deve dire «Memoria: 1 domanda precedente».

### B4 · Follow-up che invece deve camminare

Ancora in Immersiva, fai una seconda domanda su un **tema diverso**, la cui
risposta sta in un altro articolo.

**Deve** camminare, ma solo verso l'articolo nuovo: non deve rileggere quelli già
visitati nel turno precedente.

---

## C. Dati dei clienti

### C1 · Redazione della domanda

Scrivi una domanda con dentro un'email finta, un PNR (es. `3XKZ9P`) e 13 cifre.

**Deve**: la sidebar dice quanti dati ha rimosso e di che tipo; e nel payload di
rete (DevTools → Network → `/ask`) ci sono `[EMAIL]`, `[PNR]`, `[TKT]` — **non** i
valori originali. Nel terminale del backend la domanda **non compare**.

### C2 · Redazione del commento di feedback

Apri **Feedback** dal footer, dai un 👎 e scrivi un commento contenente un'email.

**Deve**: l'avviso di redazione compare nel pannello, e nel payload di `/feedback`
c'è il segnaposto. Nella dashboard → Feedback il commento appare redatto.

### C3 · Un numero di volo NON deve essere redatto

Scrivi «il volo LH1234 è stato cancellato».

**Non deve** essere toccato: serve alla domanda e non identifica nessuno. Se
venisse redatto, la risposta perderebbe il riferimento.

---

## D. Feedback e segnalazioni

### D1 · Il giro completo del feedback

Fai una domanda, ricevi la risposta, apri **Feedback**, dai un giudizio e invia.

**Deve** comparire nella dashboard → scheda **Feedback**, con agente, giudizio,
domanda e modello. La riga deve arrivare **senza ricaricare** premendo _Aggiorna_.

### D2 · Segnalazione generica

Apri Feedback **senza aver fatto domande** (subito dopo il login).

**Deve** permettere l'invio dicendo che è una segnalazione generale — è il caso «la
sidebar non si apre».

### D3 · Risposta senza fonti

Fai una domanda su un tema che **non esiste nella KB** (es. una policy di un
vettore non coperto).

**Deve**: in sidebar compare «Nessuna fonte citata», e la richiesta appare nella
dashboard fra le **Segnalate dal sistema** con tipo _senza fonti_. È il segnale che
dice quali buchi ha la Knowledge Base.

### D4 · Guasto tecnico segnalato

Provoca un errore (backend fermato a metà, o budget esaurito).

**Deve** comparire fra le segnalate con tipo _guasto_ e il dettaglio dell'errore.

---

## E. Domanda mal posta

### E1 · Suggerimento, non blocco

Scrivi solo «e poi?» e premi Ricerca.

**Deve** comparire un avviso che suggerisce di aggiungere l'argomento — e la
ricerca **deve partire comunque**. L'agente a volte sa cosa sta cercando.

### E2 · Nessun avviso su una domanda buona

Scrivi «si può cambiare il nome sul biglietto dopo il check-in?».

**Non deve** comparire nessun avviso. Un suggerimento su una domanda valida
insegna a ignorare i suggerimenti.

---

## F. Schedule Change

### F1 · L'ultima casella resta bloccata

Attiva l'interruttore, poi prova a togliere tutte le caselle dei campi di output.

**Deve** restarne una: l'ultima è disabilitata con la spiegazione. Senza, la
risposta cambierebbe forma in silenzio (sezioni standard invece dei campi
tariffari).

### F2 · Città non riconosciuta

Compila la coppia con un nome inventato, es. `Vattelapesca-Parigi`.

**Deve** comparire un avviso che nomina la parte non riconosciuta e suggerisce i
codici. Prima passava in silenzio come se l'itinerario fosse valido.

### F3 · Refuso di tre lettere

Scrivi `MLI-PAR` (refuso per MIL).

**Deve** essere segnalato come da controllare. Prima qualunque tripletta di lettere
veniva promossa a codice IATA valido.

---

## G. Guardrail e configurazione

### G1 · Budget mensile

Abbassa **Budget mensile €** a un valore già superato.

**Deve**: `/ask` risponde 429 e la card della dashboard mostra **lo stesso numero**
che sta bloccando. Riavvia il backend: **il blocco resta** — si legge da SQLite, non
da un contatore in memoria. E resta fino al primo del mese, a meno di alzare la
soglia.

### G2 · Rate limit per agente

Supera le richieste/ora di un agente.

**Deve** dare 429 con messaggio chiaro; dopo la finestra si riparte. Gli **altri
agenti non devono** essere toccati.

### G3 · Avvio senza chiave

`AI_PROVIDER=anthropic` senza `ANTHROPIC_API_KEY`.

**Il backend non deve partire**, e deve dire cosa manca.

### G4 · Consenso all'installazione

Su `chrome://extensions`, guarda i permessi richiesti.

**Non deve** comparire nessun riferimento a wikipedia.org, né `scripting`, né
`activeTab`. L'ID deve essere `ihpknodkjnjcbdfmdneeeollnedbdcpd`.

---

## H. Aspetto

### H1 · Le tre bande blu allineate

Apri un articolo con la sidebar aperta.

**Deve**: l'intestazione della sidebar è incolonnata con la banda della KB (64px
misurati). Durante un tour, anche la barra superiore. Scorrendo, la banda della KB
scompare e quella della sidebar resta: è corretto, è un pannello fisso.

### H2 · Le fonti vanno a capo

Cerca qualcosa che produca fonti dai titoli lunghi (`Flight | Policies |
ASC—Global—I-L`).

**Deve** andare a capo per intero: niente puntini di sospensione, niente
sfondamento del pannello.

### H3 · Marchio e tipografia coerenti

Guarda: sidebar, banner del tour, pagina di configurazione, dashboard, pagina di
login.

**Deve** comparire lo stesso marchio su tutte, e lo stesso font. Controlla al
**140% di zoom**, che è lo zoom reale della postazione.

### H4 · Riquadri dei controlli visibili

Guarda il selettore delle modalità e l'interruttore Schedule Change.

**Devono** leggersi come riquadri distinti dal fondo, mantenendo l'effetto vetro.

---

## Ambienti da provare, oltre al proprio

- **Un'altra macchina**, seguendo `docs/INSTALLAZIONE-PILOTA.md` alla lettera e
  partendo dallo zip della CI. È l'unico modo di sapere se il documento è vero: se
  qualcosa va indovinato, il documento è incompleto.
- **Zoom 100% e 140%**: la seconda è la configurazione reale.
- **`prefers-reduced-motion` attivo** (Windows: Impostazioni → Accessibilità →
  Effetti visivi): il tour deve restare utilizzabile senza animazioni.
