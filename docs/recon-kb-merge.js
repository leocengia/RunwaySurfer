/*
 * RunwaySurfer — Recon KB "MERGE" (Fase A3 · consolidamento inventario)
 * ====================================================================
 *
 * Unisce i file scaricati dalle Passe A0-A2 (rs-sitemap-inventory.json,
 * rs-topic-*.json, l'output di recon-kb-search.js) in un unico inventario
 * deduplicato per identità di path, con la tassonomia topic↔articolo.
 *
 * COME USARLO
 * -----------
 * Puoi eseguirlo su una pagina QUALSIASI (anche about:blank). Console DevTools:
 * incolla tutto → compare un selettore file: scegli TUTTI i JSON scaricati
 * (Ctrl/Cmd per selezione multipla). Scarica `rs-kb-inventory.jsonl` + un
 * `rs-kb-summary.json`. Reincollami il summary (e, se piccolo, il jsonl).
 *
 * NOTA: gira interamente nel browser, nessun invio a server.
 */
(async () => {
  const linkIdentity = (u) => u.origin + decodeURIComponent(u.pathname).replace(/\/+$/, '');
  const idOf = (url) => {
    try {
      return linkIdentity(new URL(url));
    } catch {
      return null;
    }
  };

  const inv = new Map(); // id → record
  const upsert = (rec, source, topics) => {
    const id = rec.id || idOf(rec.url);
    if (!id) return;
    const cur = inv.get(id) || {
      id,
      url: (rec.url || '').split('#')[0],
      type: rec.type,
      title: '',
      slug: rec.slug,
      recordId: rec.recordId,
      topics: [],
      sources: [],
    };
    if (rec.title && rec.title.length > cur.title.length) cur.title = rec.title;
    if (rec.lastmod) cur.lastmod = rec.lastmod;
    for (const s of [].concat(source || [], rec.sources || []))
      if (s && !cur.sources.includes(s)) cur.sources.push(s);
    for (const t of [].concat(topics || [], rec.topics || [])) {
      if (t && t.id && !cur.topics.some((x) => x.id === t.id))
        cur.topics.push({ id: t.id, name: t.name || '' });
    }
    inv.set(id, cur);
  };

  const ingest = (data, fname) => {
    if (!data || typeof data !== 'object') return;
    if (Array.isArray(data.inventory)) {
      for (const r of data.inventory) upsert(r, 'sitemap');
    } else if (data.topic) {
      const t = { id: data.topic.id, name: data.topic.name };
      for (const a of data.articles || [])
        upsert(a, `topic:${t.id || data.topic.slug || fname}`, [t]);
      for (const c of data.childTopics || [])
        if (c.url) upsert({ url: c.url, type: 'topic', title: c.name, slug: c.id }, 'topic-child');
    } else if (Array.isArray(data.results)) {
      for (const r of data.results)
        upsert({ url: r.href, type: r.type, title: r.text }, `search:${data.query || fname}`);
    }
  };

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.multiple = true;
  input.style.cssText =
    'position:fixed;z-index:2147483647;top:12px;left:12px;padding:8px;background:#0b1f3a;color:#fff';
  document.documentElement.appendChild(input);
  console.log(
    '%c[RS-MERGE] Seleziona i JSON scaricati (multi-selezione).',
    'color:#0a7;font-weight:bold',
  );

  const files = await new Promise((resolve) => {
    input.addEventListener('change', () => resolve([...(input.files || [])]), { once: true });
  });
  input.remove();

  for (const f of files) {
    try {
      ingest(JSON.parse(await f.text()), f.name);
    } catch (e) {
      console.warn(`[RS-MERGE] file ignorato ${f.name}:`, e);
    }
  }

  const records = [...inv.values()];
  const counts = records.reduce((a, r) => ((a[r.type] = (a[r.type] || 0) + 1), a), {});
  const topics = new Map();
  for (const r of records)
    for (const t of r.topics) {
      const e = topics.get(t.id) || { id: t.id, name: t.name, articleCount: 0 };
      if (t.name && !e.name) e.name = t.name;
      e.articleCount++;
      topics.set(t.id, e);
    }
  const summary = {
    filesMerged: files.length,
    totalRecords: records.length,
    counts,
    topics: [...topics.values()].sort((a, b) => b.articleCount - a.articleCount),
    withoutTopic: records.filter(
      (r) => (r.type === 'article' || r.type === 'detail') && !r.topics.length,
    ).length,
  };

  const jsonl = records.map((r) => JSON.stringify(r)).join('\n');
  const dl = (name, text, mime) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime }));
    a.download = name;
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
  };
  dl('rs-kb-inventory.jsonl', jsonl, 'application/x-ndjson');
  dl('rs-kb-summary.json', JSON.stringify(summary, null, 2), 'application/json');
  window.RS_KB_SUMMARY = JSON.stringify(summary, null, 2);
  console.log('%cRS-MERGE', 'font-weight:bold;color:#0a7', '\n' + JSON.stringify(summary, null, 2));
  try {
    copy(window.RS_KB_SUMMARY);
  } catch {
    /* usa i file scaricati */
  }
  return summary;
})().catch((e) => console.error('[RS-MERGE] errore fatale:', e));
