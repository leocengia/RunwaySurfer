# MAPPA-KB — Rilevazioni sulla KB Salesforce

> Documento di lavoro: qui raccogliamo i risultati dei recon per tarare, nella fase
> successiva, `lib/site-profile.ts`, `lib/extract.ts`, `lib/crawl.ts`, `lib/spa-nav.ts` e i
> settings backend. Compila incollando i JSON prodotti dagli script e scrivendo le
> conclusioni. Piano di riferimento: il piano "Mappatura della KB Salesforce".

## Procedura passo-passo

### Prerequisiti (una volta sola)

1. Apri Chrome con il **profilo loggato alla KB** (quello che ha accesso a
   `traveler.my.site.com`). Verifica di vedere gli articoli senza schermata di login.
2. Apri gli script che ti servono dal repo: `docs/recon-kb-map.js` e
   `docs/recon-kb-search.js`. Servono i **contenuti** dei file (li incollerai in console).
3. Su un articolo, apri **DevTools**: `F12` (o `Ctrl+Shift+I`) → scheda **Console**.
4. La prima volta, se compare l'avviso _"Don't paste code you don't understand"_, digita
   `allow pasting` e premi Invio (poi non lo richiede più per quella sessione).
5. Lavora in italiano: assicurati che l'URL abbia `?language=it`. Se noti differenze di
   contenuto con `en_US`, annotalo nelle conclusioni.

### Step 1 — Passe 0-4 su un articolo (recon-map)

1. Vai su una **pagina-articolo** rappresentativa (URL tipo `/Runway/s/article/...` o
   `/Runway/s/detail/...`). Meglio se ha **link ad altri articoli nel corpo** (per la Passa 4).
2. Nella Console: incolla **tutto** il contenuto di `docs/recon-kb-map.js` e premi Invio.
3. ⚠️ Lo script è **asincrono e NAVIGA**: per la Passa 4 clicca ~3 link e torna indietro da
   solo (~10-15s). **Non toccare la pagina** finché non stampa il blocco verde `RS-MAP`.
4. Se preferisci NON far navigare la pagina, prima di incollare digita in console:
   `window.RS_MAP_SPA = false` (poi incolla lo script). Perdi la Passa 4 ma non naviga.
5. A fine esecuzione l'output è stampato **e copiato in clipboard**. Incollamelo in chat
   (o nel file `recon-results.md` che hai aperto). Dimmi anche di che tipo era la pagina.
6. Se la copia in clipboard non è disponibile, seleziona il JSON sotto `RS-MAP` e copialo a
   mano.

### Step 2 — Ripeti su più pagine (campionamento ampio)

Ri-esegui lo Step 1 (stesso script) su:

- **≥5 articoli di tipo diverso** (procedura, policy, FAQ, refund/billing, lodging… quelli
  che gli agenti aprono davvero);
- **1 pagina topic** (`/Runway/s/topic/...`);
- **1 pagina categoria** (se esiste).

Mandami i JSON separati (basta indicare a quale pagina si riferisce ciascuno). Su topic e
categoria la Passa 4 si salta da sola (non sono articoli navigabili): è normale.

### Step 3 — Passa 5: la ricerca (recon-search)

Modo consigliato (più affidabile):

1. Digita una parola nella **barra di ricerca** della KB (es. `rimborso`) e lancia la ricerca
   a mano; aspetta che compaiano i **risultati** (URL tipo `/Runway/s/global-search/...`).
2. Nella Console incolla **tutto** `docs/recon-kb-search.js` e premi Invio.
3. Aspetta il blocco verde `RS-SEARCH` e incollami il JSON.

Modo automatico (se il primo non ti è comodo): su una pagina qualsiasi con la barra di
ricerca, prima digita `window.RS_SEARCH_Q = 'rimborso'`, poi incolla lo script: proverà a
compilare e inviare la ricerca da solo. Se `reachedResults` risulta `false`, usa il modo
consigliato.

### Step 4 — Passa 6: tassonomia e domande frequenti (input tuo, non recon)

Mandami, anche in testo libero:

- i **topic/categorie principali** della KB (la struttura ad albero, se c'è);
- **10-15 domande/richieste reali** che gli agenti fanno (es. "il cliente vuole annullare una
  prenotazione hotel", "come emetto un rimborso CFAR"…). Servono a rifare lo scoring dei link
  sul dominio vero al posto di quello e-commerce.

### Step 5 — Passa 7: baseline token (cattura AUTOMATICA, niente trascrizioni)

I numeri non vanno più ricopiati a mano dalla sidebar: **ogni `/ask` è già persistito** nella
tabella `requests` (token stimati, modello, costo, pagine, durata) — vedi Passa 7 sotto per il
dettaglio. Ti basta:

1. Lanciare un **set fisso di 3-5 query reali** (le stesse prima e dopo le leve E), in EN e IT.
   Due strade:
   - **Dashboard, senza estensione:** apri la dashboard backend → **"Demo ask request"**
     (`dashboard.ts`) e lancia le query. Zero build, zero caricamento estensione.
   - **Sidebar (per confrontare le modalità):** `npm run build`, poi `chrome://extensions` →
     **Modalità sviluppatore** → **Carica estensione non pacchettizzata** → `.output/chrome-mv3`;
     lancia le query in **single** e (se gira) in **follow**/**tour**.
2. Esportare i record: `GET /requests?limit=N` + `GET /analytics/summary`, oppure leggere
   `server/data/runwaysurfer.db`. Mandami l'export (o il `.db`): compilo io la tabella Passa 7.
3. Il **delta** before/after di questi numeri è la baseline per ri-tarare le soglie del router.
   Con il provider reale i **token esatti** (`actual_*_tokens`, vedi Passa 7) affiancano le stime.

### Cosa faccio io

Man mano che mi reincolli i dati, compilo le sezioni qui sotto e traduco ogni rilevazione in
valori concreti per le manopole (content-root, rumore, caps, timing SPA, scoring, soglie
backend). Quando la mappa è piena, pianifichiamo la fase di ottimizzazione sui numeri reali.

---

## Decisione lingua (emersa dal recon)

Il **contenuto degli articoli è in inglese** (`lang=en-US`) e la **ricerca della KB non funziona
con query in italiano**. Decisione: **retrieval/ricerca in inglese** (dove stanno i dati e dove la
ricerca funziona) + **UI sidebar in italiano** + **risposta generata in italiano** (il backend già
produce sezioni IT). Conseguenza: lo scoring locale per keyword è debole cross-lingua → appoggiarsi
a ricerca KB / Suggested Articles più che al matching di parole; eventualmente tradurre la query
IT→EN prima della ricerca (raffinamento futuro).

## Passa 0 — Tassonomia URL / tipi di pagina

_Incolla il campo `pageType`/`pathname`/`params` da ogni run + una riga di sintesi._

| Tipo     | Esempio pathname              | Contenuto o lista? | Param rilevanti |
| -------- | ----------------------------- | ------------------ | --------------- |
| article  | `/Runway/s/article/<slug>`    | contenuto          | `language`      |
| detail   | `/Runway/s/detail/<id>`       | contenuto          | `language`      |
| topic    | `/Runway/s/topic/<id>/<slug>` | lista              |                 |
| category |                               |                    |                 |
| search   | `/Runway/s/global-search/<q>` | lista              | `language`      |
| home     | `/Runway/s/`                  | —                  |                 |

**Conclusioni (→ `rejectPathIncludes`, `linkIdentity`, `keepParams`):** _..._

## Passa 1 — Content-root & rumore (per tipo pagina)

_Incolla `contentRoot` e `noiseCandidates` di 2-3 articoli._

```json
(incolla qui)
```

**Selettore corpo articolo scelto (→ `contentSelectors` / probe `waitForSpaRender`) — PRELIMINARE (1 articolo):**
`[role="main"]` = `div.body.isPageWidthFixed-true` (27.8k char, tutto incluso). Il corpo vero è
la colonna **8-of-12** (`div.slds-col--padded.slds-size--12-of-12.slds-medium-size--8-of-12`, ~26k).
Le classi SLDS sono generiche → più robusto tenere `[role="main"]` e rimuovere il rumore (sotto).

**Selettori di rumore da aggiungere (→ `noiseSelectors`) — PRELIMINARE:**
`.comm-content-header` (metadati: Preferred Language/Record Type/Article Number/Legacy Id/Publication
Status), `.comm-content-footer` (Report a Problem/feedback), `header.forceHighlightsPanel` +
`.forceCommunityRecordHeadline` + `.slds-page-header_record-home` (record headline), e — per
l'estrazione del TESTO — la colonna `.slds-medium-size--4-of-12` (Suggested Articles, utile come
LINK ma non come testo). Da confermare su più articoli.

## Passa 2 — Qualità estrazione (≥5 articoli)

_Incolla `extractionSample` per ciascun articolo._

| Articolo | bodyChars | roleMainChars | metadataLeaks | note |
| -------- | --------- | ------------- | ------------- | ---- |
|          |           |               |               |      |

**Conclusioni (→ `MAX_PAGE_CHARS`/`FOCUSED_PAGE_CHARS`, block selector/count, char-cap):** _..._

## Passa 3 — Sorgenti dei "collegati"

_Incolla `collegati` per ciascun articolo._

| Articolo | # link articolo | # nel corpo | sezione "Correlati"? | container tipico |
| -------- | --------------- | ----------- | -------------------- | ---------------- |
|          |                 |             |                      |                  |

**Conclusioni (→ `extractInternalLinks` max, pesi scoring, `MAX_FOLLOW`; serve la ricerca?) — PRELIMINARE:**
I "collegati" NON sono cross-link nel corpo (0 in 2 articoli), ma un pannello **"Suggested Articles"**
(colonna 4-of-12) con le raccomandazioni della KB. I suoi link non sono `<a href>` classici catturati
dallo scan generico (sonda `suggestedArticles` in verifica). → due sorgenti reali di collegati:
**Suggested Articles** + **ricerca KB**. Lo scoring per-keyword locale conta poco (query IT vs
contenuto EN). Serve la ricerca (Passa 5) e/o leggere i Suggested.

## Passa 4 — Profilo navigazione SPA

_Incolla `spaNav` da alcuni articoli (più campioni = distribuzione migliore)._

| Articolo | render min/med/max (ms) | allBackOk | anyFullReload | bodyMargin prima→dopo |
| -------- | ----------------------- | --------- | ------------- | --------------------- |
|          |                         |           |               |                       |

**Conclusioni (→ timing `waitForSpaRender`, robustezza driver/margine body):** _..._

## Passa 5 — Ricerca `/s/global-search`

_Incolla l'output di `recon-kb-search.js`._

```json
(incolla qui)
```

- URL risultati (pattern): _..._
- Selettore item risultato / container lista: _..._
- Forma URL dei risultati (article/detail): _..._
- Ordine/ranking, snippet presenti?: _..._

**Conclusioni (→ modalità search-driven, `linkIdentity` per URL-risultato):** _..._

## Passa 6 — Tassonomia & vocabolario di dominio (per lo scoring)

_Da compilare con input dell'utente (non da recon)._

- **Topic/categorie principali della KB:** _..._
- **Domande/intenti frequenti degli agenti** (esempi reali): _..._
- **Termini/etichette ricorrenti** (per `INTENT_ALIASES`) e **parole generiche da penalizzare**
  (per `GENERIC_LINK_WORDS`): _..._

**Conclusioni (→ sostituire `INTENT_ALIASES`/`GENERIC_LINK_WORDS`, allineare `STOP_WORDS`):** _..._

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
  link di pagina (deve cliccarli). _NB: l'asset è placeholder finché non lo si popola col
  `rs-sitemap-inventory.json` reale._

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
