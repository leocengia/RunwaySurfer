/*
 * RunwaySurfer — Recon KB #2 (Salesforce Experience Cloud)
 * =======================================================
 *
 * Il primo recon ha rivelato che la KB è Salesforce Experience Cloud (community
 * Aura), quindi renderizzata lato client. Questo secondo snippet risponde alle
 * due domande decisive che il primo non poteva:
 *
 *   1) Un fetch() dell'articolo restituisce il TESTO dell'articolo, o solo lo
 *      shell dell'app? → decide se "follow"/tour possono leggere altre pagine
 *      via fetch, o se serve un altro meccanismo.
 *   2) Qual è il selettore preciso del CORPO dell'articolo dentro [role=main]?
 *      → migliora l'estrazione (meno rumore = meno token).
 *
 * COME USARLO
 * -----------
 * Sulla stessa pagina-articolo, nella Console DevTools (profilo autenticato):
 * incolla tutto e premi Invio. È ASINCRONO: aspetta il blocco "RS-RECON-2".
 * Reincollami l'output.
 *
 * PER LA RICERCA (manuale, importante): apri il tab "Network", filtra su "aura"
 * o "Fetch/XHR", digita una parola nella barra di ricerca della KB e lancia.
 * Copiami: (a) l'URL della/e request che parte, (b) il Method (GET/POST),
 * (c) per le POST, il "Request Payload" (o Form Data) — bastano le prime righe.
 * Serve a capire se posso interrogare la ricerca via fetch.
 *
 * NOTA: il fetch qui sotto è una GET same-origin con la TUA sessione; non
 * modifica nulla sul server, legge solo. Non invia dati da nessuna parte.
 */
(async () => {
  const out = { url: location.href };

  // --- 1) Il fetch vede il testo dell'articolo? ------------------------------
  // Prendo una "sonda": una frase presa dal corpo attualmente renderizzato,
  // e controllo se compare nell'HTML grezzo restituito dal fetch.
  const main = document.querySelector('[role="main"]') || document.body;
  const liveText = (main.innerText || '').replace(/\s+/g, ' ').trim();
  const probe = liveText.slice(200, 260); // 60 char dal corpo, non dall'header
  try {
    const res = await fetch(location.href, { credentials: 'include' });
    const html = await res.text();
    out.fetch = {
      ok: res.ok,
      status: res.status,
      redirected: res.redirected,
      finalUrl: res.url,
      rawHtmlChars: html.length,
      liveTextChars: liveText.length,
      probe,
      probeFoundInRawHtml: probe.length > 20 ? html.includes(probe) : null,
      // Se il testo NON è nell'HTML grezzo → contenuto client-side → fetch
      // restituisce solo lo shell: follow/tour via fetch non funzionano.
      looksLikeLoginRedirect: /login|sign in|authenticate/i.test(html.slice(0, 4000)),
    };
  } catch (e) {
    out.fetch = { error: String(e) };
  }

  // --- 2) Selettore preciso del corpo dell'articolo --------------------------
  // Cerco, dentro [role=main], il contenitore più piccolo che contiene comunque
  // la maggior parte del testo (il corpo, non l'intera regione con headline).
  const CANDIDATES = [
    '.forceCommunityArticleLayout',
    '.cuf-content',
    '.slds-rich-text-editor__output',
    'lightning-formatted-rich-text',
    '.article-content',
    '[data-target-selection-name]',
    'article',
  ];
  const desc = (el) =>
    el && {
      selector: CANDIDATES.find((s) => el.matches?.(s)) || el.tagName.toLowerCase(),
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      class: el.className ? String(el.className).slice(0, 120) : null,
      chars: (el.innerText || '').length,
    };
  out.articleBodyCandidates = CANDIDATES.filter((s) => document.querySelector(s)).map((s) =>
    desc(document.querySelector(s)),
  );
  // Fallback euristico: il blocco con più testo dentro [role=main].
  let best = null;
  let bestLen = 0;
  main.querySelectorAll('div, section, article').forEach((el) => {
    const len = (el.innerText || '').length;
    if (len > bestLen && len < 0.95 * liveText.length) {
      bestLen = len;
      best = el;
    }
  });
  out.biggestBlockInMain = desc(best);

  const json = JSON.stringify(out, null, 2);
  console.log('%cRS-RECON-2', 'font-weight:bold;color:#0a7', '\n' + json);
  try {
    copy(json);
    console.log('%c✓ Copiato nella clipboard — reincollalo in chat.', 'color:#0a7');
  } catch {
    console.log('Clipboard non disponibile: copia manualmente il JSON qui sopra.');
  }
  return out;
})();
