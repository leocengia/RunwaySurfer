// Site profile — le assunzioni per-KB (selettori del contenuto, rumore da
// rimuovere, regole sugli URL) che prima erano cablate in extract.ts per
// Wikipedia. Target reale: la KB Runway su Salesforce Experience Cloud
// (traveler.my.site.com, community Aura). Volutamente PERMISSIVO così le
// fixture di test in stile MediaWiki continuano a passare e il demo su
// Wikipedia resta funzionante.
//
// NB: le pagine Salesforce Aura sono renderizzate lato client. L'estrazione
// dalla pagina CORRENTE legge il DOM già renderizzato nel tab e funziona; il
// follow via fetch (lib/crawl.ts) potrebbe invece ricevere solo lo shell —
// da verificare con docs/recon-kb-2.js prima di adattare follow/tour.

export interface SiteProfile {
  /** Candidati per il content-root, dal più specifico al più generico: vince il primo che matcha. */
  contentSelectors: string[];
  /** Selettori (lista per querySelectorAll) dei nodi da rimuovere prima di leggere il testo. */
  noiseSelectors: string;
  /** Sottostringhe di pathname (minuscole) i cui link non vanno mai seguiti. */
  rejectPathIncludes: string[];
  /** Query param preservati normalizzando l'URL di un link; gli altri vengono rimossi. */
  keepParams: string[];
}

export const siteProfile: SiteProfile = {
  contentSelectors: [
    // KB Salesforce Experience Cloud (community Aura): corpo dell'articolo.
    '.forceCommunityArticleLayout',
    '.cuf-content',
    '[role="main"]', // confermato presente su questa KB dal recon
    // Generico / MediaWiki (demo + test).
    'main',
    'article',
    '#mw-content-text',
    '#content',
  ],
  noiseSelectors: [
    'script',
    'style',
    'nav',
    'footer',
    'aside',
    // Chrome MediaWiki (demo).
    '.navbox',
    '.reference',
    '.mw-editsection',
    // Chrome community Salesforce (dal recon).
    '.websterInnerHeader',
    '.forceCommunityBreadcrumbs',
    '.forceHighlightsPanel',
    '.forceCommunityRecordHeadline',
    '.footer',
  ].join(', '),
  rejectPathIncludes: [
    '/wiki/special:',
    '/wiki/help:',
    '/wiki/category:',
    '/wiki/file:',
    '/wiki/template:',
    '/wiki/talk:',
  ],
  // La KB è multilingua (?language=en_US / it): il resto (es. ?nocache=...) è
  // rumore che genererebbe duplicati dello stesso articolo.
  keepParams: ['language'],
};

/**
 * URL da memorizzare/seguire: fragment via, e solo i query param essenziali
 * (es. ?language=) preservati per fetch/apertura nella lingua giusta.
 */
export function normalizeLinkUrl(url: URL, profile: SiteProfile = siteProfile): string {
  const out = new URL(url.href);
  out.hash = '';
  const kept = new URLSearchParams();
  for (const param of profile.keepParams) {
    const value = out.searchParams.get(param);
    if (value) kept.set(param, value);
  }
  out.search = kept.toString();
  return out.href;
}

/**
 * Identità di una pagina ai fini della deduplica: origin + pathname, ignorando
 * TUTTI i query param e il fragment. Sulla KB Salesforce gli articoli sono
 * identificati dallo slug del path, mentre ?language/?nocache/# sono varianti
 * della stessa pagina — così si collassano (e i self-link con cache-buster
 * combaciano con la pagina corrente).
 */
export function linkIdentity(url: URL): string {
  const path = decodeURIComponent(url.pathname).replace(/\/+$/, '');
  return url.origin + path;
}
