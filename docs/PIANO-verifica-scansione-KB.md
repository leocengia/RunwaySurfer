# PIANO — Verifiche e scansioni efficaci del vero sito KB

> Runbook operativo. Le **Parti 0-2** le esegui **tu** nel browser autenticato alla KB
> (`traveler.my.site.com/Runway`); reincolli i JSON/fixture prodotti. La **Parte 3** (modifiche al
> codice) è gated sui dati raccolti. Strumenti: `docs/recon-kb-verify.js` (probe) e
> `docs/recon-kb-analyze.mjs` (analizzatore). Piano di riferimento per il codice: A2 (token reali),
> B2 (`openAndReadArticle`), Fase E (leve token). Vedi anche `docs/MAPPA-KB.md`.

## Perché serve (le tre faglie)

1. **MAIN world vs ISOLATED world.** Tutto ciò che Passa 9 ha verificato (`$A`, `getRecord`, LDS) era
   in **console = MAIN world**. Il content-script MV3 è **ISOLATED**: condivide il DOM ma **non vede
   `window.$A`**. Ogni meccanismo B2 basato su `$A` richiede un bridge `world:'MAIN'`; gli eventi DOM
   attraversano i mondi. **Ogni check è etichettato col mondo** in cui è raggiungibile dall'estensione.
2. **Intercettazione click di Aura.** Experience Cloud delega il routing su un root community
   (`.forceCommunityApp`/`.siteforceContentArea`), non su `document`. `clickSyntheticAnchor`
   (`lib/nav.ts:38`) appende l'`<a>` a `document.body` → potrebbe **non essere intercettato → full
   reload che uccide il content-script**. Incognita #1 di B2.
3. **`waitForSpaRender` legge il testo vecchio.** `lib/spa-nav.ts` non confronta col testo pre-nav: se
   Aura cambia URL prima di sostituire `[role="main"]`, ritorna `true` sull'hub vecchio → si manda
   all'AI la pagina sbagliata (bug latente).

Rischi noti: `sectionsByHeading` (`extract.ts:116`) itera i figli diretti del root ma il corpo
`Details__c` è annidato → E2 forse **sempre disattiva** (verificabile offline con fixture);
`hasRenderedContent` testa selettori generici presenti nello shell → manda shell vuoto all'AI;
"collegati" forse Suggested-Articles senza href; selettori/rumore/`rejectPathIncludes` tarati su 1
articolo o Wikipedia; nessuna guardia login-wall.

Fatto: `lib/kb-index.json` ha i 2.964 articoli reali (sitemap 2026-07-17); la normalizzazione lingua
en_US è applicata (offline).

---

## Parte 0 — Gate di autorizzazione e data-handling (PRIMA di toccare la KB)

- **Sezione 0 di `docs/MAPPA-KB.md`** compilata: approvatore nominato + data; account SSO titolato a
  vedere tutti gli articoli; export corpi/HAR verso l'autore permesso da policy/DPA; set classificati
  (PCI/PII/legal-hold) da escludere.
- **Profilo dedicato / account di test** per le passe pesanti (non la sessione di un agente vero).
  Check login-wall dopo ogni passa; se la sessione si rompe, stop e re-auth.
- **Do-NOT-capture**: mai cookie di sessione, valori `aura.token`/`fwuid`, header `Authorization`/
  Bearer, identità/username/email agente, PII cliente, HAR non scrubbato, `query_preview` del `.db`
  con testo cliente (scrubba/aggrega).
- **Minimizzazione**: enumerazione = solo metadati URL, zero corpi; taratura selettori su campione
  (≥5 articoli), non sui 2.964 corpi, se non autorizzato in Sezione 0.

---

## Parte 1 — Tooling

### 1a. Prelude di sicurezza (nei recon script)

- `rsScrub(obj)` + `rsVerifyClean(json)`: scrub deterministico su ogni oggetto prima di `copy()`/
  download; `rsVerifyClean` ri-scansiona e **rifiuta il download** (`RS-SCRUB-FAIL`) se resta un match
  (session id `00D[A-Za-z0-9]{12,}!`, `fwuid`, email, telefoni, PAN Luhn, PNR, header sensibili).
  Stampa un report di redazione (conteggi, non valori).
- **Rate-limit** nei loop fetch: `RS_DELAY_MS` ≥500ms jitterato, concorrenza 1-2, `RS_MAX_REQUESTS`
  (default piccolo → pull corpi batchato/ripartibile). ≤2 req/s.
- **Backpressure/abort**: su `429`/`503` leggi `Retry-After` e abortisci; su `401`/`403` mid-run
  abortisci; sniff WAF/challenge (`Incapsula`/`Imperva`/reCAPTCHA). Emetti `RS-ABORT`.

### 1b. Probe `docs/recon-kb-verify.js`

Gira in **console (MAIN world)**; ogni check riporta il suo `world` (`either` = raggiungibile anche
dall'isolated dell'estensione, `main-only` = serve un bridge). `RS_VERIFY_NAV` default false.
Preflight per PRIMO (una riga PASS/FAIL). Schema versionato **`rs-verify/1`**.

Check: (1) origin/redirect, (2) selettori contenuto match-count+vincitore, (3) rumore + delta testo,
(4) login-wall/not-found, (5) fetch shell-vs-content per-selettore + `res.redirected`, (6) timeline
render per regione + bug stale-text, (7) **matrice navigazione** decisiva e sopravvivibile (reload-guard
`preventDefault`, breadcrumb, esiti `intercepted-spa`/`full-reload`/`no-op`; meccanismi anchor@body /
anchor@root / MouseEvent / pushState / `$A` / iframe), (8) collegati anchor vs non-anchor, (9) iframe
nascosto, (10) `$A`+Locker/LWS, (11) fwuid via `encodeForServer()`, (12) LDS via IndexedDB, (13)
copertura LDS non-visitato, (14) readiness Aura (`aura:doneWaiting`/spinner), (15) getRecord replay +
tassonomia errori, (16) recordId per-lingua + en_US 404, (17) CSP `frame-ancestors`, (18) Suggested
virtualizzato. Dettaglio dei criteri PASS nell'analizzatore (`THRESHOLDS`).

### 1c. Analizzatore `docs/recon-kb-analyze.mjs` (Node zero-dep)

- `node docs/recon-kb-analyze.mjs run.json` → tabella verdetto (assunzione→check→PASS/FAIL→azione),
  valore vs soglia, `VERDICT: N/M PASS`. Soglie in `THRESHOLDS`.
- `node docs/recon-kb-analyze.mjs before.json after.json` → diff mode (verdetti cambiati, delta timing).
- Rifiuta input con `schema` ≠ `rs-verify/1`. Test in `tests/recon-analyze.test.ts`.

---

## Tabella centrale — assunzione → check → world → PASS → azione

| #   | Assunzione (file)                                   | Check        | World       | PASS                                                                 | Azione se fallisce                         |
| --- | --------------------------------------------------- | ------------ | ----------- | -------------------------------------------------------------------- | ------------------------------------------ |
| 1   | origin traveler (`wxt.config.ts:19`,`index.tsx:10`) | C1           | either      | origin match, redirect 0                                             | aggiorna `matches`/host_permissions        |
| 2   | `[role="main"]` = body (`site-profile.ts:25`)       | C2 (≥5)      | either      | selettore Salesforce-specifico vince ≥90%                            | riordina `contentSelectors`                |
| 3   | noiseSelectors giusti                               | C3, fixture  | either      | delta ≥15% e post-len ≥900; nessun selettore morto                   | allinea al set recon                       |
| 4   | fetch = shell (`extract.ts:228`)                    | C5           | either      | nessun selettore **testuale** nel raw                                | split marker vs root o min-len             |
| 5   | E2 per-heading vive (`extract.ts:116`)              | fixture      | either      | ≥2 heading figli-diretti su ≥70% art. lunghi                         | discendi nel body annidato                 |
| 6   | render<timeout, testo=finito (`spa-nav.ts`)         | C6           | either      | p95 ≤5s; nessun gap>stablePolls×pollMs; no persistenza vecchio testo | ritara + guard pre-nav text + gate spinner |
| 7   | anchor sintetico intercettato (`nav.ts:38`)         | C7           | either/main | un meccanismo=`intercepted-spa`                                      | matrice fallback B2                        |
| 8   | collegati = `<a href>` (`highlight.ts`)             | C8           | either      | Suggested sono anchor                                                | tour su link reali; documenta              |
| 9   | sessione valida                                     | C4,C5        | either      | non login/not-found                                                  | guardia in `extract.ts`/`App.tsx`          |
| 10  | `$A`/getRecord usabili                              | C10,C15      | main        | `$A` presente, getRecord SUCCESS                                     | bridge MAIN-world o via v2                 |
| 11  | slug→recordId senza nav                             | C12,C13      | either/main | ka0 in IndexedDB plaintext                                           | resta navigate-then-fetch                  |
| 12  | token E2/E4 (`extract.ts`,`router.ts`)              | baseline SQL | backend     | median actual_in ≤5k, −60% vs pre                                    | ritara soglie router                       |

---

## Parte 2 — Runbook in DUE sessioni (profilo dedicato)

**SESSIONE A — Raccolta (no estensione).** Sezione 0 compilata. Preflight; URL campione pre-scelti
dall'inventario sitemap (lungo/corto, sorgente en/non-en, `article` vs `detail`, con/senza correlati).
Probe **statico** su ≥5 art.+1 detail+1 topic; probe **dinamico** (`RS_VERIFY_NAV=true`) su 3-5;
checks MAIN-world (10-15). **Fixture offline** (scrubbate): `rs-fixture-article-<slug>.html`
(`outerHTML` post-render di 3-5 art.+topic+search+detail+**login page**), `rs-shell-<slug>.html` (raw
fetch), **1 HAR** di una nav SPA (per estrarre offline l'action slug→recordId). **Baseline token A**:
10 query fisse con `agent_id=kb-baseline-A`. (opz.) `recon-kb-sitemap.js` per freschezza.

**→ L'autore applica Parte 3.**

**SESSIONE B — Validazione (backend + estensione).** Fase 0 completa (`/health`, CORS dall'origin
traveler). **single/follow(B2)/tour** end-to-end. **Baseline token B** (`kb-baseline-B`) → confronto.
**Injection corpus** (7 payload: override, role-swap, exfil, format-break, fake-authority, link-borne,
homoglyph) con rubrica binaria, **eseguito su haiku**. Verifica parità di trust `[followed]` vs
`[current]`. **Edge case**: articolo lungo (budget ~4,5k?), variante en_US inesistente, detail vs
article, recupero anchor dopo `back()` (Suggested virtualizzato), sessione scaduta mid-nav (redirect
IdP → unload), finestra rehydration 15s vs boot a freddo, cap `max=40`.

### Query set fisso (baseline token)

10 query, IT+EN, ciascuna ancorata a un articolo di partenza; misura via:

```sql
SELECT agent_id, COUNT(*) n, AVG(actual_input_tokens) avg_in, MAX(actual_input_tokens) max_in,
  AVG(actual_output_tokens) avg_out, AVG(duration_ms) avg_ms,
  AVG(CAST(actual_input_tokens AS REAL)/NULLIF(estimated_input_tokens,0)) est_ratio
FROM requests WHERE agent_id LIKE 'kb-baseline-%' GROUP BY agent_id;
```

PASS E2/E4: median `actual_input_tokens` ≤5.000, ≥60% in meno vs pre-taratura; `est_ratio`∈[0.75,1.25];
`duration_ms` p95 non regredito >+20%.

---

## Parte 3 — Applicare i risultati (edit gated sui dati)

- **`lib/kb-index.json`**: `language=en_US` forzato su ogni `u` (offline — FATTO).
- **`lib/spa-nav.ts`**: ritara `timeoutMs`/`stablePolls`/`minChars` sui timeline; **guard stale-text**
  (`waitForSpaRender` riceve firma testo pre-nav, richiede `text!==preNavText`); gate spinner/`doneWaiting`.
- **`lib/nav.ts` — matrice fallback B2** (per esito C7/C9/C10): (1) anchor intercettato → tieni (append
  dentro il root community se serve; replica `history.state`); (2) anchor no, iframe sì → reimplementa
  `openAndReadArticle` su **iframe nascosto** (no nav tab, estrazione `contentDocument`) — fallback
  primario; (3) `$A` sì → **bridge MAIN-world** (`world:'MAIN'` + `postMessage` origin+nonce,
  `e.force:navigateToURL`, allowlist same-origin `/Runway/s/`, ritorna void, zero token/LDS rimandati);
  (4) tutto fallisce → suggerimento-only + via v2 `getRecord` (fwuid da `encodeForServer`, strip
  `while(1);`, retry `clientOutOfSync`, abort `invalidSession`).
- **`lib/extract.ts`**: `hasRenderedContent` per-selettore (split marker vs generici); **fix
  `sectionsByHeading`** (discendi nel `Details__c`/`.cuf-content`); **guardia login-wall/not-found**.
- **`lib/site-profile.ts`**: allinea `noiseSelectors`; aggiungi `rejectPathIncludes` `/s/topic/`,
  `/s/global-search/`, `/s/category/` (caveat: `extract.ts:212` è globale → toglie i topic anche dai
  link-suggerimento).
- **`server/src/provider/shared.ts`**: valuta wrapping `<kb_content>`; conferma parità trust origine.
- **Corpus regressione** (fixture → Vitest): `tests/fixtures/kb/` + `tests/extract.kb-fixtures.test.ts`
  con override `@vitest-environment-options`; golden: `hasRenderedContent` true/**false su shell**,
  `extractPageText` len∈[900,6003] con frasi note e zero chrome, focused ≤4503, `extractInternalLinks`
  golden, `findLinkElement`. `tests/fixtures-hygiene.test.ts` (blocca PII, `.html` senza `.meta.json`).
- **Drift monitoring**: persisti selettore matchato + `text.length` in `requests`; alert (>10% req/7g
  su selettore generico, o mediana char −30% wow). CI = corpus fixture; umano = `analyze.mjs` diff
  mensile vs `docs/baselines/rs-verify-YYYY-MM.json`.
- **`docs/MAPPA-KB.md`**: compila Passa 1-5; aggiorna Passa 9 (fwuid/LDS/getRecord) e Passa 11 (stato +
  world); nota placeholder già rimossa.

---

## Verifica di fine lavoro

1. Probe → `analyze.mjs` tabella tutta PASS; C7 verdetto secco (meccanismo + world); C10-15 dicono se
   `$A`/getRecord è raggiungibile dall'estensione.
2. Fixture offline: test provano `hasRenderedContent(shell)===false`, `focusedByHeading`≠null (E2 viva
   o fix), `findLinkElement` sul Suggested reale; hygiene verde.
3. Timing: Passa 4 piena; `waitForSpaRender` ritarato + guard stale-text.
4. End-to-end: follow apre un articolo solo-indice `?language=en_US` in "pagine lette".
5. Token: `est_ratio`∈[0.75,1.25], median actual_in ≤5k, −60% vs pre.
6. Sicurezza: `rsVerifyClean` 0 match; injection corpus PASS su haiku; backpressure ferma su 429.
7. `npm run compile|lint|test|build` verdi in root e `server/`.

## Input attesi da te

- **Sezione 0** compilata prima di scansionare.
- **Sessione A** (profilo dedicato): probe + fixture/HAR scrubbate + baseline-A → JSON/file.
- **Decisione chiave** (C7/C9/C10): meccanismo B2 (iframe preferito; `$A` bridge solo se serve).
- **Sessione B**: end-to-end + injection + edge case + baseline-B.
