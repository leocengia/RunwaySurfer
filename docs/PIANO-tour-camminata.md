# Piano — Tour visivo: "camminata in-page" (niente avanti-e-indietro)

> Piano salvato per riprendere il lavoro da qualsiasi dispositivo. Quando vuoi eseguirlo,
> apri il repo in Claude Code e di': «esegui il piano in `docs/PIANO-tour-camminata.md`».
> Stato: **non ancora implementato**. I fix dei bug precedenti sono già committati su questo
> branch (`claude/fix-tour-mode-bug-and-more`).

## Context

Il tour visivo oggi è **hub-and-spoke con navigazioni reali**: dalla pagina di partenza va
al link, ne legge il contenuto, torna indietro, passa al prossimo, ecc. Ogni salto è un
reload completo (il content script si rimonta → flash, contesto perso). Per un umano il
percorso risulta **scattoso e "confusionario"** per via di questi continui avanti-e-indietro.

Decisione presa con l'utente: trasformare il tour in una **camminata in-page**:
- La sidebar **resta sulla pagina di partenza** per tutta la camminata: nessuna navigazione
  per-link, nessun "ritorno". Il content script non si ricarica → niente flash, lo stato
  React sopravvive naturalmente.
- **Si mantengono le animazioni attuali** (spotlight sul link, cursore fantasma che scorre,
  click ripple, banner narrante, beam di "lettura").
- Il contenuto delle pagine target viene **letto via `fetch`** (riuso di `shallowFollow`/
  `fetchPage` in `lib/crawl.ts`, gli stessi della modalità "segui link"), **prefetch in
  parallelo** all'inizio così non ci sono attese.
- **L'unica navigazione mostrata è quella finale** verso la fonte scelta (una sola), come
  chiesto: "la navigazione mostrata deve essere l'obiettivo finale".

Come conseguenza gratuita, sparisce la persistenza per-hop dello stato (fonte di diversi bug
precedenti): resta solo il passaggio del **risultato finale** attraverso l'unica navigazione.

## Design — nuovo `driveTour` (`entrypoints/sidebar.content/useTourDriver.ts`)

Sostituire la macchina `while(true){ switch(phase) }` con un'unica funzione async lineare,
**mantenendo il guard di rientranza e il `try/finally`** (conserva il fix Bug 0: reset di
`drivingRef` nel `finally`). Flusso:

1. **Setup una volta**: `ensureFxStyles()`, `installFxSafetyNet()`, `setTour/setQuery/
   setPagesUsed/setStatus('reading')`. `total = targets.length`, `units = total + 1`.
2. **Prefetch subito** (prima del loop, così si sovrappone alle animazioni):
   `const followedPromise = shallowFollow(t.targets, t.query, t.targets.length);`
   (i target hanno già `score` da `pickRelevantLinks`, quindi `shallowFollow` li usa
   direttamente; i fetch falliti tornano `null` e vengono scartati → "salta e continua").
3. **Loop animazioni** `for i in 0..total-1` (sempre sulla pagina di partenza):
   - abort-check in cima; `setTour({...,index:i,phase:'scrolling'})` per far avanzare il
     testo "passo X/Y" nel pannello; `mountBanner`; `setBannerProgress(i/units)`.
   - `el = findLinkElement(target.url)`:
     - **presente**: `narrate(narrationOpen)`, `spotlightOn(el)`,
       `setBannerProgress((i+0.5)/units,false,700)`,
       `await Promise.all([smoothScrollTo(el,{shouldAbort}), cursorGlideTo(el,650,shouldAbort)])`,
       abort-check, `abortableSleep(dwellMs)`, abort-check, `cursorClick(el)`, `offSpotlight()`.
     - **assente/collassato**: solo `narrate("Non trovo il link…")` e salta l'animazione del
       cursore — **senza navigare** (differenza chiave dall'attuale fallback che faceva
       `location.href`). La pagina viene comunque raccolta dal prefetch.
   - **Beam di lettura sulla pagina corrente**: `setBannerProgress((i+1)/units,false,scanMs)`
     + `runReadingScan({keywords: target.matchedKeywords, durationMs: scanMs, shouldAbort})`.
     Nessuna modifica a `runReadingScan`: il beam scorre la pagina di partenza; le keyword
     dei target semplicemente non vengono evidenziate se assenti (no-op, visivamente uguale).
     Per legare meglio la "lettura" al link, opzionalmente tenere lo `spotlight` sul link
     durante lo scan (rifinitura minore, da valutare in test).
   - abort-check dopo lo scan.
4. **Await prefetch** prima dell'analisi: `const followed = await followedPromise;`
   `const pages = [...t.pages, ...followed]; setPagesUsed(pages);` (in pratica già risolto).
5. **Fase asking** (come oggi, senza persistenza): banner "analisi", `setBannerProgress(
   total/units, true)`, `result = await runAsk(query, pages, targets)`;
   **guard post-ask** `if (tourAbortRef.current) { setTour(null); teardownFx(); return; }`;
   `bannerComplete`, `sleep(500)`, `unmountBanner`, `teardownFx`.
6. **Unica navigazione finale**: `targetUrl = findTourTargetUrl(result.outcome, pages)`; se
   esiste e diverso dall'URL corrente → `saveTourResult({...})` + `location.href = targetUrl`.
   È l'unico `location.href` rimasto nel file.

**Import**: aggiungere `shallowFollow` da `../../lib/crawl`; rimuovere `extractCurrentPage`,
`clearTour`, `saveTour`; mantenere gli helper `lib/fx`, `findLinkElement`, `findTourTargetUrl`,
`saveTourResult`, `DEFAULT_SCAN_MS`, `normalizeUrl`, `type TourState`.

## Semplificazione `lib/tour.ts`
- **Rimuovere** i `TourPhase` `'navigating'` e `'returning'` (nuova union:
  `'idle' | 'scrolling' | 'asking' | 'done' | 'error'`); eliminare `saveTour` e `loadTour`
  (nessun chiamante dopo il rewrite); aggiornare i commenti di intestazione/fase (descrivono
  l'hub-and-spoke non più valido).
- **Mantenere**: `TourState`, `startTour` (invariato: costruisce targets/pages),
  `TourResultState`, `saveTourResult`/`loadTourResult`/`clearTourResult`, `clearTour`
  (pulizia difensiva di eventuali `rs:tour` legacy), `markTourAborted` + `ABORT_KEY`,
  `normalizeUrl`, `DEFAULT_DWELL_MS`, `DEFAULT_SCAN_MS`.
- **Preservare la garanzia "stop durante la navigazione finale"**: dato che `loadTour`
  (ex-consumatore di `ABORT_KEY`) sparisce, aggiungere in `loadTourResult` lo stesso check —
  leggere `[RESULT_KEY, ABORT_KEY]` e, se `abortedAt >= result.startedAt`,
  `clearTourResult()` e `return null`.

## Cambi in `App.tsx`
- `run()` ramo visual: **rimuovere `await saveTour(t)`**; il resto invariato (i reset di
  `drivingRef`/`tourAbortRef`, `clearTour`, `clearTourResult` restano — preservano il fix Bug 0).
- **Rimuovere la `useEffect` di resume** (`loadTour` + `driveTour`): la camminata non attraversa
  reload, non c'è nulla da riprendere. Sostituirla con una sweep di mount:
  `teardownFx(); void clearTour();`.
- **Lasciare invariata** la `useEffect` di atterraggio (`loadTourResult`) — ripristina la
  risposta dopo l'unica navigazione finale (beneficia anche del nuovo check `ABORT_KEY`).
- `stopTour`, `resetSession`, l'effetto `TOUR_ABORT_EVENT` e la JSX: invariati.
- Import da `../../lib/tour`: rimuovere `loadTour`, `saveTour`.

## Test
- Invariati: `tests/tour-target.test.ts`, `tests/crawl.test.ts`, `tests/extract.test.ts`,
  `tests/client.test.ts`.
- **Nuovo `tests/tour-walk.test.ts`**: stub di `fetch` (pattern già in `client.test.ts`),
  chiamare `shallowFollow(targets, query, targets.length)` (ciò che invoca `driveTour`) e
  verificare: (a) `KbPage[]` con `origin:'followed'` e conteggio/titoli attesi; (b) `fetch`
  chiamato una volta per target con `{credentials:'include'}`; (c) un target che fallisce
  viene saltato; (d) **`location.href` invariato** (invariante "legge senza navigare").

## File da modificare
- `lib/tour.ts` — sfoltire phase/persistenza, check `ABORT_KEY` in `loadTourResult`.
- `entrypoints/sidebar.content/useTourDriver.ts` — rewrite del flusso (loop in-page).
- `entrypoints/sidebar.content/App.tsx` — togliere `saveTour`, sostituire la effect di resume,
  aggiornare import.
- `tests/tour-walk.test.ts` — nuovo.
- `lib/crawl.ts` — nessuna modifica (solo `export fetchPage` se in futuro si vuole la raccolta
  incrementale per-target; non necessario ora).
- Nessun cambio a `lib/fx/*`, `lib/highlight.ts`, `lib/tour-target.ts`.

## Verifica
1. `npm run compile` (verifica che i `TourPhase`/import rimossi non lascino riferimenti
   pendenti), `npm run lint`, `npm run test` (suite verdi + nuovo test), `npm run build`;
   Prettier solo sui file toccati (il checkout Windows è CRLF: usare `--end-of-line auto`).
2. **Manuale** (`npm run dev`, pagina KB con ≥2 link rilevanti): avviare "Tour visivo" e
   confermare: (a) durante la camminata l'URL **non cambia mai** — spotlight, cursore, click,
   beam girano sulla pagina di partenza; (b) la lista "pagine lette" si popola coi target
   fetchati; (c) al termine **una sola** navigazione verso la fonte scelta, con risposta
   ripristinata all'atterraggio; (d) "Interrompi" a metà camminata e durante l'analisi finale
   ferma tutto senza FX residui né navigazioni post-abort; (e) con `prefers-reduced-motion`
   le animazioni degradano e la camminata si completa.
