# MAPPA-KB — Rilevazioni sulla KB Salesforce

> Documento di lavoro: qui raccogliamo i risultati dei recon per tarare, nella fase
> successiva, `lib/site-profile.ts`, `lib/extract.ts`, `lib/crawl.ts`, `lib/spa-nav.ts` e i
> settings backend. Compila incollando i JSON prodotti dagli script e scrivendo le
> conclusioni. Piano di riferimento: il piano "Mappatura della KB Salesforce".

## Come raccogliere i dati

Script (Console DevTools, profilo autenticato):

- **`docs/recon-kb-map.js`** — Passe 0-4. Eseguilo su **≥5 articoli di tipo diverso**, su
  **1 pagina topic**, su **1 pagina categoria**. (Naviga per la Passa 4: aspetta che finisca.)
  Per saltare la navigazione: `window.RS_MAP_SPA = false` prima di incollare.
- **`docs/recon-kb-search.js`** — Passa 5. Preferibile: lancia una ricerca a mano, poi
  eseguilo sulla pagina risultati. In alternativa `window.RS_SEARCH_Q = 'rimborso'` e lascialo
  provare da solo.

Lingua: esegui in `?language=it`; se noti differenze rilevanti col contenuto `en_US`, annotalo.

---

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

**Selettore corpo articolo scelto (→ `contentSelectors` / probe `waitForSpaRender`):** _..._
**Selettori di rumore da aggiungere (→ `noiseSelectors`):** _..._

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

**Conclusioni (→ `extractInternalLinks` max, pesi scoring, `MAX_FOLLOW`; serve la ricerca?):** _..._

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

## Sintesi finale (input per la fase di ottimizzazione)

_Una volta compilate le passe, riassumi qui i valori decisi per ciascuna manopola._

- Sidebar: content-root=_..._, noise=_..._, rejectPathIncludes(SF)=_..._, caps=_..._,
  spa-nav timing=_..._, scoring/vocabolario=_..._, search-driven sì/no=_..._
- Backend: soglie router=_..._, max_request_pages/links/text=_..._, link-map ridotto=_..._
