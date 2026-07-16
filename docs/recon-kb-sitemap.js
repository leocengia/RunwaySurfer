/*
 * RunwaySurfer — Recon KB "SITEMAP" (Fase A0 · scoperta statica)
 * =============================================================
 *
 * Cerca fonti STATICHE e fetchabili per enumerare gli URL della KB: robots.txt
 * e le possibili sitemap. A differenza degli articoli (client-rendered → fetch
 * vede solo lo shell), una sitemap è XML statico servito dalla piattaforma,
 * quindi il fetch la vede davvero. Se esiste, è la scorciatoia più economica per
 * l'inventario URL.
 *
 * COME USARLO
 * -----------
 * Su una pagina qualsiasi di `…/Runway/s/` (profilo autenticato), Console DevTools:
 * `console.clear()` poi incolla tutto. È asincrono: aspetta il blocco verde
 * `RS-SITEMAP` e scarica `rs-sitemap-inventory.json` (+ clipboard). Reincollamelo.
 *
 * NOTA: solo GET same-origin con la tua sessione; non invia nulla, non modifica nulla.
 */
(async () => {
  const origin = location.origin;
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
  const linkIdentity = (u) => u.origin + decodeURIComponent(u.pathname).replace(/\/+$/, '');
  const lastSeg = (u) => decodeURIComponent(u.pathname).split('/').filter(Boolean).pop() || '';

  const CANDIDATES = [
    '/robots.txt',
    '/Runway/s/sitemap.xml',
    '/sitemap.xml',
    '/Runway/sitemap.xml',
    '/s/sitemap.xml',
  ];

  const sniff = (text) => {
    const h = (text || '').slice(0, 300).toLowerCase();
    if (/^\s*user-agent:|^\s*sitemap:/im.test(text || '')) return 'robots';
    if (h.includes('<sitemapindex')) return 'sitemapindex';
    if (h.includes('<urlset')) return 'urlset';
    if (h.includes('<!doctype html') || h.includes('<html')) return 'html-shell';
    if (/login|sign in/i.test(h)) return 'login';
    return 'other';
  };
  const locsOf = (xml) => {
    let locs = [];
    try {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      if (!doc.querySelector('parsererror')) {
        locs = Array.from(doc.querySelectorAll('loc'), (n) => norm(n.textContent));
      }
    } catch {
      /* fallback sotto */
    }
    if (!locs.length) locs = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/gi), (m) => norm(m[1]));
    return locs.filter(Boolean);
  };

  const probes = [];
  const inventory = new Map(); // linkIdentity → record
  const addLoc = (loc, source) => {
    let u;
    try {
      u = new URL(loc, origin);
    } catch {
      return;
    }
    if (u.origin !== origin) return;
    const id = linkIdentity(u);
    const type = classify(u);
    const rec = inventory.get(id) || {
      id,
      url: u.href.split('#')[0],
      type,
      slug: type === 'article' || type === 'topic' ? lastSeg(u) : undefined,
      recordId: type === 'detail' ? lastSeg(u) : undefined,
      sources: [],
    };
    if (!rec.sources.includes(source)) rec.sources.push(source);
    inventory.set(id, rec);
  };

  const seen = new Set();
  const queue = CANDIDATES.map((p) => new URL(p, origin).href);
  let processed = 0;
  while (queue.length && processed < 60) {
    const url = queue.shift();
    if (seen.has(url)) continue;
    seen.add(url);
    processed++;
    try {
      const res = await fetch(url, { credentials: 'include' });
      const text = await res.text();
      const kind = res.ok ? sniff(text) : 'error';
      probes.push({
        url,
        status: res.status,
        contentType: res.headers.get('content-type'),
        bytes: text.length,
        kind,
        head: norm(text).slice(0, 200),
      });
      if (!res.ok) continue;
      if (kind === 'robots') {
        for (const m of text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
          try {
            queue.push(new URL(m[1], origin).href);
          } catch {
            /* skip */
          }
        }
      } else if (kind === 'sitemapindex') {
        for (const loc of locsOf(text)) {
          try {
            queue.push(new URL(loc, origin).href);
          } catch {
            /* skip */
          }
        }
      } else if (kind === 'urlset') {
        for (const loc of locsOf(text)) addLoc(loc, url);
      }
    } catch (e) {
      probes.push({ url, error: String((e && e.message) || e) });
    }
  }

  const records = [...inventory.values()];
  const counts = records.reduce((acc, r) => ((acc[r.type] = (acc[r.type] || 0) + 1), acc), {});
  const out = {
    origin,
    sitemapFound: records.length > 0,
    probes,
    counts,
    totalUrls: records.length,
    sample: records.slice(0, 20),
    inventory: records,
  };

  const json = JSON.stringify(out, null, 2);
  window.RS_SITEMAP_JSON = json;
  console.log(
    '%cRS-SITEMAP',
    'font-weight:bold;color:#0a7',
    '\n' + JSON.stringify({ ...out, inventory: `[${records.length} record]` }, null, 2),
  );
  try {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    a.download = 'rs-sitemap-inventory.json';
    document.documentElement.appendChild(a);
    a.click();
    a.remove();
    console.log('%c✓ Scaricato rs-sitemap-inventory.json', 'color:#0a7');
  } catch (e) {
    console.warn('[RS-SITEMAP] download non riuscito:', e);
  }
  try {
    copy(json);
  } catch {
    /* usa il file o copy(RS_SITEMAP_JSON) */
  }
  return out;
})().catch((e) => console.error('[RS-SITEMAP] errore fatale:', e));
