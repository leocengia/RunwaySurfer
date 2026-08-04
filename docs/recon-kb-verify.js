/*
 * RunwaySurfer — Recon KB "VERIFY" (validazione live del codice)
 * ==============================================================
 *
 * Probe unico che valida dal vivo le assunzioni su cui girano estrazione,
 * navigazione SPA (B2) e retrieval — quelle che i test happy-dom NON esercitano.
 * Vedi docs/PIANO-verifica-scansione-KB.md per il razionale e le soglie di PASS.
 *
 * DOVE GIRA: console DevTools = MAIN world. Ogni check riporta `world`:
 *   - "either"    → raggiungibile anche dal content-script ISOLATED dell'estensione;
 *   - "main"      → dipende da window.$A → l'estensione avrebbe bisogno di un
 *                   bridge world:'MAIN' (l'ISOLATED non vede $A).
 *
 * COME USARLO
 * -----------
 * 1) Compila la Sezione 0 di docs/MAPPA-KB.md (autorizzazione) e usa un PROFILO
 *    DEDICATO/di test, non la sessione di un agente in produzione.
 * 2) Apri una pagina-ARTICOLO autenticata (/Runway/s/article/...). Console:
 *    `console.clear()` poi incolla tutto e Invio. Leggi la PRIMA riga (PREFLIGHT):
 *    se FAIL, fermati e correggi (di solito: non sei loggato o non sei su un articolo).
 * 3) Statico (default): non naviga. Per i check dinamici (navigazione/iframe):
 *    prima di incollare digita `window.RS_VERIFY_NAV = true`.
 *    Opzionale: `window.RS_VERIFY_TARGET_URL = '<url di un ALTRO articolo>'`.
 * 4) Attendi il blocco verde `RS-VERIFY`, scarica `rs-verify-<slug>.json` (+ clipboard),
 *    reincollalo (o passa il file all'analizzatore: `node docs/recon-kb-analyze.mjs file.json`).
 *
 * SICUREZZA: solo GET/POST same-origin con la TUA sessione; non modifica nulla sul
 * server. L'output è SCRUBBATO (email/session-id/token/telefoni redatti) e il download
 * è BLOCCATO se lo scrub trova ancora un match (`RS-SCRUB-FAIL`).
 */
(async () => {
  const PROBE_VERSION = '2026-07-28a';
  const SCHEMA = 'rs-verify/1';
  const NAV = window.RS_VERIFY_NAV === true;
  const origin = location.origin;
  const EXPECTED_ORIGIN = 'https://traveler.my.site.com';

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const classify = (u) => {
    const p = u.pathname;
    if (/\/s\/article\//.test(p)) return 'article';
    if (/\/s\/detail\//.test(p)) return 'detail';
    if (/\/s\/topic\//.test(p)) return 'topic';
    if (/\/s\/categor/i.test(p)) return 'category';
    if (/\/s\/global-search\//.test(p)) return 'search';
    if (/\/s\/?$/.test(p)) return 'home';
    return 'other';
  };
  const linkIdentity = (u) => u.origin + decodeURIComponent(u.pathname).replace(/\/+$/, '');
  const lastSeg = (u) => decodeURIComponent(u.pathname).split('/').filter(Boolean).pop() || '';
  const mainText = () => norm(document.querySelector('[role="main"]')?.innerText || '');

  // Allineati a lib/site-profile.ts contentSelectors (aggiornato dopo la
  // fixture 2026-07-21: c-runway-article-viewer è il vero corpo, i due
  // selettori Salesforce precedenti erano morti su 5/5 pagine e sono stati
  // rimossi dal codice — restano qui SOLO per rilevare un eventuale ritorno).
  const CONTENT_SELECTORS = [
    'c-runway-article-viewer',
    '[data-region-name="content"]',
    '[role="main"]',
    'main',
    'article',
    '#mw-content-text',
    '#content',
  ];
  // Marker "testuali" = quelli che, se presenti nell'HTML grezzo di un fetch,
  // farebbero passare erroneamente hasRenderedContent (extract.ts:228).
  const GENERIC_TEXTUAL = new Set(['main', 'article', '#content']);
  const NOISE_CODE = [
    '.websterInnerHeader',
    '.forceCommunityBreadcrumbs',
    '.forceHighlightsPanel',
    '.forceCommunityRecordHeadline',
    '.footer',
  ];
  const NOISE_RECON = [
    '.comm-content-header',
    '.comm-content-footer',
    '.slds-page-header_record-home',
  ];
  const APP_ROOT_SELECTORS = ['.forceCommunityApp', '.siteforceContentArea', '.cComm', 'main'];

  // --- Scrub (data-handling) -------------------------------------------------
  // I placeholder NON devono ri-matchare il proprio pattern: altrimenti
  // rsVerifyClean (che gira sul JSON già scrubbato) ri-troverebbe il match e
  // bloccherebbe il download su ogni pagina che conteneva email/sid/cookie/…
  // Perciò sono token neutri (niente @, `sid=`, `cookie=`, `Bearer `, cifre).
  // Il phone-regex è stretto (richiede `+` o parentesi) così non mangia date
  // ISO/epoch/contatori (es. meta.atIso, byte count).
  const SCRUB = [
    { name: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, to: '<REDACTED_EMAIL>' },
    { name: 'sfSessionId', re: /00D[A-Za-z0-9]{12,}![\w.$%-]+/g, to: '<REDACTED_SF>' },
    { name: 'bearer', re: /Bearer\s+[A-Za-z0-9._-]+/gi, to: '<REDACTED_BEARER>' },
    { name: 'sid', re: /\bsid=[^;&\s"']+/gi, to: '<REDACTED_SID>' },
    { name: 'cookie', re: /\b(set-)?cookie\s*[:=]\s*[^\n"']+/gi, to: '<REDACTED_COOKIE>' },
    { name: 'auraToken', re: /"?aura\.token"?\s*[:=]\s*"[^"]*"/gi, to: '<REDACTED_AURATOKEN>' },
    {
      name: 'phone',
      re: /(?:\+\d[\d ().-]{6,}\d)|(?:\(\d{2,4}\)[ .-]?\d[\d ().-]{4,}\d)/g,
      to: '<REDACTED_PHONE>',
    },
  ];
  const scrubStr = (s) => {
    let out = String(s);
    for (const p of SCRUB) out = out.replace(p.re, p.to);
    return out;
  };
  const rsScrub = (x) => {
    if (typeof x === 'string') return scrubStr(x);
    if (Array.isArray(x)) return x.map(rsScrub);
    if (x && typeof x === 'object') {
      const o = {};
      for (const k of Object.keys(x)) o[k] = rsScrub(x[k]);
      return o;
    }
    return x;
  };
  const rsVerifyClean = (jsonStr) => {
    const hits = {};
    for (const p of SCRUB) {
      const m = jsonStr.match(p.re);
      if (m && m.length) hits[p.name] = m.length;
    }
    return { clean: Object.keys(hits).length === 0, hits };
  };

  // --- Runner: ogni check isolato, mai fa cadere il probe --------------------
  const checks = {};
  const timingsMs = {};
  const run = async (id, world, fn) => {
    const t0 = performance.now();
    try {
      checks[id] = { world, ...(await fn()) };
    } catch (e) {
      checks[id] = { world, error: String((e && e.message) || e) };
    }
    timingsMs[id] = Math.round(performance.now() - t0);
  };

  const meta = {
    atIso: new Date().toISOString(),
    pathnameSlug: lastSeg(new URL(location.href)),
    language: new URL(location.href).searchParams.get('language'),
    pageType: classify(new URL(location.href)),
    userAgent: navigator.userAgent,
    viewport: `${innerWidth}x${innerHeight}`,
    nav: NAV,
  };

  // --- PREFLIGHT (per PRIMO) -------------------------------------------------
  const hasPasswordField = !!document.querySelector('input[type="password"]');
  const bodyText = norm(document.body?.innerText || '');
  const looksLogin =
    hasPasswordField ||
    /\b(log ?in|sign ?in|accedi|password dimenticata)\b/i.test(bodyText.slice(0, 400));
  const mText0 = mainText();
  const preflight = {
    originOk: origin === EXPECTED_ORIGIN,
    onArticle: meta.pageType === 'article' || meta.pageType === 'detail',
    sessionOk: !looksLogin && mText0.length > 500,
    apisOk:
      typeof performance !== 'undefined' &&
      typeof MutationObserver !== 'undefined' &&
      typeof PerformanceObserver !== 'undefined',
  };
  preflight.pass =
    preflight.originOk && preflight.onArticle && preflight.sessionOk && preflight.apisOk;
  const preflightReason = preflight.pass
    ? 'origin ok, sessione ok, pagina articolo, API ok'
    : [
        !preflight.originOk && `origin=${origin} (atteso ${EXPECTED_ORIGIN})`,
        !preflight.onArticle && `non sei su un articolo (pageType=${meta.pageType})`,
        !preflight.sessionOk && 'sessione/contenuto assente (login-wall?)',
        !preflight.apisOk && 'API browser mancanti',
      ]
        .filter(Boolean)
        .join('; ');
  console.log(
    `%cRS-VERIFY PREFLIGHT: ${preflight.pass ? 'PASS' : 'FAIL'}%c ${preflightReason}`,
    `font-weight:bold;color:${preflight.pass ? '#0a7' : '#c33'}`,
    'color:inherit',
  );

  const emit = () => {
    const payload = rsScrub({
      schema: SCHEMA,
      probeVersion: PROBE_VERSION,
      meta,
      preflight,
      checks,
      timingsMs,
    });
    const json = JSON.stringify(payload, null, 2);
    const scrubbed = rsVerifyClean(json);
    window.RS_VERIFY_JSON = json;
    console.log('%cRS-VERIFY', 'font-weight:bold;color:#0a7', '\n' + json);
    if (!scrubbed.clean) {
      console.error(
        '%cRS-SCRUB-FAIL — download BLOCCATO, pattern residui:',
        'font-weight:bold;color:#c33',
        scrubbed.hits,
      );
      return payload;
    }
    try {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `rs-verify-${meta.pathnameSlug || 'page'}.json`;
      document.documentElement.appendChild(a);
      a.click();
      URL.revokeObjectURL(a.href);
      a.remove();
      console.log('%c✓ Scaricato + clipboard (scrub pulito).', 'color:#0a7');
    } catch (e) {
      console.warn('[RS-VERIFY] download non riuscito:', e);
    }
    try {
      copy(json);
    } catch {
      /* usa il file o copy(RS_VERIFY_JSON) */
    }
    return payload;
  };

  if (!preflight.pass) {
    console.warn(
      '[RS-VERIFY] preflight FAIL: eseguo solo i check statici sicuri e emetto il meta.',
    );
  }

  // === Check statici (sicuri anche a preflight FAIL) =========================

  // C1 — origin & redirect
  await run('C1', 'either', async () => {
    const navEntry = performance.getEntriesByType('navigation')[0];
    return {
      origin,
      expected: EXPECTED_ORIGIN,
      match: origin === EXPECTED_ORIGIN,
      redirectCount: navEntry ? navEntry.redirectCount : null,
      referrer: document.referrer ? new URL(document.referrer).origin : null,
      pageType: meta.pageType,
      note: 'se origin ≠ atteso, muore matches in index.tsx:10 (non solo host_permissions)',
    };
  });

  // C2 — selettori contenuto (match-count + vincitore)
  await run('C2', 'either', async () => {
    const perSelector = CONTENT_SELECTORS.map((sel) => ({
      sel,
      count: document.querySelectorAll(sel).length,
    }));
    const winner = perSelector.find((s) => s.count > 0) || null;
    let winnerLen = null;
    if (winner) winnerLen = norm(document.querySelector(winner.sel)?.innerText || '').length;
    return {
      perSelector,
      winner: winner ? winner.sel : null,
      winnerLen,
      winnerIsSalesforceSpecific: winner
        ? ['c-runway-article-viewer', '[data-region-name="content"]'].includes(winner.sel)
        : false,
    };
  });

  // C3 — rumore + delta testo
  await run('C3', 'either', async () => {
    const presence = (list) =>
      list.map((sel) => ({ sel, count: document.querySelectorAll(sel).length }));
    const rootSel = document.querySelectorAll(
      CONTENT_SELECTORS.find((s) => document.querySelector(s)) || 'body',
    )[0]
      ? CONTENT_SELECTORS.find((s) => document.querySelector(s)) || 'body'
      : 'body';
    const rootEl = document.querySelector(rootSel) || document.body;
    const before = norm(rootEl.innerText || '').length;
    const clone = rootEl.cloneNode(true);
    [...NOISE_CODE, ...NOISE_RECON].forEach((sel) =>
      clone.querySelectorAll(sel).forEach((n) => n.remove()),
    );
    document.body.appendChild(clone);
    const after = norm(clone.innerText || '').length;
    clone.remove();
    return {
      codeSelectors: presence(NOISE_CODE),
      reconSelectors: presence(NOISE_RECON),
      rootSel,
      lenBefore: before,
      lenAfter: after,
      deltaPct: before ? Math.round(((before - after) / before) * 100) : 0,
    };
  });

  // C4 — login-wall / not-found
  await run('C4', 'either', async () => {
    const t = bodyText;
    const notFound =
      /\b(not found|no longer available|non (è )?disponibile|record non trovato|articolo non trovato)\b/i.test(
        t.slice(0, 600),
      );
    return {
      hasPasswordField,
      looksLogin,
      notFound,
      mainLen: mText0.length,
      verdict: looksLogin ? 'login' : notFound ? 'notfound' : 'ok',
    };
  });

  // C5 — fetch shell-vs-content per-selettore (+ redirect + CSP per C17)
  let c5Headers = {};
  await run('C5', 'either', async () => {
    const res = await fetch(location.href, { credentials: 'include' });
    const html = await res.text();
    c5Headers = {
      csp: res.headers.get('content-security-policy'),
      xFrame: res.headers.get('x-frame-options'),
    };
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const perSelector = CONTENT_SELECTORS.map((sel) => ({
      sel,
      inRawHtml: !!doc.querySelector(sel),
      textual: GENERIC_TEXTUAL.has(sel),
    }));
    const textualMatched = perSelector.filter((s) => s.inRawHtml && s.textual).map((s) => s.sel);
    const sniffLogin = /login|sign in|accedi/i.test(html.slice(0, 400));
    return {
      status: res.status,
      redirected: res.redirected,
      finalUrl: res.url,
      bytes: html.length,
      perSelector,
      portabilityNote:
        "fetch qui è MAIN-world; nell'ISOLATED del content-script CSP connect-src / cookie partitioning possono differire",
      textualMatchedInShell: textualMatched,
      followDeadConfirmed: perSelector.every((s) => !s.inRawHtml),
      sniffLogin,
    };
  });

  // C8 — "collegati": anchor vs non-anchor dentro [role=main]
  await run('C8', 'either', async () => {
    const root = document.querySelector('[role="main"]') || document.body;
    const anchors = [...root.querySelectorAll('a[href]')].filter((a) => {
      try {
        return new URL(a.href).origin === origin;
      } catch {
        return false;
      }
    });
    const byType = { article: 0, topic: 0, detail: 0, other: 0 };
    anchors.forEach((a) => {
      const c = classify(new URL(a.href));
      byType[c] = (byType[c] || 0) + 1;
    });
    const suggestedSel = [
      '[class*="suggest" i]',
      '[class*="related" i]',
      '.cuf-relatedArticles',
    ].find((s) => root.querySelector(s));
    const suggestedRoot = suggestedSel ? root.querySelector(suggestedSel) : null;
    const nonAnchorClickable = [...root.querySelectorAll('[role="link"],[onclick]')].filter(
      (n) => n.tagName !== 'A',
    ).length;
    return {
      anchorCountInMain: anchors.length,
      byType,
      capMax40Risk: anchors.length >= 40,
      suggestedContainer: suggestedSel || null,
      suggestedAnchorCount: suggestedRoot ? suggestedRoot.querySelectorAll('a[href]').length : null,
      nonAnchorClickable,
    };
  });

  // C10 — $A reachability + Locker/LWS  (MAIN world)
  await run('C10', 'main', async () => {
    const aPresent = typeof window.$A !== 'undefined';
    if (!aPresent)
      return { status: 'unavailable', note: '$A assente (isolated world o non bootato)' };
    return {
      status: 'present',
      storageService: !!window.$A.storageService,
      finishedInit: !!window.$A.finishedInit,
      fetchNative: String(window.fetch).includes('[native code]'),
      xhrNative: String(window.XMLHttpRequest).includes('[native code]'),
      note: 'fetch/xhr non-native ⇒ Locker/LWS proxya la rete',
    };
  });

  // C11 — fwuid via encodeForServer (self-healing) — NON registra il valore.
  // world=main: sia $A che window.Aura sono globali di pagina, invisibili
  // all'ISOLATED world del content-script.
  await run('C11', 'main', async () => {
    let encodeForServerAvailable = false;
    try {
      encodeForServerAvailable = typeof window.$A?.getContext?.().encodeForServer === 'function';
    } catch {
      encodeForServerAvailable = false;
    }
    const bootstrapFwuidPresent = !!(
      window.Aura &&
      window.Aura.initConfig &&
      window.Aura.initConfig.context &&
      window.Aura.initConfig.context.fwuid
    );
    return {
      encodeForServerAvailable,
      bootstrapFwuidPresent,
      note: 'valore fwuid NON registrato (do-not-capture); solo presenza',
    };
  });

  // C12 — LDS via IndexedDB (ISOLATED-reachable). Scansiona TUTTI i DB record/LDS
  // (non solo il primo match: `ldsCSRFToken` non è il record cache — quello è
  // `recordGVP*` / `ldsDurableCache`), conta i ka0 in ogni object-store e riporta
  // per-DB. Nessun valore LDS viene registrato, solo conteggi.
  await run('C12', 'either', async () => {
    if (!indexedDB.databases)
      return { status: 'unsupported', note: 'indexedDB.databases() non disponibile' };
    const names = (await indexedDB.databases()).map((d) => d.name).filter(Boolean);
    const candidates = names.filter(
      (n) => /lds|record|gvp|aura/i.test(n) && !/csrf|token/i.test(n),
    );
    const scanDb = (name) =>
      new Promise((resolve) => {
        const out = { name, ka0: 0, plaintext: null, error: null };
        let req;
        try {
          req = indexedDB.open(name);
        } catch (e) {
          return resolve({ ...out, error: String((e && e.message) || e) });
        }
        req.onerror = () => resolve({ ...out, error: 'open error' });
        req.onsuccess = async () => {
          const db = req.result;
          try {
            for (const store of [...db.objectStoreNames]) {
              await new Promise((res) => {
                const tx = db.transaction(store, 'readonly');
                const kq = tx.objectStore(store).getAllKeys();
                kq.onsuccess = () => {
                  const keys = (kq.result || []).map(String);
                  out.ka0 += keys.filter((k) => /ka0[A-Za-z0-9]{6,}/i.test(k)).length;
                  if (out.plaintext === null) {
                    const vq = tx.objectStore(store).getAll();
                    vq.onsuccess = () => {
                      const first = (vq.result || [])[0];
                      if (first !== undefined)
                        out.plaintext =
                          typeof first === 'object' ||
                          (typeof first === 'string' && first.trim().startsWith('{'));
                      res();
                    };
                    vq.onerror = () => res();
                  } else res();
                };
                kq.onerror = () => res();
              });
            }
          } catch (e) {
            out.error = String((e && e.message) || e);
          }
          db.close();
          resolve(out);
        };
      });
    const perDb = [];
    for (const name of candidates) perDb.push(await scanDb(name));
    const ka0KeyCount = perDb.reduce((n, d) => n + d.ka0, 0);
    const withKa0 = perDb.filter((d) => d.ka0 > 0);
    const plainSrc = withKa0[0] || perDb.find((d) => d.plaintext !== null);
    return {
      databases: names,
      candidatesScanned: candidates,
      perDb,
      ka0KeyCount,
      dbsWithKa0: withKa0.map((d) => d.name),
      valuesPlaintext: plainSrc ? plainSrc.plaintext : null,
      note: 'nessun valore LDS registrato (solo conteggi ka0)',
    };
  });

  // C13/C14 — LDS via $A + readiness Aura
  await run('C13', 'main', async () => {
    let ldsGetAllCount = null;
    try {
      const store = window.$A?.storageService?.getStorage?.('ldsCache');
      if (store && store.getAll) {
        const all = await store.getAll();
        ldsGetAllCount = Array.isArray(all) ? all.length : all ? Object.keys(all).length : null;
      }
    } catch {
      /* $A assente o API cambiata */
    }
    return {
      ldsGetAllCount,
      note: 'copertura target NON-visitato: verificabile solo con navigazione (C7 NAV)',
    };
  });
  await run('C14', 'either', async () => ({
    auraLoadingBox: !!document.querySelector('#auraLoadingBox'),
    sldsSpinner: document.querySelectorAll('.slds-spinner').length,
    lightningSpinner: document.querySelectorAll('lightning-spinner').length,
    finishedInit: (() => {
      try {
        return !!window.$A?.finishedInit;
      } catch {
        return null;
      }
    })(),
    note: 'timing vs render misurabile solo durante la navigazione (C7)',
  }));

  // C17 — CSP framing (dagli header di C5)
  await run('C17', 'either', async () => ({
    csp: c5Headers.csp || null,
    frameAncestors: c5Headers.csp
      ? (c5Headers.csp.match(/frame-ancestors[^;]*/i) || [null])[0]
      : null,
    xFrameOptions: c5Headers.xFrame || null,
    iframeLikelyAllowed: !c5Headers.xFrame || /same/i.test(c5Headers.xFrame),
  }));

  // C16 — recordId per-lingua + en_US 404 (2 fetch, politeness ok)
  await run('C16', 'either', async () => {
    const base = new URL(location.href);
    const fetchLang = async (lang) => {
      const u = new URL(base.href);
      u.searchParams.set('language', lang);
      try {
        const res = await fetch(u.href, { credentials: 'include' });
        const html = await res.text();
        return {
          status: res.status,
          redirected: res.redirected,
          notFound: /not found|non trovato/i.test(html.slice(0, 600)),
        };
      } catch (e) {
        return { error: String((e && e.message) || e) };
      }
    };
    const en = await fetchLang('en_US');
    await sleep(500);
    const it = await fetchLang('it');
    return {
      en,
      it,
      note: 'shell client-rendered: 404 affidabile solo via getRecord (C15); qui indicativo',
    };
  });

  // === Check dinamici (solo con RS_VERIFY_NAV=true) ==========================
  if (NAV && preflight.pass) {
    const targetUrl =
      window.RS_VERIFY_TARGET_URL ||
      (() => {
        const a = [...document.querySelectorAll('[role="main"] a[href]')].find(
          (x) =>
            classify(new URL(x.href)) === 'article' &&
            linkIdentity(new URL(x.href)) !== linkIdentity(new URL(location.href)),
        );
        return a ? a.href : null;
      })();

    // C7 — matrice navigazione, decisiva e SOPRAVVIVIBILE (+ C6 timeline)
    await run('C7', 'either', async () => {
      if (!targetUrl)
        return {
          status: 'skipped',
          reason: 'nessun articolo target in pagina; imposta window.RS_VERIFY_TARGET_URL',
        };
      const startUrl = location.href;
      const hubId = linkIdentity(new URL(startUrl));
      const rootEl =
        document.querySelector(
          APP_ROOT_SELECTORS.find((s) => document.querySelector(s)) || 'body',
        ) || document.body;

      // breadcrumb: se un reload sfugge, il ri-paste lo rileva
      let breadcrumb = null;
      try {
        breadcrumb = sessionStorage.getItem('rs-verify-nav');
        if (breadcrumb) sessionStorage.removeItem('rs-verify-nav');
      } catch {
        /* no sessionStorage */
      }

      const measureRender = async (want, capture) => {
        const t0 = performance.now();
        let renderMs = null;
        let urlChangedAt = null;
        let firstMutAt = null;
        let oldPersistedAfterUrl = false;
        const startSig = mainText();
        for (let i = 0; i < 130; i++) {
          await sleep(100);
          const urlNow = linkIdentity(new URL(location.href));
          const sigNow = mainText();
          if (urlChangedAt === null && urlNow === want)
            urlChangedAt = Math.round(performance.now() - t0);
          if (urlChangedAt !== null && firstMutAt === null && sigNow !== startSig)
            firstMutAt = Math.round(performance.now() - t0);
          if (urlChangedAt !== null && firstMutAt === null && sigNow === startSig)
            oldPersistedAfterUrl = true;
          if (urlNow === want && sigNow !== startSig && sigNow.length > 50) {
            renderMs = Math.round(performance.now() - t0);
            break;
          }
        }
        return capture
          ? { renderMs, urlChangedAt, firstMutAt, oldPersistedAfterUrl }
          : { renderMs };
      };

      const attempt = async (mechanism, trigger, capture) => {
        window.__rsVerifyMark = 'alive';
        let unloaded = false;
        let prevented = null;
        const onUnload = () => {
          unloaded = true;
          try {
            sessionStorage.setItem('rs-verify-nav', JSON.stringify({ mechanism, at: Date.now() }));
          } catch {
            /* ignore */
          }
        };
        const guard = (ev) => {
          prevented = ev.defaultPrevented;
          if (!ev.defaultPrevented) ev.preventDefault(); // aborta il full-reload se non intercettato
        };
        addEventListener('beforeunload', onUnload, { once: true });
        addEventListener('click', guard, false); // bubble → dopo l'handler delegato di Aura
        const startSig = mainText();
        try {
          trigger();
        } catch (e) {
          removeEventListener('click', guard, false);
          removeEventListener('beforeunload', onUnload);
          return { mechanism, outcome: 'error', error: String((e && e.message) || e) };
        }
        const wantId = linkIdentity(new URL(targetUrl, location.href));
        const timing = await measureRender(wantId, capture);
        removeEventListener('click', guard, false);
        removeEventListener('beforeunload', onUnload);
        const fullReload = unloaded || typeof window.__rsVerifyMark === 'undefined';
        const urlChanged = linkIdentity(new URL(location.href)) === wantId;
        const sigChanged = mainText() !== startSig;
        let outcome;
        if (fullReload) outcome = 'full-reload';
        else if (urlChanged && sigChanged && timing.renderMs !== null) outcome = 'intercepted-spa';
        else if (prevented === false) outcome = 'not-intercepted';
        else if (prevented === true) outcome = 'no-op';
        else outcome = 'no-op';
        // Torna all'hub SEMPRE che l'URL si sia spostato (anche su no-op da
        // pushState, che cambia location.href senza render): altrimenti i
        // meccanismi successivi misurerebbero sulla pagina sbagliata.
        let backRestored = null;
        if (!fullReload && linkIdentity(new URL(location.href)) !== hubId) {
          history.back();
          backRestored = false;
          for (let i = 0; i < 100; i++) {
            await sleep(100);
            if (linkIdentity(new URL(location.href)) === hubId && mainText().length > 50) {
              backRestored = true;
              break;
            }
          }
        }
        return {
          mechanism,
          outcome,
          prevented,
          urlChanged,
          sigChanged,
          fullReload,
          backRestored,
          ...timing,
        };
      };

      const mkAnchor = (parent) => {
        const a = document.createElement('a');
        a.href = targetUrl;
        a.textContent = 'rs-verify';
        a.style.cssText = 'position:absolute;left:-9999px;width:1px;height:1px;';
        parent.appendChild(a);
        return a;
      };

      const results = [];
      // (a) anchor@body
      {
        const a = mkAnchor(document.body);
        results.push(await attempt('anchor@body', () => a.click(), true));
        a.remove();
      }
      // (a') anchor@root — se nessuno ha ancora intercettato
      if (!results.some((r) => r.outcome === 'intercepted-spa')) {
        const a = mkAnchor(rootEl);
        results.push(await attempt('anchor@root', () => a.click(), false));
        a.remove();
      }
      // (b) MouseEvent ctor
      if (!results.some((r) => r.outcome === 'intercepted-spa')) {
        const a = mkAnchor(rootEl);
        results.push(
          await attempt(
            'mouseevent',
            () => a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
            false,
          ),
        );
        a.remove();
      }
      // (c) pushState + popstate (verifica integrità history)
      if (!results.some((r) => r.outcome === 'intercepted-spa')) {
        const stateBefore = history.state;
        const lenBefore = history.length;
        const r = await attempt(
          'pushstate',
          () => {
            history.pushState(null, '', targetUrl);
            dispatchEvent(new PopStateEvent('popstate'));
          },
          false,
        );
        r.historyStateWasStructured = stateBefore !== null && typeof stateBefore === 'object';
        r.historyLenDelta = history.length - lenBefore;
        results.push(r);
      }
      // (d) $A e.force:navigateToURL (MAIN)
      if (
        !results.some((r) => r.outcome === 'intercepted-spa') &&
        typeof window.$A !== 'undefined'
      ) {
        results.push(
          await attempt(
            'aura$A',
            () => {
              const path =
                new URL(targetUrl, location.href).pathname +
                new URL(targetUrl, location.href).search;
              const e = window.$A.get('e.force:navigateToURL');
              e.setParams({ url: path });
              e.fire();
            },
            false,
          ),
        );
      }

      const winner = results.find((r) => r.outcome === 'intercepted-spa') || null;
      return {
        targetUrl,
        appRoot: APP_ROOT_SELECTORS.find((s) => document.querySelector(s)) || 'body',
        breadcrumbFromPreviousRun: breadcrumb ? JSON.parse(breadcrumb) : null,
        results,
        verdict: winner
          ? `intercepted-spa via ${winner.mechanism}`
          : 'nessun meccanismo client-side',
        recommendedMechanism: winner ? winner.mechanism : null,
      };
    });

    // C9 — iframe nascosto same-origin (meccanismo B2 alternativo)
    await run('C9', 'either', async () => {
      if (!targetUrl) return { status: 'skipped' };
      const u = new URL(targetUrl, location.href);
      u.searchParams.set('language', 'en_US');
      const t0 = performance.now();
      const result = await new Promise((resolve) => {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:absolute;left:-9999px;width:800px;height:600px;';
        let done = false;
        const finish = (r) => {
          if (done) return;
          done = true;
          iframe.remove();
          resolve(r);
        };
        iframe.onload = async () => {
          for (let i = 0; i < 150; i++) {
            await sleep(100);
            let text = '';
            try {
              text = norm(iframe.contentDocument?.querySelector('[role="main"]')?.innerText || '');
            } catch (e) {
              return finish({
                loaded: true,
                crossOriginBlocked: true,
                error: String((e && e.message) || e),
              });
            }
            if (text.length > 50)
              return finish({
                loaded: true,
                rendered: true,
                bootMs: Math.round(performance.now() - t0),
                textLen: text.length,
              });
          }
          finish({ loaded: true, rendered: false, bootMs: null });
        };
        iframe.onerror = () => finish({ loaded: false, error: 'iframe onerror' });
        iframe.src = u.href;
        document.body.appendChild(iframe);
        setTimeout(() => finish({ loaded: false, timeout: true }), 16000);
      });
      return {
        ...result,
        note: 'se rendered:true ⇒ B2 via iframe (il tab non naviga, letto da contentDocument)',
      };
    });

    // C15 — getRecord replay (MAIN, sperimentale) — corpo NON registrato
    await run('C15', 'main', async () => {
      if (typeof window.$A === 'undefined') return { status: 'skipped', reason: '$A assente' };
      let recordId = null;
      try {
        const store = window.$A.storageService?.getStorage?.('ldsCache');
        const all = store && store.getAll ? await store.getAll() : null;
        const keys = Array.isArray(all) ? all.map((x) => x.key || '') : all ? Object.keys(all) : [];
        recordId =
          (keys.find((k) => /ka0[A-Za-z0-9]{12,}/.test(k)) || '').match(
            /ka0[A-Za-z0-9]{12,}/,
          )?.[0] || null;
      } catch {
        /* best-effort */
      }
      if (!recordId)
        return { status: 'skipped', reason: 'nessun ka0 in LDS (naviga prima un articolo)' };
      let ctx = 'null';
      try {
        ctx = window.$A.getContext().encodeForServer();
      } catch {
        /* usa null */
      }
      const descriptor =
        'serviceComponent://ui.force.components.controllers.recordGlobalValueProvider.RecordGvpController/ACTION$getRecord';
      const message = {
        actions: [
          {
            descriptor,
            callingDescriptor: 'UNKNOWN',
            params: {
              recordDescriptor: `${recordId}.undefined.FULL.null.null.Details__c,Summary,Title,UrlName.VIEW.true.null.null.null`,
            },
          },
        ],
      };
      const body = new URLSearchParams();
      body.set('message', JSON.stringify(message));
      body.set('aura.context', ctx);
      body.set('aura.token', 'null');
      const t0 = performance.now();
      const res = await fetch(
        `${origin}/Runway/s/sfsites/aura?r=1&aura.RecordGvpController.getRecord=1`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        },
      );
      const raw = await res.text();
      const clean = raw.replace(/^while\(1\);/, '').replace(/^\)\]\}'[,\s]*/, '');
      let state = null;
      let hasDetails = false;
      try {
        const parsed = JSON.parse(clean);
        state = parsed.actions?.[0]?.state || null;
        const gvp = parsed.context?.globalValueProviders || [];
        const recStore = gvp.find((g) => g.type === '$Record');
        const rec = recStore?.values?.records?.[recordId]?.Article__kav?.record?.fields;
        hasDetails = !!(rec && rec.Details__c && rec.Details__c.value);
      } catch {
        /* envelope inatteso */
      }
      return {
        recordIdRedacted: '<ka0>',
        httpStatus: res.status,
        auraState: state,
        bytes: raw.length,
        ms: Math.round(performance.now() - t0),
        hasDetails,
        note: 'corpo NON registrato; misura solo esito/size (route B2 v2 fetch-only)',
      };
    });

    // C18 — Suggested virtualizzato
    await run('C18', 'either', async () => {
      const root = document.querySelector('[role="main"]') || document.body;
      const sel = ['[class*="suggest" i]', '[class*="related" i]', '.cuf-relatedArticles'].find(
        (s) => root.querySelector(s),
      );
      if (!sel) return { status: 'not-found' };
      const el = root.querySelector(sel);
      const before = el.querySelectorAll('a[href]').length;
      el.scrollIntoView();
      await sleep(1200);
      const after = el.querySelectorAll('a[href]').length;
      return {
        container: sel,
        anchorsBeforeScroll: before,
        anchorsAfterScroll: after,
        virtualized: after > before,
      };
    });
  } else if (NAV && !preflight.pass) {
    checks.C7 = {
      world: 'either',
      status: 'skipped',
      reason: 'preflight FAIL — navigazione non tentata',
    };
  }

  return emit();
})().catch((e) => console.error('[RS-VERIFY] errore fatale:', e));
