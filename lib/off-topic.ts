// La pagina aperta risponde alla domanda, o l'agente sta chiedendo altro?
//
// È il limite d'uso più concreto della sidebar: la modalità di default legge SOLO
// la pagina corrente, quindi una domanda su un tema diverso da quello dell'articolo
// aperto produce una risposta strutturalmente sbagliata. Nell'uso quotidiano è il
// caso normale, non l'eccezione: un agente ha aperto un articolo e poi gli arriva
// la telefonata su un altro argomento.
//
// Qui si decide solo SE allargare la ricerca a tutta la KB. Quali articoli leggere
// lo sceglie il reranker AI (`/rank`).
//
// Logica pura, nessun DOM: testabile offline.
import { pickRelevantLinks } from './crawl';
import { expandTerm } from './kb-vocab';
import type { KbLink, KbPage } from './outcome';

/**
 * Quota minima dei termini della domanda che devono comparire nella pagina perché
 * la si consideri sul tema. Volutamente bassa: un allargamento di troppo costa una
 * ricerca, un "è pertinente" sbagliato costa una risposta sbagliata.
 */
const MIN_TERM_COVERAGE = 0.34;

/** Pseudo-URL per riconoscere la pagina corrente fra i vincitori dello scoring. */
const CURRENT_PAGE_MARK = 'rs-current-page';

/** Parole della query abbastanza lunghe da essere discriminanti. */
function baseTerms(query: string): string[] {
  return Array.from(
    new Set(
      query
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length >= 4),
    ),
  );
}

/**
 * Quanta parte della domanda compare nel titolo o nel testo della pagina. Non
 * misura la qualità della risposta: solo se l'argomento è lo stesso.
 *
 * Il denominatore sono le parole che l'agente ha DAVVERO scritto. Un termine
 * conta come coperto se compare nella pagina, oppure se compare una delle SUE
 * espansioni — dato che la KB è in inglese e "rimborso" può apparire solo come
 * "refund".
 *
 * «Delle sue» è la parte importante, e prima non era così: il credito si
 * calcolava sull'unione delle espansioni di tutta la query e si accreditava a
 * qualunque termine ancora scoperto. Bastava quindi che la pagina contenesse una
 * parola legata a UNA parola della domanda perché risultassero coperte anche le
 * altre. Il caso concreto: la domanda «regole franchigia baggage allowance» su
 * un articolo intitolato «Refund policy» — il credito di `regole`→`policies`
 * copriva i termini sui bagagli, e la domanda risultava in tema. Ora ogni
 * termine risponde solo per sé (vedi `expandTerm`).
 */
export function pageCoverage(page: Pick<KbPage, 'title' | 'text'>, query: string): number {
  const base = baseTerms(query);
  if (!base.length) return 1; // niente su cui giudicare: non allargare
  const haystack = `${page.title} ${page.text}`.toLowerCase();
  const covered = base.filter(
    (term) =>
      haystack.includes(term) ||
      expandTerm(term).some((expansion) => haystack.includes(expansion)),
  );
  return covered.length / base.length;
}

/**
 * `true` se conviene allargare la ricerca a tutta la Knowledge Base.
 *
 * Due segnali indipendenti, entrambi necessari per non allargare a vuoto:
 *  1. la pagina aperta copre pochi termini della domanda;
 *  2. fra i candidati ce n'è almeno uno che la BATTE secondo lo stesso scorer
 *     usato per selezionare i link (la pagina entra in gara come pseudo-link, così
 *     il confronto è fra grandezze omogenee).
 *
 * Senza il secondo segnale una domanda formulata con sinonimi farebbe allargare
 * anche quando l'articolo aperto è l'unico posto in cui la risposta esiste.
 */
export function isOffTopic(
  page: Pick<KbPage, 'title' | 'text' | 'url'>,
  query: string,
  candidates: KbLink[],
  minCoverage = MIN_TERM_COVERAGE,
): boolean {
  const q = query.trim();
  if (!q || !candidates.length) return false;
  if (pageCoverage(page, q) >= minCoverage) return false;

  const pageAsLink: KbLink = {
    // Lo slug dell'articolo aperto è un segnale legittimo (i candidati sono
    // scorati sul loro), quindi si tiene l'URL vero e si marca il testo.
    url: page.url || CURRENT_PAGE_MARK,
    text: page.title,
    context: page.text.slice(0, 400),
    order: -1,
  };
  const winners = pickRelevantLinks([pageAsLink, ...candidates], q);
  if (!winners.length) return false;
  return !winners.some((link) => link.url === pageAsLink.url);
}
