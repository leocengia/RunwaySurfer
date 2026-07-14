/*
 * RunwaySurfer — Recon KB #3 (navigazione SPA + ricerca)
 * =====================================================
 *
 * Direzione scelta: tour a NAVIGAZIONE SPA (niente fetch: si naviga la SPA
 * Salesforce e si legge il DOM renderizzato). Questo recon conferma le tre
 * cose che il driver dà per scontate e che vanno verificate prima di scriverlo:
 *
 *   A) Cliccare un link interno /s/ fa una route SPA (senza full reload) e il
 *      content-script sopravvive? Quanto ci mette a renderizzare? history.back()
 *      riporta indietro?  → è ciò che rende possibile l'intero tour SPA.
 *   B) Che link ci sono davvero in pagina? (articolo vs topic vs altro) → decide
 *      se l'hub-and-spoke sui link di pagina ha senso o se serve la ricerca.
 *   C) Come sono strutturati i risultati di ricerca (per poterli leggere e
 *      navigare) → parte manuale, vedi sotto.
 *
 * COME USARLO — PARTE A+B (automatica)
 * ------------------------------------
 * Su una pagina-articolo, Console DevTools (profilo autenticato): incolla tutto
 * e Invio. È ASINCRONO e NAVIGA: clicca un link, misura, poi torna indietro da
 * solo (~10s totali). Non fare altro mentre gira. Reincollami "RS-RECON-3".
 *
 * COME USARLO — PARTE C (ricerca, manuale)
 * ----------------------------------------
 * 1) Digita una parola nella barra di ricerca della KB e lancia la ricerca.
 * 2) Quando compaiono i RISULTATI, ri-esegui QUESTO stesso script sulla pagina
 *    dei risultati: la sezione "linkTaxonomy" elencherà i link dei risultati con
 *    il loro container, così ricavo i selettori per leggerli e navigarli.
 *    (Sulla pagina risultati puoi ignorare la parte di navigazione.)
 *
 * NOTA: la Parte A naviga usando la TUA sessione e poi torna indietro; non invia
 * dati da nessuna parte, non modifica nulla sul server.
 */
(async () => {
  const origin = location.origin;
  const sig = () =>
    (document.querySelector('[role="main"]')?.innerText || '').replace(/\s+/g, ' ').trim();
  const classify = (u) => {
    const p = u.pathname;
    if (/\/s\/article\//.test(p)) return 'article';
    if (/\/s\/topic\//.test(p)) return 'topic';
    if (/\/s\/?$/.test(p)) return 'home';
    return 'other';
  };
  const containerOf = (a) => {
    let n = a.parentElement;
    for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
      if (n.className && String(n.className).trim()) {
        return (
          n.tagName.toLowerCase() +
          '.' +
          String(n.className).split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        );
      }
    }
    return null;
  };

  // --- B) Tassonomia dei link interni in pagina --------------------------------
  const anchors = [...document.querySelectorAll('a[href]')].filter((a) => {
    try {
      return new URL(a.href).origin === origin;
    } catch {
      return false;
    }
  });
  const byType = { article: 0, topic: 0, home: 0, other: 0 };
  const sample = [];
  const seen = new Set();
  for (const a of anchors) {
    const u = new URL(a.href);
    const type = classify(u);
    byType[type]++;
    const key = u.pathname;
    if (!seen.has(key) && sample.length < 15) {
      seen.add(key);
      sample.push({
        type,
        href: a.href,
        text: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
        container: containerOf(a),
      });
    }
  }
  const out = { url: location.href, linkTaxonomy: { counts: byType, sample } };

  // --- A) Test navigazione SPA -------------------------------------------------
  const target =
    anchors
      .map((a) => ({ a, u: new URL(a.href) }))
      .find(
        (x) => classify(x.u) === 'article' && x.u.pathname !== new URL(location.href).pathname,
      ) ||
    anchors
      .map((a) => ({ a, u: new URL(a.href) }))
      .find((x) => ['article', 'topic'].includes(classify(x.u)));

  if (!target) {
    out.spaNav = { skipped: 'nessun link articolo/topic navigabile in pagina' };
  } else {
    const startUrl = location.href;
    const startSig = sig();
    window.__rsReconMark = 'alive';
    let unloaded = false;
    const onUnload = () => (unloaded = true);
    addEventListener('beforeunload', onUnload, { once: true });

    const t0 = performance.now();
    target.a.click();
    let renderMs = null;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (location.href !== startUrl && sig() !== startSig && sig().length > 50) {
        renderMs = Math.round(performance.now() - t0);
        break;
      }
    }
    out.spaNav = {
      clickedType: classify(target.u),
      clickedHref: target.a.href,
      urlChanged: location.href !== startUrl,
      newUrl: location.href,
      renderMs,
      // Se il mark globale sopravvive e non c'è unload → route SPA, niente reload:
      // il content-script dell'estensione sopravvive.
      fullReload: unloaded || typeof window.__rsReconMark === 'undefined',
      contentScriptWouldSurvive: !unloaded && typeof window.__rsReconMark !== 'undefined',
    };
    removeEventListener('beforeunload', onUnload);

    // Ritorno alla pagina di partenza (hub) via history.back().
    const beforeBack = location.href;
    history.back();
    let backOk = false;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (location.href !== beforeBack && sig().length > 50) {
        backOk = true;
        break;
      }
    }
    out.spaNav.backRestored = backOk;
    out.spaNav.backUrl = location.href;
    out.spaNav.backToStart =
      location.href.split('#')[0].split('?')[0] === startUrl.split('#')[0].split('?')[0];
  }

  const json = JSON.stringify(out, null, 2);
  console.log('%cRS-RECON-3', 'font-weight:bold;color:#0a7', '\n' + json);
  try {
    copy(json);
    console.log('%c✓ Copiato nella clipboard — reincollalo in chat.', 'color:#0a7');
  } catch {
    console.log('Clipboard non disponibile: copia manualmente il JSON qui sopra.');
  }
  return out;
})();
