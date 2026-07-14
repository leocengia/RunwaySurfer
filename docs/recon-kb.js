/*
 * RunwaySurfer — Recon della KB (Fase 0)
 * =====================================
 *
 * Scopo: capire com'è fatta la knowledge base reale SENZA che io possa
 * raggiungerla (serve il tuo profilo Chrome autenticato + la rete interna).
 * L'output di questo script mi dice come tarare estrazione del testo, filtro
 * dei link e — se esiste un endpoint interrogabile — l'integrazione con la
 * ricerca nativa del sito.
 *
 * COME USARLO
 * -----------
 * 1. Apri la KB nel profilo Chrome giusto (quello loggato al sito) e vai su un
 *    ARTICOLO tipico (non la home): una pagina rappresentativa di quelle che
 *    l'estensione dovrà leggere.
 * 2. Apri DevTools (F12) → tab "Console".
 * 3. Se compare "Warning: Don't paste code..." digita `allow pasting` e Invio.
 * 4. Incolla TUTTO questo file e premi Invio.
 * 5. Il risultato viene stampato in console E copiato nella clipboard
 *    (compatibilmente col browser). Reincollamelo qui in chat.
 * 6. Ripeti su una 2ª pagina di tipo diverso (es. una categoria/indice), così
 *    vedo se i selettori reggono su layout differenti.
 *
 * PER LA RICERCA (importante): apri il tab "Network" di DevTools, digita una
 * parola nella barra di ricerca della KB e lancia la ricerca. Guarda la
 * richiesta che parte (di solito una chiamata a /search, /api/..., o simili):
 * copiami l'URL completo della request e un estratto della risposta (le prime
 * righe di JSON o HTML). Serve a capire se posso interrogare la ricerca via
 * fetch e leggere solo i top risultati (grosso risparmio di token).
 *
 * NOTA: legge solo il DOM già renderizzato. Non invia nulla da nessuna parte,
 * non modifica la pagina, non tocca cookie o sessione.
 */
(() => {
  const here = new URL(location.href);

  // Candidati per il "content root": il contenitore del testo dell'articolo.
  const CONTENT_SELECTORS = [
    'main',
    'article',
    '#mw-content-text',
    '#content',
    '[role="main"]',
    '.article-body',
    '.wiki-content',
    '#main-content',
  ];

  // Euristica indipendente dai selettori: il blocco con più testo è quasi
  // sempre il corpo dell'articolo. Serve a proporre un selettore migliore se
  // nessuno di quelli sopra è adatto.
  let best = null;
  let bestLen = 0;
  for (const el of document.querySelectorAll('main, article, section, div')) {
    const len = (el.innerText || '').length;
    // <200k per scartare wrapper giganti (tutto il body) e tenere il vero corpo.
    if (len > bestLen && len < 200000) {
      bestLen = len;
      best = el;
    }
  }
  const describe = (el) =>
    el
      ? {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          class: el.className ? String(el.className) : null,
          chars: (el.innerText || '').length,
        }
      : null;

  // Link interni (same-origin): quanti sono, quanti hanno una query-string.
  // Oggi l'estensione SCARTA ogni URL con "?" (extract.ts): se la KB usa
  // ?pageId=/?id= per identificare gli articoli, va disattivato quel filtro.
  const internalLinks = [...document.querySelectorAll('a[href]')]
    .map((a) => a.href)
    .filter((h) => {
      try {
        return new URL(h).origin === here.origin;
      } catch {
        return false;
      }
    });
  const uniqueLinks = [...new Set(internalLinks)];

  // Barra/endpoint di ricerca in pagina.
  const searchInput = document.querySelector(
    'input[type=search], [role=search] input, form[action*="search" i] input',
  );
  const searchForm = searchInput ? searchInput.closest('form') : null;

  // Rumore da rimuovere prima di estrarre il testo (nav/aside/header/footer):
  // riporto le classi così taro la lista di noise-removal per questa KB.
  const noise = [...document.querySelectorAll('nav, aside, header, footer')]
    .map((e) => {
      const cls = e.className
        ? '.' + String(e.className).split(/\s+/).filter(Boolean).slice(0, 2).join('.')
        : '';
      return e.tagName.toLowerCase() + cls;
    })
    .slice(0, 20);

  const out = {
    url: location.href,
    origin: here.origin,
    lang: document.documentElement.lang || null,
    title: document.title,
    // Content root
    selectorsMatched: CONTENT_SELECTORS.filter((s) => document.querySelector(s)),
    biggestTextBlock: describe(best),
    // Link
    internalLinkCount: internalLinks.length,
    linksWithQueryString: internalLinks.filter((h) => new URL(h).search).length,
    sampleLinks: uniqueLinks.slice(0, 15),
    // Ricerca
    search: searchInput
      ? {
          inputName: searchInput.name || null,
          formAction: searchForm ? searchForm.getAttribute('action') : null,
          formMethod: searchForm ? searchForm.getAttribute('method') || 'get' : null,
          placeholder: searchInput.placeholder || null,
        }
      : null,
    // Rumore
    noiseContainers: noise,
  };

  const json = JSON.stringify(out, null, 2);
  console.log('%cRS-RECON', 'font-weight:bold;color:#0a7', '\n' + json);
  try {
    // `copy` esiste solo nella console DevTools.
    copy(json);
    console.log('%c✓ Copiato nella clipboard — reincollalo in chat.', 'color:#0a7');
  } catch {
    console.log('Clipboard non disponibile: copia manualmente il JSON qui sopra.');
  }
  return out;
})();
