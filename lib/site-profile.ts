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
  /** Candidati per il content-root TESTO, dal più specifico al più generico: vince il primo che matcha. */
  contentSelectors: string[];
  /** Root per la RACCOLTA LINK (più ampia del content-root testo): cattura anche la sidebar Suggested/Trending. */
  linkRootSelectors: string[];
  /** Selettori (lista per querySelectorAll) dei nodi da rimuovere prima di leggere il testo. */
  noiseSelectors: string;
  /** Sottostringhe di pathname (minuscole) i cui link non vanno mai seguiti. */
  rejectPathIncludes: string[];
  /** Query param preservati normalizzando l'URL di un link; gli altri vengono rimossi. */
  keepParams: string[];
}

export const siteProfile: SiteProfile = {
  // TESTO: sulla KB Aura il corpo pulito è `c-runway-article-viewer` (esclude
  // header/metadati, sidebar Suggested/Trending, footer). Confermato su fixture
  // reale 2026-07-21; `[role="main"]` (che include le 3 colonne) resta come
  // fallback. `.forceCommunityArticleLayout`/`.cuf-content` rimossi: assenti su
  // tutte le 5 pagine campionate.
  contentSelectors: [
    'c-runway-article-viewer',
    '[data-region-name="content"]',
    '[role="main"]',
    // Generico / MediaWiki (demo + test).
    'main',
    'article',
    '#mw-content-text',
    '#content',
  ],
  // LINK: root più ampia del testo, così Suggested/Trending (colonna 4-of-12,
  // fuori dal viewer) e i cross-link del corpo entrano tutti nella scoperta.
  linkRootSelectors: ['[role="main"]', 'main', 'article', '#mw-content-text', '#content'],
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
    // Chrome community Salesforce (dal recon + fixture): header, sidebar, footer,
    // pill dei topic — rumore-testo quando il root ripiega su [role="main"].
    '.websterInnerHeader',
    '.forceCommunityBreadcrumbs',
    '.forceHighlightsPanel',
    '.forceCommunityRecordHeadline',
    '.comm-content-header',
    '.comm-content-footer',
    '[data-region-name="sidebar"]',
    '.topic-section',
    '.footer',
  ].join(', '),
  rejectPathIncludes: [
    // KB Salesforce: pagine-lista, non articoli → non seguirle.
    '/s/topic/',
    '/s/global-search/',
    '/s/categor',
    // MediaWiki (demo).
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

/**
 * Lingua di **retrieval**: gli articoli si leggono in **inglese**, dove il
 * contenuto è popolato e la ricerca della KB funziona (la ricerca in italiano
 * no). La risposta all'agente resta comunque in italiano: la genera il backend.
 * La sitemap indicizza gli articoli in lingue miste (~1 su 5 non è `en_US`):
 * senza questa normalizzazione la navigazione B2 aprirebbe la variante tedesca/
 * coreana/… di quegli articoli.
 */
export const RETRIEVAL_LANGUAGE = 'en_US';

/**
 * Forza `?language=en_US` su un URL KB (assoluto), preservando path e resto
 * dei param. Su URL non parsabili ritorna l'input invariato. `linkIdentity`
 * ignora comunque il param, quindi la deduplica non cambia.
 */
export function withRetrievalLanguage(rawUrl: string, language = RETRIEVAL_LANGUAGE): string {
  try {
    const url = new URL(rawUrl);
    url.searchParams.set('language', language);
    return url.href;
  } catch {
    return rawUrl;
  }
}
