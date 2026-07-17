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

### Step 5 — Passa 7: baseline token (richiede l'estensione caricata)

1. Builda e carica l'estensione nel profilo KB: `npm run build`, poi `chrome://extensions` →
   **Modalità sviluppatore** → **Carica estensione non pacchettizzata** → cartella
   `.output/chrome-mv3`.
2. Su 3-5 **query reali**, esegui una richiesta in **single-page** e (se il tour gira) in
   **tour**; dal pannello sidebar, sotto la risposta, leggi la riga **AiPlan** e mandami:
   stima **input token**, **modello** scelto, **costo $**, **n. pagine** e **n. link**.
3. Questi numeri sono la _baseline_ per misurare il risparmio dopo l'ottimizzazione.

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

_Dal pannello sidebar (AiPlan) su 3-5 query reali, prima di ottimizzare._

| Query | Modalità | # pagine | # link | est. input tok | modello | costo $ |
| ----- | -------- | -------- | ------ | -------------- | ------- | ------- |
|       | single   |          |        |                |         |         |
|       | tour SPA |          |        |                |         |         |

**Conclusioni (→ soglie router `SIMPLE_/MODERATE_*`, `max_request_*`, trimming link-map):** _..._

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

## Sintesi finale (input per la fase di ottimizzazione)

_Una volta compilate le passe, riassumi qui i valori decisi per ciascuna manopola._

- Sidebar: content-root=_..._, noise=_..._, rejectPathIncludes(SF)=_..._, caps=_..._,
  spa-nav timing=_..._, scoring/vocabolario=_..._, search-driven sì/no=_..._
- Backend: soglie router=_..._, max_request_pages/links/text=_..._, link-map ridotto=_..._
