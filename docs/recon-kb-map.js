/*
 * RunwaySurfer — Recon KB "MAP" (Passe 0-4)
 * =========================================
 *
 * Script unico di mappatura: auto-rileva il tipo di pagina e dumpa in un JSON
 * strutturato le rilevazioni delle Passe 0-4 del piano di mappatura.
 *   0) tipo di pagina + forma URL
 *   1) content-root candidati + blocchi di RUMORE (metadati, breadcrumb, ecc.)
 *   2) campione qualità estrazione (lunghezze + snippet per vedere il rumore)
 *   3) sorgenti dei "collegati" (cross-link nel corpo, related, topic)
 *   4) profilo navigazione SPA (click→render→back), fino a N campioni di latenza
 *
 * ROBUSTO: ogni passa è isolata; se una fallisce, le altre proseguono e alla
 * fine stampa comunque `RS-MAP` con un campo `errors`. Il JSON è anche in
 * `window.RS_MAP_JSON` (rileggilo con `copy(RS_MAP_JSON)`).
 *
 * COME USARLO
 * -----------
 * Consiglio: prima digita `console.clear()` per pulire i log di Salesforce.
 * Su una pagina-ARTICOLO (o detail/topic/categoria), Console DevTools nel profilo
 * autenticato: incolla tutto e Invio. È ASINCRONO e — per la Passa 4 — NAVIGA
 * (clicca alcuni link e torna indietro con history.back). Aspetta "RS-MAP",
 * poi fai Ctrl+V in chat (il JSON è già in clipboard).
 *
 * Opzioni (impostale PRIMA di incollare):
 *   window.RS_MAP_SPA = false           // salta la Passa 4 (nessuna navigazione)
 *   window.RS_MAP_SPA_SAMPLES = 3        // quante navigazioni misurare (default 3)
 *
 * NOTA: naviga usando la TUA sessione e torna indietro; legge soltanto, non
 * invia nulla a nessuno, non modifica nulla sul server.
 */
(async () => {
  const out = { errors: [] };
  const safe = async (name, fn) => {
    try {
      await fn();
    } catch (e) {
      out.errors.push({ passa: name, error: String((e && e.message) || e) });
      console.warn(`[RS-MAP] errore in ${name}:`, e);
    }
  };

  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
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
  const selOf = (el) => {
    if (!el) return null;
    let cls = '';
    try {
      cls = el.className
        ? '.' + String(el.className).split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        : '';
    } catch {
      cls = '';
    }
    return (el.tagName || '').toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  };
  const containerOf = (a) => {
    let n = a.parentElement;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (n.className && String(n.className).trim()) return selOf(n);
    }
    return null;
  };
  const mainEl = () => document.querySelector('[role="main"]') || document.body;
  const textOf = (el) => {
    // innerText può non essere disponibile su alcuni nodi proxati: fallback.
    try {
      return norm((el && el.innerText) || (el && el.textContent) || '');
    } catch {
      return norm((el && el.textContent) || '');
    }
  };
  const mainText = () => textOf(mainEl());

  const origin = location.origin;
  const doSpa = window.RS_MAP_SPA !== false;
  const spaSamples = Number(window.RS_MAP_SPA_SAMPLES) || 3;
  const BODY_CANDIDATES = [
    '.slds-rich-text-editor__output', // corpo rich-text articolo (visto nel recon-3)
    '.forceCommunityArticleLayout',
    '.cuf-content',
    'lightning-formatted-rich-text',
    '[role="article"]',
    'article',
    '[role="main"]',
  ];
  // Condivisi tra passe (con fallback se una passa fallisce).
  let anchors = [];
  let bestBody = null;

  // --- Passa 0: tipo pagina + URL ----------------------------------------------
  await safe('0-url', () => {
    out.pageType = classify(new URL(location.href));
    out.url = location.href;
    out.pathname = location.pathname;
    out.params = [...new URLSearchParams(location.search).keys()];
    out.lang = document.documentElement.lang || null;
    out.title = document.title;
  });

  // --- Passa 1: content-root candidati + rumore --------------------------------
  await safe('1-contentRoot', () => {
    const describe = (el) =>
      el && {
        selector: selOf(el),
        chars: textOf(el).length,
        headSnippet: textOf(el).slice(0, 160),
      };
    out.contentRoot = {
      candidatesPresent: BODY_CANDIDATES.filter((s) => document.querySelector(s)).map((s) => ({
        candidate: s,
        ...describe(document.querySelector(s)),
      })),
      roleMainChars: mainText().length,
    };

    // Outline: struttura interna di [role=main] (selettore + n. char per blocco),
    // per capire dove si spezzano header-metadati / corpo / footer-feedback e
    // scegliere il content-root e i selettori di rumore giusti.
    const outline = [];
    const walk = (el, depth) => {
      if (depth > 3 || outline.length > 45 || !el) return;
      for (const c of Array.from(el.children || [])) {
        const t = textOf(c);
        if (t.length < 150) continue;
        outline.push({ depth, selector: selOf(c), chars: t.length, head: t.slice(0, 60) });
        walk(c, depth + 1);
      }
    };
    walk(mainEl(), 0);
    out.contentRoot.outline = outline;

    const NOISE_LABELS = [
      'Legacy Id',
      'Stato pubblicazione',
      'Publication Status',
      'Pubblicato',
      'Preferred Language',
      'Record Type',
      'New Info',
      'Article Number',
      'URL Name',
      'Data ultima modifica',
      'Last Modified',
      'Article Total View',
      'Valuta questo articolo',
      'Rate this article',
      'feedback about',
      'upcoming survey',
    ];
    out._noiseLabels = NOISE_LABELS;
    const noiseHits = [];
    const seenNoise = new Set();
    for (const el of Array.from(mainEl().querySelectorAll('*'))) {
      const txt = norm(el.textContent || '');
      if (txt.length > 400) continue;
      const label = NOISE_LABELS.find((l) => txt.includes(l));
      if (label) {
        let box = el;
        for (let i = 0; i < 4 && box.parentElement; i++) box = box.parentElement;
        const sel = selOf(box);
        if (sel && !seenNoise.has(sel)) {
          seenNoise.add(sel);
          noiseHits.push({ label, container: sel });
        }
      }
    }
    out.noiseCandidates = noiseHits;
  });

  // --- Passa 2: campione qualità estrazione ------------------------------------
  await safe('2-extraction', () => {
    bestBody = BODY_CANDIDATES.map((s) => document.querySelector(s)).find(Boolean) || mainEl();
    const bodyText = textOf(bestBody);
    const NOISE_LABELS = out._noiseLabels || [];
    out.extractionSample = {
      bestBodySelector: selOf(bestBody),
      bodyChars: bodyText.length,
      roleMainChars: mainText().length,
      metadataLeaks: NOISE_LABELS.filter((l) => bodyText.includes(l)),
      head: bodyText.slice(0, 200),
      tail: bodyText.slice(-200),
    };
  });
  if (!bestBody) bestBody = mainEl();

  // --- Passa 3: sorgenti dei "collegati" ---------------------------------------
  await safe('3-collegati', () => {
    anchors = Array.from(document.querySelectorAll('a[href]'))
      .map((a) => {
        try {
          return { a, u: new URL(a.href) };
        } catch {
          return null;
        }
      })
      .filter((x) => x && x.u.origin === origin);
    const inBody = (a) => {
      try {
        return bestBody.contains(a);
      } catch {
        return false;
      }
    };
    const selfPath = location.pathname.replace(/\/+$/, '');
    const inError = (a) => {
      try {
        return !!a.closest('#auraError, .auraErrorBox');
      } catch {
        return false;
      }
    };
    const byType = { article: 0, detail: 0, topic: 0, category: 0, search: 0, home: 0, other: 0 };
    const collegati = [];
    const seenLink = new Set();
    for (const { a, u } of anchors) {
      const type = classify(u);
      byType[type]++;
      const key = u.pathname;
      // Esclude il self-link (stesso articolo) e i link fasulli dell'auraErrorBox.
      if (
        (type === 'article' || type === 'detail') &&
        !seenLink.has(key) &&
        u.pathname.replace(/\/+$/, '') !== selfPath &&
        !inError(a)
      ) {
        seenLink.add(key);
        collegati.push({
          type,
          inArticleBody: inBody(a),
          text: norm(a.textContent).slice(0, 70),
          container: containerOf(a),
          href: a.href,
        });
      }
    }
    const relatedHeading = Array.from(document.querySelectorAll('h1,h2,h3,h4,span,div'))
      .map((e) => norm(e.textContent))
      .find(
        (t) => /articoli correlati|related articles|contenuti correlati/i.test(t) && t.length < 60,
      );
    out.collegati = {
      counts: byType,
      articleLinks: collegati.slice(0, 20),
      inBodyArticleLinks: collegati.filter((c) => c.inArticleBody).length,
      relatedSectionHeading: relatedHeading || null,
    };
  });

  // --- Passa 4: profilo navigazione SPA ----------------------------------------
  await safe('4-spaNav', async () => {
    if (!doSpa || !(out.pageType === 'article' || out.pageType === 'detail')) {
      out.spaNav = {
        skipped: doSpa ? `tipo pagina «${out.pageType}» non navigabile` : 'disabilitato',
      };
      return;
    }
    const startUrl = location.href;
    const pathId = (href) => new URL(href).origin + new URL(href).pathname.replace(/\/+$/, '');
    const startId = pathId(startUrl);
    const idOf = () => location.origin + location.pathname.replace(/\/+$/, '');
    const bodyMarginBefore = document.body.style.marginRight || '';
    const navTargets = anchors
      .filter(({ u }) => ['article', 'detail'].includes(classify(u)))
      .filter(
        ({ u }) =>
          u.pathname.replace(/\/+$/, '') !== new URL(startUrl).pathname.replace(/\/+$/, ''),
      )
      .filter((v, i, arr) => arr.findIndex((x) => x.u.pathname === v.u.pathname) === i)
      .slice(0, spaSamples);

    const samples = [];
    for (const { a } of navTargets) {
      const beforeSig = mainText();
      window.__rsMark = 'alive';
      let unloaded = false;
      const onU = () => (unloaded = true);
      addEventListener('beforeunload', onU, { once: true });
      const t0 = performance.now();
      a.click();
      let renderMs = null;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (location.href !== startUrl && mainText() !== beforeSig && mainText().length > 50) {
          renderMs = Math.round(performance.now() - t0);
          break;
        }
      }
      const fullReload = unloaded || typeof window.__rsMark === 'undefined';
      removeEventListener('beforeunload', onU);
      history.back();
      let backOk = false;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 100));
        if (idOf() === startId && mainText().length > 50) {
          backOk = true;
          break;
        }
      }
      samples.push({ renderMs, fullReload, backOk });
      if (!backOk) break;
    }
    const lat = samples.map((s) => s.renderMs).filter((n) => typeof n === 'number');
    out.spaNav = {
      samples,
      renderMs: lat.length
        ? {
            min: Math.min(...lat),
            max: Math.max(...lat),
            median: lat.sort((x, y) => x - y)[Math.floor(lat.length / 2)],
          }
        : null,
      anyFullReload: samples.some((s) => s.fullReload),
      allBackOk: samples.length > 0 && samples.every((s) => s.backOk),
      bodyMarginBefore,
      bodyMarginAfter: document.body.style.marginRight || '',
    };
  });

  delete out._noiseLabels;
  const json = JSON.stringify(out, null, 2);
  window.RS_MAP_JSON = json; // rileggibile con: copy(RS_MAP_JSON)
  console.log('%cRS-MAP', 'font-weight:bold;color:#0a7', '\n' + json);
  if (out.errors.length) console.warn('[RS-MAP] alcune passe hanno dato errore:', out.errors);

  // Consegna a prova di rumore: SCARICA un file (la console di Salesforce spamma
  // tantissimo e la riga può sfuggire). In più prova la clipboard.
  try {
    const blob = new Blob([json], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `rs-map-${out.pageType || 'page'}.json`;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    console.log('%c✓ Scaricato file rs-map-*.json (guarda la barra download).', 'color:#0a7');
  } catch (e) {
    console.warn('[RS-MAP] download non riuscito:', e);
  }
  try {
    copy(json);
    console.log('%c✓ Copiato anche nella clipboard — fai Ctrl+V in chat.', 'color:#0a7');
  } catch {
    console.log('Clipboard non disponibile: apri il file scaricato, o esegui  copy(RS_MAP_JSON)');
  }
  return out;
})().catch((e) => console.error('[RS-MAP] errore fatale:', e));
