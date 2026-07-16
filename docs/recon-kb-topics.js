/*
 * RunwaySurfer — Recon KB "TOPICS" (Fase A1 · sweep dei topic)
 * ===========================================================
 *
 * Le pagine topic (`/Runway/s/topic/<id>/<slug>`) elencano gli articoli di quel
 * topic. Raccogliendole si ottiene la tassonomia topic↔articolo e gran parte
 * dell'inventario, senza aprire i singoli articoli. Da eseguire su OGNI pagina
 * topic (parti dalla home `/Runway/s/` o dal catalogo, poi segui i childTopics).
 *
 * COME USARLO
 * -----------
 * Su una pagina topic (o sulla home), Console DevTools nel profilo autenticato:
 * `console.clear()` poi incolla tutto. È ASINCRONO: scrolla e clicca "load more"
 * per far renderizzare tutti gli articoli (~fino a qualche decina di secondi su
 * topic grandi). Aspetta `RS-TOPIC`, scarica `rs-topic-<id>.json` (+ clipboard),
 * reincollamelo. Ripeti sui `childTopics` non ancora visitati.
 *
 * NOTA: scrolla e clicca solo i "carica altro" della lista (nessuna navigazione,
 * nessuna modifica al server); legge il DOM renderizzato.
 */
(async () => {
  const origin = location.origin;
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
  const mainEl = () => document.querySelector('[role="main"]') || document.body;
  const inError = (a) => {
    try {
      return !!a.closest('#auraError, .auraErrorBox');
    } catch {
      return false;
    }
  };

  // Identità del topic dalla URL (se siamo su una pagina topic).
  const segs = decodeURIComponent(location.pathname).split('/').filter(Boolean);
  const ti = segs.indexOf('topic');
  const topic = {
    id: ti >= 0 ? segs[ti + 1] || null : null,
    slug: ti >= 0 ? segs[ti + 2] || null : null,
    name: norm(mainEl().querySelector('h1')?.textContent || document.title.split(/[|—-]/)[0]),
    url: location.href,
    pageType: classify(new URL(location.href)),
  };

  // Raccolta INCREMENTALE (resiste alle liste virtualizzate).
  const articles = new Map(); // id → {url,id,type,title,slug,recordId}
  const childTopics = new Map();
  const selfId = linkIdentity(new URL(location.href));
  const harvest = () => {
    for (const a of Array.from(mainEl().querySelectorAll('a[href]'))) {
      if (inError(a)) continue;
      let u;
      try {
        u = new URL(a.href);
      } catch {
        continue;
      }
      if (u.origin !== origin) continue;
      const type = classify(u);
      const id = linkIdentity(u);
      if (id === selfId) continue;
      const text = norm(a.textContent).slice(0, 90);
      if ((type === 'article' || type === 'detail') && !articles.has(id)) {
        articles.set(id, {
          url: u.href.split('#')[0],
          id,
          type,
          title: text,
          slug: type === 'article' ? lastSeg(u) : undefined,
          recordId: type === 'detail' ? lastSeg(u) : undefined,
        });
      } else if (type === 'topic' && !childTopics.has(id)) {
        childTopics.set(id, {
          id: u.pathname.split('/').filter(Boolean)[2] || null,
          url: u.href.split('#')[0],
          name: text,
        });
      }
    }
  };

  // Attesa render iniziale: conteggio stabile per 2 poll.
  let stablePolls = 0;
  for (let i = 0; i < 120 && stablePolls < 2; i++) {
    await sleep(100);
    const before = articles.size;
    harvest();
    stablePolls = articles.size === before && articles.size > 0 ? stablePolls + 1 : 0;
  }

  // Paginazione: scroll-loop + "load more", con raccolta incrementale.
  let pagination = { mechanism: 'none', iterations: 0, exhausted: true };
  const grow = async () => {
    const before = articles.size;
    await sleep(600);
    harvest();
    return articles.size > before;
  };
  // scroll
  for (let i = 0; i < 40; i++) {
    window.scrollTo(0, document.body.scrollHeight);
    const grew = await grow();
    if (grew) {
      pagination = { mechanism: 'scroll', iterations: i + 1, exhausted: false };
    } else if (pagination.mechanism === 'scroll') {
      pagination.exhausted = true;
      break;
    } else break;
    if (i === 39) pagination.exhausted = false;
  }
  // "load more" button
  const findMore = () =>
    Array.from(
      mainEl().querySelectorAll('button, a[role="button"], lightning-button, [role="button"]'),
    ).find((b) =>
      /load more|show more|view more|mostra altr|carica altr|altri/i.test(norm(b.textContent)),
    );
  for (let i = 0; i < 40; i++) {
    const btn = findMore();
    if (!btn) break;
    btn.click();
    const grew = await grow();
    pagination = { mechanism: 'load-more', iterations: i + 1, exhausted: !grew };
    if (!grew) break;
    if (i === 39) pagination.exhausted = false;
  }

  const arr = [...articles.values()];
  const out = {
    topic,
    counts: {
      articles: arr.filter((a) => a.type === 'article').length,
      details: arr.filter((a) => a.type === 'detail').length,
      childTopics: childTopics.size,
    },
    pagination,
    articles: arr,
    childTopics: [...childTopics.values()],
  };

  const json = JSON.stringify(out, null, 2);
  window.RS_TOPIC_JSON = json;
  console.log(
    '%cRS-TOPIC',
    'font-weight:bold;color:#0a7',
    '\n' + JSON.stringify({ ...out, articles: `[${arr.length}]` }, null, 2),
  );
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = `rs-topic-${topic.id || 'home'}.json`;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    console.log('%c✓ Scaricato rs-topic-*.json', 'color:#0a7');
  } catch (e) {
    console.warn('[RS-TOPIC] download non riuscito:', e);
  }
  try {
    copy(json);
  } catch {
    /* usa il file o copy(RS_TOPIC_JSON) */
  }
  return out;
})().catch((e) => console.error('[RS-TOPIC] errore fatale:', e));
