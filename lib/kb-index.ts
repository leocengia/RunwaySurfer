// Indice KB leggero (Fase E4). Asset statico bundle-ato (lib/kb-index.json,
// generato da docs/build-kb-index.mjs a partire dalla sitemap): l'elenco degli
// articoli della KB con URL + slug + label leggibile. Consultato in locale, a
// COSTO-TOKEN ZERO, per proporre l'articolo giusto anche quando NON è linkato
// dalla pagina corrente — colmando il limite di extractInternalLinks, che vede
// solo i link presenti nel DOM. I candidati emergono come KbLink sintetici e
// vengono ordinati dallo stesso scorer dei link reali (pickRelevantLinks),
// così non c'è una seconda logica di rilevanza da mantenere.
import type { KbLink } from './outcome';
import { withRetrievalLanguage } from './site-profile';
import indexData from './kb-index.json';

interface KbIndexRecord {
  /** URL dell'articolo (normalizzato). */
  u: string;
  /** slug. */
  s: string;
  /** label leggibile derivata dallo slug. */
  l: string;
}

interface KbIndexFile {
  origin: string;
  count: number;
  articles: KbIndexRecord[];
}

const index = indexData as KbIndexFile;

/** Numero di articoli nell'indice (0 se l'asset è il placeholder). */
export function kbIndexSize(): number {
  return index.articles.length;
}

/**
 * Candidati KB-wide come KbLink sintetici, così lo scorer esistente li ordina
 * con gli stessi pesi dei link reali. Lo slug entra sia come `text` (label
 * leggibile) sia — implicitamente — nell'URL, dove lo scorer già lo pesa. Non
 * hanno `order` (verrà usato il fallback deterministico dello scorer).
 *
 * L'URL è normalizzato alla lingua di retrieval (`en_US`): la sitemap indicizza
 * gli articoli in lingue miste, ma noi leggiamo l'inglese (dove il contenuto è
 * popolato). Così sia il candidato mostrato come fonte sia la navigazione B2
 * puntano alla variante inglese, non a quella tedesca/coreana della sitemap.
 */
export function kbIndexAsLinks(): KbLink[] {
  return index.articles.map((a) => ({ url: withRetrievalLanguage(a.u), text: a.l }));
}
