# Survey agenti — Bacino di domande per l'assistente

> **Scopo.** Raccogliere dagli agenti le **richieste reali** che gestiscono ogni giorno e **con quali
> parole** le cercherebbero. Serve a tarare scoring, vocabolario e alias dell'estensione
> (vedi `docs/MAPPA-KB.md`, Passa 6: _"10-15 domande/richieste reali degli agenti"_).
>
> **Pubblico.** Team non tecnico. Regole di scrittura della survey: frasi corte, zero gergo
> (niente "query", "retrieval", "KB base"), ogni domanda con un esempio, quasi tutto **facoltativo**,
> **anonima**, ~5 minuti. Una sola domanda obbligatoria per non spaventare nessuno.

---

## Impostazioni consigliate del Google Form

- **Non** raccogliere le email / **anonima** (Impostazioni → disattiva "Raccogli indirizzi email").
- Barra di avanzamento **attiva** (dà l'idea che è breve).
- Una risposta a testa non necessaria (lascia risposte multiple libere).
- Messaggio di conferma finale: _"Grazie! Il tuo aiuto rende l'assistente più utile per tutti."_

**Titolo:** RunwaySurfer — Le domande di ogni giorno

**Descrizione (testo introduttivo):**

> Ciao! Stiamo preparando un assistente che ti aiuta a trovare **al volo** procedure e risposte nella
> Knowledge Base di Runway. Per farlo funzionare bene ci serve il tuo aiuto: raccontaci **che richieste
> gestisci** e **con che parole** le cercheresti.
> Non è un test, non ci sono risposte giuste o sbagliate, ed è **anonimo**. Ti bastano **5 minuti**. Grazie!

---

## Sezione 1 — Due parole su di te _(tutto facoltativo)_

**D1. Da quanto tempo fai questo lavoro?**
_Tipo: scelta multipla · facoltativa_
- Meno di 1 anno
- Da 1 a 3 anni
- Da 3 a 5 anni
- Più di 5 anni

**D2. Di che tipo di richieste ti occupi di più?** _(puoi scegliere più di una)_
_Tipo: caselle di controllo · facoltativa_
- Voli
- Hotel e alloggi
- Pacchetti e viaggi combinati
- Noleggio auto
- Rimborsi e cambi
- Account e accesso (password, email)
- Pagamenti e carte
- Frodi e sicurezza
- Programmi fedeltà e punti
- Altro…

**D3. Più o meno, quante volte al giorno cerchi qualcosa nella Knowledge Base?**
_Tipo: scelta multipla · facoltativa_
- Quasi mai
- Qualche volta
- Spesso
- Di continuo

---

## Sezione 2 — Le richieste che ricevi _(la parte più importante)_

> **Testo di sezione:** Pensa a una giornata normale al telefono. Scrivi **con parole tue**, come le
> diresti a un collega — non serve che siano perfette.

**D4. Scrivi una richiesta che i clienti ti fanno spesso.**
_Tipo: risposta breve · **obbligatoria**_
_Testo di aiuto:_ Esempio: «Il cliente vuole il rimborso di un volo cancellato», oppure «Come cambio la data di una prenotazione hotel».

**D5. E un'altra richiesta frequente.**
_Tipo: risposta breve · facoltativa_
_Testo di aiuto:_ Esempio: «Il cliente non riesce ad accedere al suo account».

**D6. Un'altra ancora, se te ne viene in mente.**
_Tipo: risposta breve · facoltativa_
_Testo di aiuto:_ Esempio: «La carta è stata rifiutata al pagamento».

**D7. Con quali parole la cercheresti nell'assistente? Scrivi esattamente quello che digiteresti.**
_Tipo: paragrafo · facoltativa_
_Testo di aiuto:_ Scrivi come faresti davvero, anche a parole spezzate. Esempio: per un rimborso magari scriveresti solo «rimborso volo cancellato».

**D8. Raccontaci un caso difficile o particolare su cui vorresti aiuto.**
_Tipo: paragrafo · facoltativa_
_Testo di aiuto:_ Le eccezioni, i «e se invece…», i casi che non trovi mai o che ti fanno perdere tempo.

---

## Sezione 3 — Come ti trovi meglio _(veloce)_

**D9. Di solito cerchi in italiano o in inglese?**
_Tipo: scelta multipla · facoltativa_
- In italiano
- In inglese
- Un po' e un po'

**D10. In una risposta, cosa ti serve di più?** _(scegline anche più di una)_
_Tipo: caselle di controllo · facoltativa_
- La procedura passo-passo
- Le eccezioni e i casi particolari
- La frase giusta da dire al cliente
- Il link all'articolo della Knowledge Base

> _Nota per chi analizza:_ le opzioni di D10 corrispondono alle 4 sezioni che l'estensione già produce
> (Procedura · Eccezioni · Risposta suggerita al cliente · Fonti). Serve a capire su quale dare priorità.

---

## Sezione 4 — Ultima cosa

**D11. C'è qualcosa che cerchi spesso e fai fatica a trovare?**
_Tipo: paragrafo · facoltativa_

**D12. Vuoi aggiungere altro? Qualsiasi suggerimento è utile.**
_Tipo: paragrafo · facoltativa_

---

## Appendice — Script per generare il Form in automatico

Chi crea il form può evitare di inserire le domande a mano: incolla questo script in
[script.google.com](https://script.google.com) (Nuovo progetto → incolla → **Esegui** `creaSurveyRunwaySurfer`,
autorizza) e nella cartella Drive comparirà il Google Form già pronto. L'URL di compilazione viene
stampato nel log dell'esecuzione (Visualizza → Log).

```javascript
function creaSurveyRunwaySurfer() {
  const form = FormApp.create('RunwaySurfer — Le domande di ogni giorno');
  form.setDescription(
    'Ciao! Stiamo preparando un assistente che ti aiuta a trovare al volo procedure e risposte ' +
    'nella Knowledge Base di Runway. Per farlo funzionare bene ci serve il tuo aiuto: raccontaci ' +
    'che richieste gestisci e con che parole le cercheresti. Non è un test, non ci sono risposte ' +
    'giuste o sbagliate, ed è anonimo. Ti bastano 5 minuti. Grazie!'
  );
  form.setCollectEmail(false);
  form.setProgressBar(true);

  // --- Sezione 1 ---
  form.addPageBreakItem().setTitle('Due parole su di te').setHelpText('Tutto facoltativo.');

  form.addMultipleChoiceItem()
    .setTitle('Da quanto tempo fai questo lavoro?')
    .setChoiceValues(['Meno di 1 anno', 'Da 1 a 3 anni', 'Da 3 a 5 anni', 'Più di 5 anni']);

  form.addCheckboxItem()
    .setTitle('Di che tipo di richieste ti occupi di più? (puoi scegliere più di una)')
    .setChoiceValues([
      'Voli', 'Hotel e alloggi', 'Pacchetti e viaggi combinati', 'Noleggio auto',
      'Rimborsi e cambi', 'Account e accesso (password, email)', 'Pagamenti e carte',
      'Frodi e sicurezza', 'Programmi fedeltà e punti',
    ])
    .showOtherOption(true);

  form.addMultipleChoiceItem()
    .setTitle('Più o meno, quante volte al giorno cerchi qualcosa nella Knowledge Base?')
    .setChoiceValues(['Quasi mai', 'Qualche volta', 'Spesso', 'Di continuo']);

  // --- Sezione 2 ---
  form.addPageBreakItem()
    .setTitle('Le richieste che ricevi')
    .setHelpText('Pensa a una giornata normale al telefono. Scrivi con parole tue, come le diresti a un collega — non serve che siano perfette.');

  form.addTextItem()
    .setTitle('Scrivi una richiesta che i clienti ti fanno spesso.')
    .setHelpText('Esempio: «Il cliente vuole il rimborso di un volo cancellato», oppure «Come cambio la data di una prenotazione hotel».')
    .setRequired(true);

  form.addTextItem()
    .setTitle("E un'altra richiesta frequente.")
    .setHelpText('Esempio: «Il cliente non riesce ad accedere al suo account».');

  form.addTextItem()
    .setTitle("Un'altra ancora, se te ne viene in mente.")
    .setHelpText('Esempio: «La carta è stata rifiutata al pagamento».');

  form.addParagraphTextItem()
    .setTitle('Con quali parole la cercheresti nell\'assistente? Scrivi esattamente quello che digiteresti.')
    .setHelpText('Scrivi come faresti davvero, anche a parole spezzate. Esempio: per un rimborso magari scriveresti solo «rimborso volo cancellato».');

  form.addParagraphTextItem()
    .setTitle('Raccontaci un caso difficile o particolare su cui vorresti aiuto.')
    .setHelpText('Le eccezioni, i «e se invece…», i casi che non trovi mai o che ti fanno perdere tempo.');

  // --- Sezione 3 ---
  form.addPageBreakItem().setTitle('Come ti trovi meglio');

  form.addMultipleChoiceItem()
    .setTitle('Di solito cerchi in italiano o in inglese?')
    .setChoiceValues(['In italiano', 'In inglese', "Un po' e un po'"]);

  form.addCheckboxItem()
    .setTitle('In una risposta, cosa ti serve di più? (scegline anche più di una)')
    .setChoiceValues([
      'La procedura passo-passo',
      'Le eccezioni e i casi particolari',
      'La frase giusta da dire al cliente',
      "Il link all'articolo della Knowledge Base",
    ]);

  // --- Sezione 4 ---
  form.addPageBreakItem().setTitle('Ultima cosa');

  form.addParagraphTextItem()
    .setTitle('C\'è qualcosa che cerchi spesso e fai fatica a trovare?');

  form.addParagraphTextItem()
    .setTitle('Vuoi aggiungere altro? Qualsiasi suggerimento è utile.');

  Logger.log('Form creato. Link da condividere: ' + form.getPublishedUrl());
  Logger.log('Link per modificarlo: ' + form.getEditUrl());
}
```

---

## Come useremo le risposte

- **D4-D8** → bacino di richieste reali e delle **parole esatte** usate dagli agenti: alimenta alias e
  scoring, e i "casi difficili" segnalano articoli/eccezioni da coprire meglio.
- **D2** → su quali aree concentrare prima l'indice e i test.
- **D9** → conferma/aggiusta la scelta lingua (ricerca in EN, risposta in IT — `docs/MAPPA-KB.md`).
- **D10** → priorità tra le 4 sezioni di output (Procedura / Eccezioni / Risposta al cliente / Fonti).
- **D11** → buchi di copertura della KB.
