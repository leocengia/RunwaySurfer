# Installazione di Runway Surfer — pilota

Guida per chi installa l'estensione sulla postazione di un agente. Serve una
volta per macchina e richiede circa dieci minuti.

**Prima di partire, procurati:**

| Cosa                                  | Chi te lo dà                                    |
| ------------------------------------- | ----------------------------------------------- |
| Il file `runway-surfer-extension.zip` | Leonardo Cengia (viene dalla CI, vedi in fondo) |
| L'indirizzo `https://` del backend    | Leonardo Cengia                                 |
| Utente e password dell'agente         | l'amministratore, dalla Control Dashboard       |

**Referente per qualsiasi problema:** Leonardo Cengia —
[cengia.l@aviationsrl.it](mailto:cengia.l@aviationsrl.it) — +39 328 052 1769.

> **Un avvertimento che vale più di tutto il resto:** l'indirizzo del backend
> deve iniziare per `https://`. Con un indirizzo `http://` l'estensione si
> installa, si apre, mostra il form di login — e poi ogni richiesta viene
> bloccata dal browser senza un errore comprensibile. Non è un problema
> dell'estensione e non si aggira dalle impostazioni.

---

## 1. Scompatta il pacchetto in un percorso stabile

Scegli una cartella che **non verrà spostata né svuotata**, per esempio:

```
C:\Programmi Aziendali\RunwaySurfer\
```

Evita Desktop, Download e cartelle temporanee: se la cartella sparisce,
l'estensione sparisce con lei e va reinstallata.

Scompatta lo zip lì dentro. Devi ritrovarti con un `manifest.json` **nella
cartella**, non dentro un'ulteriore sottocartella. Se lo trovi annidato, sposta
il contenuto di un livello verso l'alto.

## 2. Carica l'estensione in Chrome

1. Apri Chrome e vai su `chrome://extensions`.
2. In alto a destra attiva **Modalità sviluppatore**.
3. Clicca **Carica estensione non pacchettizzata**.
4. Seleziona la cartella del punto 1 (quella che contiene `manifest.json`).

Deve comparire la scheda **Runway Surfer** con l'interruttore attivo.

**Verifica che l'ID sia quello giusto.** Sotto il nome compare `ID:` seguito da
una stringa di lettere. Deve essere esattamente:

```
ihpknodkjnjcbdfmdneeeollnedbdcpd
```

Se è diverso, il pacchetto non è quello ufficiale (probabilmente una build fatta
a mano): fermati e chiedi il pacchetto della CI. Con un ID diverso il backend
rifiuta le richieste, e l'errore che vedrai non lo dirà chiaramente.

## 3. Imposta l'indirizzo del backend

Clicca l'icona di Runway Surfer nella barra di Chrome. Si apre la pagina di
configurazione.

> Se non vedi l'icona, clicca sul simbolo del puzzle (estensioni) e fissa Runway
> Surfer con la puntina.

1. Incolla l'indirizzo `https://...` nel campo **URL**.
2. Premi **Testa connessione**. Deve rispondere _«Connessione riuscita»_.
3. Premi **Salva**.

Se il test non riesce, **non proseguire**: leggi la sezione _Se qualcosa non
funziona_ più in basso. Salvare un indirizzo che non risponde sposta solo il
problema al primo utilizzo, davanti a un cliente al telefono.

> Se la tua azienda distribuisce la configurazione via policy, il campo appare
> già compilato e bloccato. È normale e va bene così: salta al punto 4.

## 4. Primo accesso

1. Apri la Knowledge Base e vai su **un articolo** (non la home).
2. La sidebar di Runway Surfer compare sul lato destro della pagina.
3. Inserisci utente e password dell'agente.
4. Al primo accesso Chrome chiede di **cambiare la password**: fallo scegliere
   all'agente, non impostarla tu.

## 5. Verifica che funzioni davvero

Fai una prova con una domanda vera, per esempio _«si può cambiare il nome sul
biglietto dopo il check-in?»_, e controlla queste tre cose:

- la risposta **compare progressivamente**, parola per parola, non tutta insieme
  dopo una lunga attesa;
- sotto la risposta ci sono i **titoli degli articoli** usati come fonti, e
  cliccandoli si apre l'articolo in una nuova scheda;
- l'intestazione blu della sidebar è **allineata** con la banda blu del sito.

Se la risposta arriva tutta in blocco dopo venti secondi di apparente blocco,
l'estensione funziona ma il proxy davanti al backend sta accumulando la
risposta: segnalalo al referente tecnico citando _«buffering del proxy»_, si
risolve con una riga di configurazione lato server.

## 6. Lascia all'agente due informazioni

- **Come si apre e si chiude:** la sidebar si apre da sé sugli articoli; la `×`
  in alto la chiude e resta chiusa fino al prossimo articolo.
- **A chi segnalare i problemi:** Leonardo Cengia —
  [cengia.l@aviationsrl.it](mailto:cengia.l@aviationsrl.it) — +39 328 052 1769.
  È l'unica cosa che l'agente cercherà quando qualcosa non va: lasciagliela
  scritta da qualche parte, non solo detta a voce.

---

## Se qualcosa non funziona

| Cosa vedi                                               | Cosa significa                                                       | Cosa fare                                                                         |
| ------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| «Backend non raggiungibile» con il pulsante **Riprova** | il servizio non risponde, ma la sessione dell'agente è ancora valida | verifica la rete o la VPN, poi premi Riprova. Non serve rifare il login           |
| Il form di login ricompare da solo                      | la sessione è scaduta o è stata revocata                             | rifai l'accesso                                                                   |
| «Nessuna risposta dal servizio» nel test di connessione | indirizzo sbagliato, servizio spento o rete assente                  | ricontrolla l'indirizzo carattere per carattere, poi chiedi conferma al referente |
| La sidebar non compare                                  | non sei su un articolo, oppure l'estensione è disattivata            | apri un articolo; controlla l'interruttore su `chrome://extensions`               |
| «Sembra la pagina di login della KB»                    | la sessione della Knowledge Base è scaduta                           | rientra nella KB e riprova                                                        |
| La risposta arriva tutta insieme dopo una lunga attesa  | buffering del proxy lato server                                      | segnalalo: è una configurazione del server, non della postazione                  |

Quando segnali un problema, riporta **il testo esatto** del messaggio che vedi:
i messaggi sono scritti per essere diversi l'uno dall'altro proprio per far
capire da lontano cosa è andato storto.

---

## Per il referente tecnico

**Da dove viene il pacchetto.** Ogni esecuzione della CI su `main` produce
l'artifact `runway-surfer-extension` (vedi `.github/workflows/ci.yml`). Scaricalo
da lì: così il pacchetto è tracciabile a un commit invece di essere costruito a
mano su un portatile. In locale `npm run zip` produce lo stesso file in
`.output/`, ma usalo solo per le prove.

**Perché l'ID è fisso.** Il manifest include la chiave pubblica
dell'estensione, quindi l'ID è identico su tutte le macchine e non dipende dal
percorso della cartella. Questo permette un solo valore di CORS lato backend:

```
ALLOWED_ORIGIN=chrome-extension://ihpknodkjnjcbdfmdneeeollnedbdcpd
```

Con `AI_PROVIDER=anthropic` il backend **rifiuta di avviarsi** se
`ALLOWED_ORIGIN` è `*`, quindi questo valore è obbligatorio. La chiave privata
corrispondente non è nel repository: serve solo a firmare un `.crx` e va
custodita a parte.

**Configurazione via policy.** Per non toccare dieci postazioni a mano, l'URL del
backend può arrivare da `storage.managed` (lo schema è in
`public/managed-schema.json`). Su Windows:

```
HKLM\Software\Policies\Google\Chrome\3rdparty\extensions\ihpknodkjnjcbdfmdneeeollnedbdcpd\policy
  proxyUrl = "https://runway-surfer.esempio.local"
```

Un valore impostato via policy vince su quello locale e appare bloccato nella
pagina di configurazione.

**Diagnostica estesa.** Per vedere modello, token stimati, costo ed egress nel
pannello della risposta, dalla console della pagina KB:

```js
chrome.storage.local.set({ 'rs:debug': true });
```

È volutamente nascosto: un agente al telefono non deve leggere «Stima costo
$0.0004».

**Icone.** Sono generate dal marchio con `node docs/build-icons.mjs`, che riscrive
`public/icons/{16,32,48,128}.png`. Se il logo cambia, si rilancia quel comando e si
ricostruisce: non serve nessuno strumento grafico né dipendenze aggiuntive.

**Cosa non è ancora coperto.** L'installazione è manuale: non c'è distribuzione
via Chrome Web Store né `ExtensionInstallForcelist`. Per 5-10 agenti è una scelta,
non una dimenticanza.
