# MAPPA-KB — Rilevazioni sulla KB Salesforce

> Rilevazioni + conclusioni sulla KB, usate per tarare `lib/site-profile.ts`, `lib/extract.ts`,
> `lib/crawl.ts`, `lib/spa-nav.ts` e i settings backend.
>
> **Non si compila più a mano.** La raccolta dati è automatizzata: esegui il probe
> `docs/recon-kb-verify.js` (procedura in `docs/PIANO-verifica-scansione-KB.md`) e passa il JSON a
> `docs/recon-kb-analyze.mjs`, che stampa la tabella verdetto (assunzione → check → PASS/FAIL →
> azione). Qui incolli quell'output e scrivi le **conclusioni**; le sezioni "Passa" tengono solo i
> **reperti già verificati** e le decisioni. Le passe 8-11 sono chiuse (verificate/implementate).

## Sezione 0 — Autorizzazione (compilare PRIMA di scansionare)

Scansionare la KB autenticata e far uscire fixture/HAR dal browser tocca policy legali/privacy.

- **Approvatore:** Leonardo Cengia · **Data:** 20/07/2026
- ☑ Account SSO titolato a vedere tutti gli articoli · ☑ Export corpi/HAR permesso da policy/DPA
- ☐ Set classificati (PCI/PII/legal-hold) da escludere: **\_\_\_\_** · ☐ Uso un **profilo/account
  dedicato di test** (non la sessione di un agente in produzione)

**Regole (già imposte dagli script):** _do-not-capture_ — mai cookie/`aura.token`/`fwuid`/Bearer/
identità agente/PII: lo scrub `rsScrub`/`rsVerifyClean` **blocca il download** se resta un match.
_Minimizzazione_ — enumerazione = solo metadati URL; taratura su un campione (≥5 articoli), non sui
2.964 corpi.

## Raccolta dati (automatizzata)

La procedura completa è in **`docs/PIANO-verifica-scansione-KB.md`**. In sintesi: su un articolo
autenticato, Console DevTools → incolla `docs/recon-kb-verify.js` (per i test dinamici prima
`window.RS_VERIFY_NAV = true`) → scarica `rs-verify-<slug>.json` → `node docs/recon-kb-analyze.mjs
rs-verify-<slug>.json`. Il probe copre le Passe 0-6 (selettori, rumore, collegati, timing SPA,
navigazione) e l'analizzatore stampa la tabella verdetto. La baseline token (Passa 7) esce dalla
tabella `requests`. Incolla qui sotto l'output dell'analizzatore e scrivi le conclusioni.

### Rilevazioni live — 2026-07-20/21 · 4 articoli + 1 topic (statico, NAV off)

Confermato su **5 pagine** (articoli da 31k a 65k char + 1 topic); `recon-kb-analyze.mjs` → 4/7 PASS
sugli articoli.

- ✅ **origin** giusto (0 redirect) su tutte; ✅ **fetch = shell** su tutte (raw ~500 kB, 0
  content-selector nel grezzo → follow-via-fetch **MORTO, definitivo**); ✅ **sessione** valida.
- ✅ **`[role="main"]` vince SEMPRE**; **`.forceCommunityArticleLayout` e `.cuf-content` sempre a 0**
  → vanno tolti da `contentSelectors` (evidenza solida su 5 pagine). Sul topic compare anche
  `article`×10 (le tile-articolo), ma role=main vince lo stesso.
- ✅ **collegati = veri `<a href>`** (non componenti senza href).
- ❌ **rumore**: i `noiseSelectors` attuali tolgono **1–3%** sugli articoli (il grosso è la **lista
  link** interna) ma **22%** sul topic (lì il rumore sono header/footer). → serve un selettore che
  tolga il blocco-lista per il TESTO; da individuare su **fixture** (prossimo passo) + affidarsi a E2.
- ⚠️ **cap link**: articoli con **39 / 77 / 110** anchor in `[role="main"]` → `extractInternalLinks
max=40` è troppo basso su 3 pagine su 4. Da alzare + scoping corpo vs lista.
- 🔎 **piattaforma** (tutte): `$A` presente ma **fetch wrappato da Locker/LWS** (`fetchNative:false`);
  **iframe CONSENTITO** (`frame-ancestors 'self'`, `SAMEORIGIN`) → via B2 **iframe** confermata
  candidata; `#auraLoadingBox` presente = readiness; **ka0 leggibili da IndexedDB** (`recordLayoutMap`,
  8–19 chiavi, **plaintext**) → i recordId degli articoli **già visitati** sono leggibili anche
  dall'ISOLATED (utile per getRecord v2); `encodeForServer` assente, bootstrap-fwuid intermittente.
- 🐞 **Viewport/reflow (importante):** restringendo la finestra / aprendo F12, la pagina **topic**
  re-renderizza e la sezione "feed" mostra _"Log in to post to this feed"_ (componente Chatter a
  larghezza ridotta). Non è un bug del probe, ma **avvisa** che la sidebar, restringendo la pagina
  (`body.marginRight`), può innescare re-render responsivi → verificare che sull'articolo non tagli
  o nasconda il corpo (test in Sessione B con estensione).
- ⏳ **PENDING**: E2 (fixture offline — prossimo), timing+navigazione B2 (run dinamico), getRecord
  (C15), baseline token.

---

## Decisione lingua (emersa dal recon)

Il **contenuto degli articoli è in inglese** (`lang=en-US`) e la **ricerca della KB non funziona
con query in italiano**. Decisione: **retrieval/ricerca in inglese** (dove stanno i dati e dove la
ricerca funziona) + **UI sidebar in italiano** + **risposta generata in italiano** (il backend già
produce sezioni IT). Conseguenza: lo scoring locale per keyword è debole cross-lingua → appoggiarsi
a ricerca KB / Suggested Articles più che al matching di parole; eventualmente tradurre la query
IT→EN prima della ricerca (raffinamento futuro).

## Passa 0 — Tassonomia URL / tipi di pagina

_Raccolto da `recon-kb-verify.js` C1. Riferimento tipi:_

| Tipo    | Esempio pathname              | Contenuto o lista? | Param rilevanti |
| ------- | ----------------------------- | ------------------ | --------------- |
| article | `/Runway/s/article/<slug>`    | contenuto          | `language`      |
| topic   | `/Runway/s/topic/<id>/<slug>` | lista              | `language`      |
| home    | `/Runway/s/`                  | —                  |                 |

**Conclusioni:** identità = origin+path (slug), unico param utile `language` (→ `linkIdentity`,
`keepParams`). Da aggiungere a `rejectPathIncludes`: `/s/topic/`, `/s/global-search/`, `/s/category/`.
`detail` **non esiste** su questa KB (né in sitemap né trovabile); i topic portano un `&tabset-…`
extra (rumore → lo togliamo, `linkIdentity` già ignora i query param).

## Passa 1 — Content-root & rumore

_Raccolto da `recon-kb-verify.js` C2 (selettori) / C3 (rumore). CONFERMATO su 5 pagine (4 art + topic):_

- **Corpo:** `[role="main"]` vince **sempre** (articoli 31k–65k char). ⚠️ **`.forceCommunityArticleLayout`
  e `.cuf-content` sempre a 0** su tutte → vanno tolti da `contentSelectors`, `[role="main"]` è la root
  reale. (Sul topic anche `article`×10 = le tile, ma role=main vince lo stesso.)
- **Rumore:** i `noiseSelectors` attuali sono presenti ma tolgono solo **1–3%** del testo di role=main
  sugli articoli (**22%** sul topic). Il rumore-testo vero sugli articoli è la **lista link** interna
  (39–110 anchor) → serve un selettore che rimuova quel blocco per l'estrazione testo (i link restano
  per la scoperta) + affidarsi a E2. Il container esatto va individuato su **fixture** (prossimo passo).

## Passa 2 — Qualità estrazione

_Raccolto da `recon-kb-verify.js` C2/C3._ role=main sugli articoli: **31k / 40k / 40k / 65k char**, di
cui gran parte è la lista link (il corpo vero è molto più piccolo). → l'estrazione grezza è enorme: la
leva **E2 per-heading** (`FOCUSED_PAGE_CHARS` 4.500) è essenziale, ma va **verificata offline** che
`focusedByHeading` funzioni sul DOM reale (fixture) — non che ricada silenziosamente sul per-blocco.

## Passa 3 — Sorgenti dei "collegati"

_Raccolto da `recon-kb-verify.js` C8. CONFERMATO su 5 pagine:_ i "collegati" **SONO veri `<a href>`**
(smentisce il timore che fossero componenti senza href): **39 / 77 / 110** anchor-articolo negli
articoli, 21 sul topic. Ma NON stanno nel container `[class*="related"]` (0 lì): sono una lista ampia
dentro role=main. → la scoperta link funziona, ma **il cap `MAX=40` è troppo basso** (superato su 3/4
articoli) e va curato lo scoping (corpo vs lista). Scoring per-keyword debole cross-lingua (mitigato
da E3 + indice E4).

**Pannello "Suggested Articles" — ASINCRONO, lento (2026-07-28, run dinamico):** `suggestedAnchorCount`
resta **0** anche dopo un run completo con attese (C16 ~2.3s) **e** dopo scroll+1.2s (C18,
`virtualized:false`) — il pannello semplicemente non è ancora popolato in quella finestra di tempo.
Conferma: **non affidarsi al pannello Suggested per la scoperta link "al volo"** — l'indice KB (E4,
`lib/kb-index.json`) resta la fonte primaria, indipendente dal timing di rendering della pagina.

## Passa 4 — Profilo navigazione SPA

_Da compilare con `recon-kb-verify.js` C6/C7 (`RS_VERIFY_NAV=true`):_ tempi render min/med/max,
`backRestored`, full-reload, e quale meccanismo intercetta la route (matrice C7). → tara
`waitForSpaRender` + decide il meccanismo B2. Vuoto finché non arriva il probe dinamico.

_Indizi dal run statico (articolo A):_ `#auraLoadingBox` presente → possibile **gate di readiness**
per `waitForSpaRender` (più robusto della sola stabilità del testo). Il **framing è consentito**
(`frame-ancestors 'self'`) → se il click sintetico non intercetta, la via **iframe** (C9) è la
candidata primaria per B2. `$A` è raggiungibile in MAIN world (per l'eventuale bridge).

## Passa 5 — Ricerca `/s/global-search`

**Scartata come modalità** (Passa 11 · GAP 3): la scoperta degli articoli passa dall'indice KB (E4),
non dalla ricerca in-app. `recon-kb-search.js` resta utile solo per l'enumerazione (Passa 8).

## Passa 6 — Tassonomia & vocabolario

**Risolta in Passa 8:** i 135 topic della sitemap hanno già alimentato `INTENT_ALIASES` (E1). Resta
solo un input **tuo** (testo libero), utile ma non bloccante: 10-15 domande/richieste reali degli
agenti, per affinare scoring e `GENERIC_LINK_WORDS`.

## Passa 7 — Baseline token (per modalità)

Obiettivo: quantificare l'effetto delle leve E (Passa 10) su **token/costo/modello** con query
reali, per (a) dimostrare il risparmio e (b) ri-tarare le soglie del router (`router.ts`) con
numeri veri invece che a occhio.

### Cattura AUTOMATICA dalla tabella `requests` (zero codice)

Il costo per query **è già misurato e persistito**: l'`AiPlan` (`shared/contracts.d.ts`) è
costruito in `server/src/routes/ask.ts`, mostrato live nella sidebar (`.rs-plan`, `App.tsx`) e
salvato per **OGNI** `/ask` nella tabella `requests` (`server/src/db.ts`,
`insertRequestHistory`). Colonne che contano:

`model`, `pages_count`, `links_count`, `estimated_input_tokens`, `estimated_output_tokens`,
`estimated_cost_usd`, `actual_input_tokens`, `actual_output_tokens`, `duration_ms`,
`query_preview`, `status`.

Interrogabile senza trascrizioni via `GET /requests?limit=N` e `GET /analytics/summary`
(`server/src/routes/admin.ts`, auth `team_lead`), o leggendo direttamente
`server/data/runwaysurfer.db`. Visibile anche nella dashboard **"Recent requests"**
(`server/src/views/dashboard.ts`), che ora mostra **stima** e **token reali** affiancati.

**Set di query fisso (3-5), EN + IT**, rappresentative dei topic reali (dal vocabolario dei 135
topic della Passa 8): es. `refund a cancelled flight` / `rimborso volo cancellato`,
`change hotel booking`, `baggage allowance`, `WestJet schedule change`. Da lanciare **sempre
uguali** e **sulla stessa pagina KB** (o dalla dashboard "Demo ask request", che non richiede
l'estensione). Il metodo di stima è **costante** (`Math.ceil(len/4)`, `router.ts`), quindi il
**delta** before/after è valido anche se i valori assoluti sono euristici.

> **CAVEAT stima vs reale.** `estimated_*_tokens` sono euristici (`~len/4`, output fisso 500 =
> `ASSUMED_OUTPUT_TOKENS`); non sono i token del tokenizer. Da questa passa il provider reale
> (Anthropic) legge `message.usage` e popola `actual_input_tokens`/`actual_output_tokens`
> accanto alle stime (il mock li lascia `NULL`): con `AI_PROVIDER=anthropic` la tabella sotto
> si compila con i **token esatti**, altrimenti con le sole stime.

### Tabella before/after

_Da compilare con l'export di `GET /requests` dell'ambiente autenticato dell'utente. "Before" =
prima delle leve E; "After" = dopo. Un blocco per query, filtrando per finestra temporale._

| Query | Fase   | Modalità | # pagine | # link | tok in (stima) | tok in (reale) | tok out | modello | costo $ | durata ms |
| ----- | ------ | -------- | -------- | ------ | -------------- | -------------- | ------- | ------- | ------- | --------- |
|       | before | single   |          |        |                |                |         |         |         |           |
|       | after  | single   |          |        |                |                |         |         |         |           |
|       | after  | follow   |          |        |                |                |         |         |         |           |

**Delta atteso** (ipotesi da verificare coi numeri veri): da **~16-31k token/articolo** (corpo
intero, cfr. Passa 9) verso **~4,5k** (retrieval per-heading, Passa 10 · E2), con **routing
verso modelli più economici** (meno contesto → più `haiku`/`sonnet` invece di `opus`).

**Conclusioni (→ soglie router `SIMPLE_/MODERATE_*`, `max_request_*`, trimming link-map):** _...
(da scrivere quando la tabella è piena: quale modello viene scelto in pratica, dove tagliare le
soglie `SIMPLE_MAX_CONTEXT_CHARS` / `MODERATE_MAX_CONTEXT_CHARS`, se ridurre `max_request_links`.)_

---

## Passa 8 — Enumerazione (deep scan, Fase A)

Obiettivo: inventario URL quasi-completo + tassonomia topic↔articolo, senza aprire ogni articolo.
Esegui in ordine, in inglese (`?language=en_US`), profilo autenticato:

1. **`docs/recon-kb-sitemap.js`** — su una pagina `…/Runway/s/`: cerca robots/sitemap. Scarica
   `rs-sitemap-inventory.json`. (Prima, a mano: apri `…/robots.txt` e `…/Runway/s/sitemap.xml`
   e dimmi se sono XML o pagina/redirect.)
2. **`docs/recon-kb-topics.js`** — parti dalla **home** `/Runway/s/`, poi apri ogni pagina
   **topic** e ri-eseguilo (scrolla/"load more" da solo). Scarica un `rs-topic-<id>.json` per
   topic; segui i `childTopics` non ancora visitati.
3. **`docs/recon-kb-search.js`** — cerca a mano alcuni termini **inglesi** ampi (`booking`,
   `refund`, `schedule`, `baggage`…) e, sulla pagina risultati, eseguilo. Annota `resultTotal`.
4. **`docs/recon-kb-merge.js`** — su una pagina qualsiasi: seleziona TUTTI i JSON scaricati →
   `rs-kb-inventory.jsonl` + `rs-kb-summary.json`. Reincollami il summary.

**Sitemap: TROVATA** ✅ — `…/Runway/s/sitemap.xml` è un `<sitemapindex>` con 7 figli:
`sitemap-topicarticle-1..4.xml` + `-weekly.xml` (URL articoli), `sitemap-topic-1.xml` (topic),
`sitemap-view-1.xml`. `robots.txt` = `Allow: /` (nessun blocco). → enumerazione quasi completa e
gratuita via sitemap; lo sweep manuale dei topic serve solo per il mapping topic→articolo se la
sitemap non lo codifica. (`recon-kb-sitemap.js` segue l'index e scarica tutti i figli.)

**Conteggi (da `rs-sitemap-inventory.json`, eseguito 2026-07-17):** `totalUrls` = **3.102** →
**article 2.964**, **topic 135**, home 1, other 2 (`contactsupport`, `topiccatalog`). Le varianti
di lingua (`?language=de/es/fr/it/ja/ko/pt_BR/zh_CN`) collassano sullo stesso `linkIdentity`
(dedup già a 2.964). robots = `Allow:/`. → **coverage confidence: ALTA** (sitemap ufficiale,
completa, non guest-only vista la sessione autenticata). Cross-check ricerca/topic-sweep NON
necessario: enumerazione considerata completa.

**Tassonomia (135 topic da `sitemap-topic-1.xml`):** ID Salesforce + slug noti. Categorie
principali osservate: prodotti (`flight`, `lodging`, `car`, `package`, `cruise`, `insurance`,
`activity`), azioni (`book`, `change`, `cancel`, `refund`, `billing`, `authorization`, `taxes`,
`relocation`, `escalate`, `compensation`), brand/partner (`amex`, `rbc`, `mastercard`, `chase`,
`bilt`, `sofi`, `cibc`, `scene`, `td-bank`, `expedia`, `hotelscom`, `vrbo`, `wotif`, `orbitz`,
`cheaptickets`, `ebookers`, `travelocity`, `walmart`), ruoli/canali (`frontline-voice`,
`frontline-chat`, `tier-2`, `offline`, `social-media`, `eps`, `taap`), aree (`us`, `ca`, `emea`,
`apac`, `latam`), lingua (`english`, `nonenglish`). **La sitemap NON lega articolo→topic** (i
record hanno solo `sources`): il legame si ricostruisce in Fase C (Suggested/headings/topic-page).

**Conclusioni (→ indice KB + vocabolario scoring):** l'inventario URL è pronto come base
dell'indice KB (Fase D). La tassonomia dei 135 topic (slug) è già un ottimo **vocabolario di
dominio** per rimpiazzare `INTENT_ALIASES` e-commerce (Fase E1) — è aviazione/travel, non generico.
Resta da raccogliere per-articolo: `title` (la sitemap non lo dà), `topics[]`, `sizeChars`,
`headings[]` → Fase B/C.

## Passa 9 — Cattura API Aura (deep scan, Fase B) — **DECISIONE: GO** ✅

Verificato 2026-07-17 (cattura Network + probe in console, profilo autenticato).

**Endpoint:** `POST /Runway/s/sfsites/aura` (form-urlencoded).
**Action che porta il corpo:** `serviceComponent://ui.force.components.controllers.recordGlobalValueProvider.RecordGvpController/ACTION$getRecord` (descriptor **nominato e stabile**, non hash).
**Param:** `recordDescriptor = "<recordId>.undefined.FULL.null.null.<campi>.VIEW.true.null.null.null"`.
La lista `<campi>` va **richiesta esplicitamente**: con solo `Summary` il `returnValue` è `null`;
aggiungendo `Details__c,Summary,Title,UrlName` la risposta contiene il record pieno.

**Modello dati KB:** 1 articolo = 1 record **`Article__kav`** (keyPrefix `ka0`, nameField `Title`).
Campi utili: **`Title`**, **`UrlName`** (= lo slug degli URL sitemap), **`Summary`**,
**`Details__c`** (= **corpo HTML completo**, in `fields.Details__c.value`), `CreatedDate`,
`CurrencyIsoCode`, `LastModifiedDate`, `Legacy_Id__c`.

**Auth/token:** l'auth passa dal **cookie di sessione** — `aura.token` è `null` ed è normale
su Experience Cloud pubblico. La probe ha funzionato con `aura.token:'null'` e `fwuid`
hard-coded (`OUcwT3JDYUZld21JQ2ZOckR1VnppUWtVMjdnTGFERUU2S3FfSVdrcU92bkExNC4xOTIuODM4ODYwOA`) —
niente token live da leggere. `$A` presente ma `getContext().fwuid` non esposto direttamente
(irrilevante: il `fwuid` sta nel body della cattura).

**Prova (WestJet `ka0Vs0000019bEHIAY`):** una singola POST → `status 200`, **139.340 byte**,
`state:SUCCESS`, `fields.Details__c.value` = `"<p><strong>Update history</strong></p>\n<table…"`
→ corpo API ≥ corpo DOM. Tutti i criteri GO soddisfatti.

**Conseguenze:** i 2.964 corpi si tirano via **una sola action `getRecord`** (veloce,
strutturato, niente rumore DOM). La **ricerca** resta SPA (come da piano → ibrido).

**Percorso di estrazione (VERIFICATO 2026-07-17 — era il pezzo che mi mancava):** il record
**NON** sta in `action.returnValue` (è `null`!). Sta nei **`globalValueProviders`** della
risposta:

```
resp.context.globalValueProviders[type="$Record"].values.records[<recordId>]
    .Article__kav.record.fields
```

`fields` contiene: `Title`, `UrlName` (=slug), `Summary`, **`Details__c.value` (=corpo HTML)**,
`Legacy_Id__c`, `LastModifiedDate`, `CreatedDate`, `Id`, `RecordTypeId`, `SystemModstamp`,
`CurrencyIsoCode`, `LastModifiedBy(Id)`. Prova su `ka0Vs0000019bEHIAY`: `Details__c.value` =
**125.973 caratteri** (~31k token per UN articolo → conferma che i corpi sono ancora più grandi
del previsto; la leva "retrieval per-heading" della Fase E2 è ancora più importante).

**slug→recordId (RISOLTO parzialmente):** la sitemap dà lo slug, `getRecord` vuole il `ka0…`.
Vie **scartate** (tutte `ran:0` / non registrate): action Aura "by UrlName"
(KnowledgeArticle*Controller, ArticleController…), `$A.get('c.…')` di server-controller,
Knowledge REST `/services/data/vXX/support/knowledgeArticles/<slug>` (→ **401 INVALID_SESSION_ID**,
serve Bearer OAuth che il cookie community non dà), `RecordUiController.getListsByObjectName`
(→ `INCOMPLETE`), sniffer `fetch`/XHR installato tardi (Aura cattura il transport al boot →
0 catture in isolated/late world). Via **che FUNZIONA:** il **LDS store** (`$A.storageService`)
contiene i `ka0` degli articoli **caricati** dalla SPA (probe: 21 ka0 letti dalla cache). →
strategia pull: **navigare l'articolo (SPA) → leggere il `ka0` da LDS → `getRecord` per il corpo**.
Nessun mapping slug→recordId offline in blocco disponibile: serve un **crawler SPA** (Fase C).

## Passa 10 — Ottimizzazione sidebar (Fase E) — **IMPLEMENTATA** ✅

Decisione a monte: **on-demand, zero crawl** — il corpo si legge dal **DOM già
renderizzato** (dove la sidebar è presente), non via API/crawler. L'API Aura (Passa 9) è servita
solo come ricognizione (struttura dati, dimensioni reali). Le 4 leve, tutte con test, verdi
`compile|lint|test|build`:

- **E0 — `lib/text.ts`** (nuovo): util testo condivise (`normalize`, `STOP_WORDS`, `wordsOf`,
  `matchedKeywords`, `countKeywords`, `unique`). `extract.ts` e `crawl.ts` deduplicati.
- **E2 — retrieval per-heading** (`lib/extract.ts`, `queryFocusedText`): `sectionsByHeading`
  segmenta l'articolo in sezioni intestazione→corpo; selezione a due stadi (sezione per
  heading+lead, poi blocchi pertinenti dentro la sezione). Fallback per-blocco su pagine piatte.
  **Leva #1 token:** da ~31k a ~4,5k per articolo, coeso. Server `max_page_text_chars` (6.000)
  ≥ budget focalizzato (4.500): nessun ritaglio.
- **E1 — vocabolario di dominio** (`lib/kb-vocab.ts`, nuovo): `INTENT_ALIASES` derivato dai 135
  topic KB (refund/cancel/change/flight/baggage/lodging/billing…) al posto dell'e-commerce.
- **E3 — cross-lingua IT→EN** (`expandQueryTerms`): per ogni concetto colpito dalla query (anche
  via alias IT) inietta i termini EN; applicato a retrieval per-heading **e** scorer link. Risolve
  "cercando in italiano non funziona".
- **E4 — indice KB leggero** (`lib/kb-index.ts` + asset `lib/kb-index.json`, generato da
  `docs/build-kb-index.mjs` dalla sitemap): `pickCandidatesWithKbIndex` unisce i link del DOM con
  l'intero indice e li scora insieme → l'articolo giusto emerge anche se non linkato nella pagina,
  **costo-token zero**. Dedup per identità. Innestato in `App.run` (follow); il tour resta sui
  link di pagina (deve cliccarli). _Asset popolato con i 2.964 articoli reali (sitemap 2026-07-17),
  URL normalizzati a `?language=en_US` (lingua di retrieval). Rigenerabile da
  `rs-sitemap-inventory.json` via `docs/build-kb-index.mjs`._

**Manopole backend (E4-token) NON ancora ri-tarate:** `router.ts` (`SIMPLE_/MODERATE_*`, oggi
tarate su Wikipedia), link-map in `provider/shared.ts`. Da fare dopo la **baseline token** reale
(Passa 7) per un before/after quantificato.

## Passa 11 — Capacità di navigazione (cosa la sidebar sa muoversi/leggere)

Mappa precisa di **come la sidebar si muove nella KB e legge le pagine**, con i limiti verificati
`file:riga`. Serve perché l'esplorazione ha confermato un limite forte: la sidebar **non può
leggere nessuno dei ~2.964 articoli dell'indice se non sono già raggiungibili come pagina
renderizzata** — e da questa passa il caso "solo-indice" è parzialmente sbloccato (vedi GAP → B2).

### Matrice WHAT / LIMITS / GAPS

| Capacità                               | WHAT (cosa fa)                                                                                                         | LIMITS (dove si ferma)                                                                                                      | file:riga                                                         |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Lettura pagina corrente                | Legge il DOM **renderizzato** del content-root, retrieval per-heading focalizzato sulla query.                         | Solo la pagina in cui la sidebar è montata; nessuna navigazione.                                                            | `extract.ts:233`, `extract.ts:276`, `App.tsx:334`                 |
| Fetch `follow`                         | `fetch(url, credentials:'include')` same-origin, estrae il testo dei link scelti.                                      | **Morto sulla KB Aura**: `hasRenderedContent`→false sullo shell → pagina scartata. Vivo solo su siti server-rendered.       | `crawl.ts:186`, `crawl.ts:195`, `extract.ts:228`                  |
| Tour SPA `visual`                      | Hub-and-spoke: clicca l'anchor → `waitForSpaRender` → legge il DOM → `history.back()` all'hub.                         | **Richiede un anchor vivo in pagina**; se il link non c'è (o rect 0×0) il target è **saltato**.                             | `useTourDriver.ts:107`, `highlight.ts:15`, `useTourDriver.ts:122` |
| Link discovery (DOM)                   | `extractInternalLinks` raccoglie i link same-origin del content-root, dedup per identità.                              | Vede **solo** i link presenti nel DOM della pagina corrente.                                                                | `extract.ts:247`                                                  |
| Candidati KB-wide (E4)                 | `pickCandidatesWithKbIndex` unisce i link del DOM con l'intero indice KB e li scora insieme, costo-token 0.            | Propone l'URL giusto ma **non ne legge il corpo** se non è fetchabile/navigabile.                                           | `crawl.ts:162`, `kb-index.ts:40`                                  |
| Attesa render (SPA)                    | `waitForSpaRender`: attende route arrivata + testo stabile (non tempo fisso), timeout 9s.                              | Se il render non arriva entro 9s → false (degrada).                                                                         | `spa-nav.ts:46`                                                   |
| Navigazione finale (tour)              | Click sull'anchor se sull'hub (client-side); altrimenti `location.href` + rehydration.                                 | Solo verso la fonte scelta a fine tour; non è navigazione libera.                                                           | `useTourDriver.ts:201`, `tour.ts:152`                             |
| **Apertura articolo solo-indice (B2)** | `openAndReadArticle`: naviga client-side **senza anchor** (anchor sintetico → pushState), legge il DOM, torna all'hub. | Additivo alla modalità **follow**; degrada a suggerimento se il render non arriva. No full-reload (perderebbe la sessione). | `nav.ts:91`, `nav.ts:38`, `App.tsx:343`                           |

### GAP trasversali (stato dopo B2)

1. **Articolo non-anchor** — prima: non leggibile se non anchor vivo in pagina. **Ora (B2):** i
   candidati **solo-indice** in modalità `follow` sono aperti via SPA e letti (`openAndReadArticle`).
   Resta scoperto: un candidato che è anchor in pagina ma non renderizza via fetch nel `follow`
   (lo copre il tour `visual`, che lo clicca).
2. **`fetch`/`follow` morto** sulla KB client-rendered → `single`/`visual`/`follow+SPA` sono le
   uniche letture reali del corpo.
3. **Niente pilotaggio della barra di ricerca KB** (opzione scartata a monte): la scoperta degli
   articoli passa dall'indice E4, non dalla ricerca in-app.
4. **Niente multi-hop / crawl ricorsivo**: si legge un livello di candidati, non i loro link.
5. **Cap fisso `MAX_FOLLOW = 3`** (`crawl.ts:14`): al più 3 pagine seguite per richiesta (fetch +
   SPA insieme rispettano lo stesso tetto).
