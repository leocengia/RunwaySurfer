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

/**
 * Ripara le label con mojibake (14 articoli). `Compensation Combine credit
 * couponsâ HCOM` nasce da un em-dash che **Salesforce** ha mal codificato quando
 * ha creato lo slug: l'URL reale contiene `%C3%A2`, quindi `u` e `s` sono
 * corretti così come sono e NON vanno toccati — riscriverli romperebbe il link.
 * Si pulisce solo la label, che è ciò che finisce nello scoring, nel prompt del
 * reranker e sotto gli occhi dell'agente.
 *
 * `â` in questa KB è sempre un separatore (em-dash o virgoletta curva) mal
 * decodificato, e `œ` il resto di una virgoletta di apertura (`â œHojas`) —
 * quindi diventano spazio. Se un giorno la KB avesse uno slug francese con una
 * `â` legittima, il costo è una lettera in meno in una label: mai un URL rotto.
 *
 * Allineata a `cleanLabel` in docs/build-kb-index.mjs, così una rigenerazione
 * dell'asset produce label già pulite.
 */
export function cleanKbLabel(raw: string): string {
  return raw
    .replace(/â\s*œ?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

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
  return index.articles.map((a) => ({
    url: withRetrievalLanguage(a.u),
    text: cleanKbLabel(a.l),
  }));
}
