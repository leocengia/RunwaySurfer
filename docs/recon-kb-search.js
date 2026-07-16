/*
 * RunwaySurfer — Recon KB "SEARCH" (Passa 5)
 * ==========================================
 *
 * Mappa la RICERCA della KB (/s/global-search): come si innescano i risultati,
 * quando renderizzano, la struttura dei result-item (selettori) e le forme degli
 * URL-risultato. Serve ad abilitare una futura modalità "search-driven" che trova
 * articoli in tutta la KB, non solo i cross-link della pagina.
 *
 * MODO CONSIGLIATO (affidabile)
 * -----------------------------
 * 1) Digita una parola nella barra di ricerca della KB e lancia la ricerca a mano.
 * 2) Quando compaiono i RISULTATI, incolla questo script nella Console e Invio.
 *    Lo script rileva di essere su una pagina risultati e dumpa la struttura.
 *
 * MODO AUTOMATICO (best-effort)
 * -----------------------------
 * Su una pagina qualsiasi con la barra di ricerca, imposta prima:
 *   window.RS_SEARCH_Q = 'rimborso'      // query da cercare (default: 'test')
 * poi incolla lo script: proverà a compilare e inviare la ricerca, attendere il
 * render dei risultati e dumparli. Se non parte, usa il modo consigliato.
 *
 * NOTA: usa la TUA sessione, legge soltanto, non invia nulla a nessuno.
 */
(async () => {
  const origin = location.origin;
  const query = window.RS_SEARCH_Q || 'test';
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const onResults = () => /\/s\/global-search\//.test(location.pathname);
  const mainEl = () => document.querySelector('[role="main"]') || document.body;
  const selOf = (el) => {
    if (!el) return null;
    const cls = el.className
      ? '.' + String(el.className).split(/\s+/).filter(Boolean).slice(0, 3).join('.')
      : '';
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls;
  };
  const ancestorWithClass = (el, up) => {
    let n = el;
    for (let i = 0; i < up && n?.parentElement; i++) n = n.parentElement;
    return n;
  };
  const resultAnchors = () =>
    Array.from(mainEl().querySelectorAll('a[href]'))
      .map((a) => {
        try {
          return { a, u: new URL(a.href) };
        } catch {
          return null;
        }
      })
      .filter((x) => x && x.u.origin === origin && /\/s\/(article|detail)\//.test(x.u.pathname));

  const out = { url: location.href, query };

  // --- Innesco (solo se non siamo già sui risultati) ---------------------------
  if (!onResults()) {
    const input = document.querySelector(
      'input[type=search], [role=search] input, input[placeholder*="search" i], input[placeholder*="cerc" i]',
    );
    out.trigger = { inputFound: !!input, inputSelector: selOf(input) };
    if (input) {
      input.focus();
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      if (setter) {
        setter.call(input, query);
      } else {
        input.value = query;
      }
      input.dispatchEvent(new Event('input', { bubbles: true }));
      for (const type of ['keydown', 'keypress', 'keyup']) {
        input.dispatchEvent(
          new KeyboardEvent(type, {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
          }),
        );
      }
      const form = input.closest('form');
      if (form) form.requestSubmit?.();
    }
    // attende che la route diventi /global-search/ e che appaiano risultati
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (onResults() && resultAnchors().length > 0) break;
    }
    out.trigger.reachedResults = onResults();
    out.trigger.finalUrl = location.href;
  } else {
    out.trigger = { note: 'già sulla pagina risultati (ricerca lanciata a mano)' };
  }

  // --- Attende il render dei risultati (client-rendered, async) ----------------
  let results = [];
  for (let i = 0; i < 120; i++) {
    results = resultAnchors();
    if (results.length > 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }

  // --- Dump struttura risultati ------------------------------------------------
  const seen = new Set();
  const items = [];
  for (const { a, u } of results) {
    const key = u.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    // contenitore "item" plausibile: 2-3 livelli sopra l'anchor
    const item = ancestorWithClass(a, 3);
    items.push({
      text: norm(a.textContent).slice(0, 80),
      href: a.href,
      type: /\/s\/article\//.test(u.pathname) ? 'article' : 'detail',
      anchorSelector: selOf(a),
      itemContainer: selOf(item),
      itemSnippet: norm(item?.innerText).slice(0, 200),
    });
  }
  out.resultsUrl = location.href;
  out.resultsPathPattern = location.pathname.replace(/\/[^/]+$/, '/<query>');
  out.resultCount = items.length;
  out.results = items.slice(0, 12);
  // contenitori distinti (per capire il selettore della lista risultati)
  out.distinctItemContainers = [...new Set(items.map((r) => r.itemContainer))];
  // Totale risultati dichiarato dalla KB (per il cross-check di copertura, Fase A3):
  // cerca un pattern tipo "123 results" / "123 risultati" nel testo di [role=main].
  const mainTxt = norm(mainEl().innerText || mainEl().textContent || '');
  const totalMatch = mainTxt.match(/([\d.,]+)\s*(results?|risultati?|articles?|articoli?)/i);
  out.resultTotalText = totalMatch ? totalMatch[0] : null;
  out.resultTotal = totalMatch ? Number(totalMatch[1].replace(/[.,]/g, '')) : null;

  const json = JSON.stringify(out, null, 2);
  console.log('%cRS-SEARCH', 'font-weight:bold;color:#0a7', '\n' + json);
  try {
    copy(json);
    console.log('%c✓ Copiato nella clipboard — reincollalo in chat.', 'color:#0a7');
  } catch {
    console.log('Clipboard non disponibile: copia manualmente il JSON qui sopra.');
  }
  return out;
})();
