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
 * COME USARLO
 * -----------
 * Su una pagina-ARTICOLO (o detail/topic/categoria), Console DevTools nel profilo
 * autenticato: incolla tutto e Invio. È ASINCRONO e — per la Passa 4 — NAVIGA
 * (clicca alcuni link e torna indietro con history.back). Aspetta "RS-MAP".
 * Reincollami il JSON. Ripeti su pagine di tipo diverso (vedi docs/MAPPA-KB.md).
 *
 * Opzioni (facoltative, impostale PRIMA di incollare):
 *   window.RS_MAP_SPA = false           // salta la Passa 4 (nessuna navigazione)
 *   window.RS_MAP_SPA_SAMPLES = 3        // quante navigazioni misurare (default 3)
 *
 * NOTA: naviga usando la TUA sessione e torna indietro; legge soltanto, non
 * invia nulla a nessuno, non modifica nulla sul server.
 */
(async () => {
  const origin = location.origin;
  const doSpa = window.RS_MAP_SPA !== false;
  const spaSamples = Number(window.RS_MAP_SPA_SAMPLES) || 3;

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
    const cls = el.className
      ? '.' + String(el.className).split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  };
  const containerOf = (a) => {
    let n = a.parentElement;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (n.className && String(n.className).trim()) return selOf(n);
    }
    return null;
  };
  const mainEl = () => document.querySelector('[role="main"]') || document.body;
  const mainText = () => norm(mainEl().innerText || '');

  const out = {
    // --- Passa 0: tipo pagina + URL --------------------------------------------
    pageType: classify(new URL(location.href)),
    url: location.href,
    pathname: location.pathname,
    params: [...new URLSearchParams(location.search).keys()],
    lang: document.documentElement.lang || null,
    title: document.title,
  };

  // --- Passa 1: content-root candidati + rumore --------------------------------
  const BODY_CANDIDATES = [
    '.slds-rich-text-editor__output', // corpo rich-text articolo (visto nel recon-3)
    '.forceCommunityArticleLayout',
    '.cuf-content',
    'lightning-formatted-rich-text',
    '[role="article"]',
    'article',
    '[role="main"]',
  ];
  const describe = (el) =>
    el && {
      selector: selOf(el),
      chars: norm(el.innerText || '').length,
      headSnippet: norm(el.innerText || '').slice(0, 160),
    };
  out.contentRoot = {
    candidatesPresent: BODY_CANDIDATES.filter((s) => document.querySelector(s)).map((s) => ({
      candidate: s,
      ...describe(document.querySelector(s)),
    })),
    roleMainChars: mainText().length,
  };

  // Rumore: pannello metadati "Article Detail" — cerco i contenitori che portano
  // etichette tipiche, così ricavo il selettore da aggiungere a noiseSelectors.
  const NOISE_LABELS = [
    'Legacy Id',
    'Stato pubblicazione',
    'Pubblicato',
    'Article Number',
    'URL Name',
    'Data ultima modifica',
    'Last Modified',
    'Article Total View',
    'Valuta questo articolo',
    'Rate this article',
  ];
  const noiseHits = [];
  const seenNoise = new Set();
  for (const el of Array.from(mainEl().querySelectorAll('*'))) {
    const txt = norm(el.textContent || '');
    if (txt.length > 400) continue; // salta contenitori grossi (il corpo)
    const label = NOISE_LABELS.find((l) => txt.includes(l));
    if (label) {
      // risali al contenitore "di sezione" più vicino con una classe
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

  // --- Passa 2: campione qualità estrazione ------------------------------------
  const bestBody = BODY_CANDIDATES.map((s) => document.querySelector(s)).find(Boolean) || mainEl();
  const bodyText = norm(bestBody.innerText || '');
  out.extractionSample = {
    bestBodySelector: selOf(bestBody),
    bodyChars: bodyText.length,
    roleMainChars: mainText().length,
    // Se i metadati compaiono qui, il selettore corpo non è abbastanza stretto.
    metadataLeaks: NOISE_LABELS.filter((l) => bodyText.includes(l)),
    head: bodyText.slice(0, 200),
    tail: bodyText.slice(-200),
  };

  // --- Passa 3: sorgenti dei "collegati" ---------------------------------------
  const anchors = Array.from(document.querySelectorAll('a[href]'))
    .map((a) => {
      try {
        return { a, u: new URL(a.href) };
      } catch {
        return null;
      }
    })
    .filter((x) => x && x.u.origin === origin);
  const inBody = (a) => bestBody.contains(a);
  const byType = { article: 0, detail: 0, topic: 0, category: 0, search: 0, home: 0, other: 0 };
  const collegati = [];
  const seenLink = new Set();
  for (const { a, u } of anchors) {
    const type = classify(u);
    byType[type]++;
    const key = u.pathname;
    if ((type === 'article' || type === 'detail') && !seenLink.has(key)) {
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
  // Sezione "Articoli correlati / Related Articles" per heading.
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

  // --- Passa 4: profilo navigazione SPA ----------------------------------------
  if (doSpa && (out.pageType === 'article' || out.pageType === 'detail')) {
    const startUrl = location.href;
    const startId = new URL(startUrl).origin + new URL(startUrl).pathname.replace(/\/+$/, '');
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
      // torna all'hub
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
      if (!backOk) break; // non siamo tornati: fermati per non perderti
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
  } else {
    out.spaNav = {
      skipped: doSpa ? `tipo pagina «${out.pageType}» non navigabile` : 'disabilitato',
    };
  }

  const json = JSON.stringify(out, null, 2);
  console.log('%cRS-MAP', 'font-weight:bold;color:#0a7', '\n' + json);
  try {
    copy(json);
    console.log('%c✓ Copiato nella clipboard — reincollalo in chat.', 'color:#0a7');
  } catch {
    console.log('Clipboard non disponibile: copia manualmente il JSON qui sopra.');
  }
  return out;
})();
