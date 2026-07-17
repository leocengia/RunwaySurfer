# Piano — Tour a navigazione SPA (KB Salesforce)

> Stato: **hub-and-spoke via SPA implementato** (recon-3 ha confermato la
> meccanica: route SPA ~1s, content-script sopravvive, `history.back()` torna
> all'hub; i collegati sono cross-link nel corpo articolo). Costruiti
> `lib/spa-nav.ts` (`waitForSpaRender`), `findLinkElement` per identità di path,
> e il nuovo `useTourDriver.ts`. **Search-driven rimandata**: la pagina
> `/s/global-search/<q>` è client-rendered e il recon non ne ha catturato i link
> risultato. Da validare manualmente nel profilo KB (vedi Verifica).
> Decisioni con l'utente: (1) tour a navigazione SPA; (2) servono i collegati.

## Contesto e vincolo

La KB è Salesforce Experience Cloud (Aura), **client-rendered**. Confermato
(recon-2): un `fetch()` dell'articolo restituisce solo lo shell, senza testo →
qualunque lettura via fetch (follow, prefetch del tour, search→fetch) legge
vuoto. **L'unico contenuto leggibile è il DOM già renderizzato nel tab.** Quindi
per leggere un altro articolo bisogna far **navigare la SPA** e leggere il DOM
dopo il render. Le pagine Aura navigano client-side (pushState, niente full
reload) → il content-script sopravvive e lo stato React resta (a differenza del
vecchio hub-and-spoke che si rompeva sui reload).

## Domande aperte → `docs/recon-kb-3.js` (da eseguire prima di costruire)

- **A. Meccanica SPA**: cliccare un link `/s/` fa route SPA senza reload? Il
  content-script sopravvive? Tempo di render? `history.back()` riporta all'hub?
- **B. Tassonomia link**: la pagina-articolo del recon-1 aveva quasi solo link
  **topic** (pochi/zero articolo→articolo). Se confermato, l'hub-and-spoke sui
  soli link di pagina rende poco → la fonte dei "collegati" è la **ricerca**.
- **C. Ricerca**: struttura del DOM dei risultati (selettori dei link risultato)
  per poterli leggere e navigare.

## Architettura proposta

Due sorgenti di articoli da leggere, a seconda di B/C:

1. **Hub-and-spoke via SPA** (se le pagine linkano altri articoli): dalla pagina
   di partenza, per ogni target: click sul link → `waitForSpaRender()` → estrai
   il DOM renderizzato (`extractCurrentPage`, origin `followed`) → `history.back()`
   → `waitForSpaRender()` all'hub → prossimo target. Niente persistenza: lo stato
   sopravvive alla route SPA.
2. **Search-driven** (se i "collegati" stanno in tutta la KB, non nei link di
   pagina): si guida la **UI di ricerca** della KB (focus input, set value,
   dispatch input+Enter), `waitForSpaRender()` sui risultati, si raccolgono i
   top-N link risultato (selettori da recon-3C), poi si naviga (SPA) e si legge
   ciascuno come sopra. Nessun reverse-engineering degli endpoint Aura: si usa la
   UI reale.

### Nuovo utility: `waitForSpaRender(opts)`

Cuore del tutto. Attende, con timeout abortabile (~8s), che:
`location.href` sia cambiato dall'atteso **e** il testo di `[role="main"]` sia
non vuoto **e** stabile (nessuna mutazione per ~400ms, via `MutationObserver`).
Ritorna ok/timeout. Degrada bene su `prefers-reduced-motion`.

### Modifiche previste

- `lib/spa-nav.ts` (nuovo): `waitForSpaRender`, `spaNavigate(anchorOrUrl)`,
  `spaBack()`.
- `lib/highlight.ts`: `findLinkElement` deve matchare per **identità di path**
  (`linkIdentity`), non per URL pieno — gli anchor possono avere `?nocache=` che
  il target normalizzato non ha.
- `entrypoints/sidebar.content/useTourDriver.ts`: sostituire il prefetch via
  `shallowFollow` con la camminata SPA (click → wait → read → back). Mantiene
  guard di rientranza, `try/finally`, gestione abort, animazioni FX.
- `App.tsx`: la modalità `visual` torna utile solo qui; valutare una modalità
  `search` se si va sulla sorgente-ricerca.
- Test: `waitForSpaRender` (con DOM simulato + mutazioni), estrazione post-render.

## Rischi

- Fragilità agli aggiornamenti Salesforce (selettori/route). Mitigazione: usare
  la UI reale e selettori larghi + timeout/abort robusti + degrado a single-page.
- Se `history.back()` non ricrea l'hub in modo affidabile, navigare esplicitamente
  allo `startUrl` via SPA.
- Timing di render variabile: gestito da `waitForSpaRender` (stabilità, non tempo
  fisso).

## Verifica

1. `docs/recon-kb-3.js` conferma A/B/C. (Sblocca la costruzione e sceglie 1 vs 2.)
2. `npm run compile|lint|test|build` verdi; Prettier sui file toccati.
3. Manuale nel profilo KB: tour su una query reale → visita 2-3 articoli reali
   (URL cambia e torna), "pagine lette" popolate con contenuto vero, Interrompi
   ferma tutto, nessun FX residuo, degrado a single-page se il render fallisce.
4. Token before/after sulla stessa query.
