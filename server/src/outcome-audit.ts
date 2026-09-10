// Cosa si misura di una risposta senza conservarla.
//
// PERCHÉ ESISTE: la dashboard deve poter segnalare le risposte in cui il modello
// non ha citato alcun articolo — è il modo in cui dice «non l'ho trovato nella
// Knowledge Base», e sono il segnale più utile per capire quali buchi ha la KB.
// Quel dato non era ricavabile: `requests.sources_json` contiene le pagine
// FORNITE al modello, non quelle che ha citato, e il server non conserva il testo
// della risposta (inoltra i delta e basta).
//
// La soluzione è contare, non archiviare: il testo si accumula in memoria per la
// durata dello stream (al massimo ~6 KB, il tetto è 1400 token) e in tabella
// finisce solo il numero. La riga di audit resta privacy-minimised.
import { SOURCES_SECTION } from './shared-assets.js';

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * L'heading della sezione fonti, derivato dal vocabolario condiviso e non scritto
 * a mano: rinominando la sezione in shared/sections.json questo conteggio deve
 * seguire, non azzerarsi in silenzio.
 */
const SOURCES_HEADING = new RegExp(`^##\\s*${escapeRegex(SOURCES_SECTION)}\\b`, 'i');
const ANY_HEADING = /^##\s+/;
const URL_IN_LINE = /https?:\/\/\S+/g;

/**
 * Quante fonti DISTINTE il modello ha citato nella sezione dedicata.
 *
 * Conta gli URL distinti, non le righe: un modello che ripete lo stesso articolo
 * su due righe non ha citato due fonti. Zero significa «nessun articolo citato»,
 * ed è la condizione che la dashboard segnala.
 */
export function countCitedSources(outcome: string): number {
  const urls = new Set<string>();
  let inSources = false;
  for (const line of outcome.split('\n')) {
    if (SOURCES_HEADING.test(line)) {
      inSources = true;
      continue;
    }
    if (inSources && ANY_HEADING.test(line)) break; // sezione successiva
    if (!inSources) continue;
    for (const match of line.matchAll(URL_IN_LINE)) {
      // Punteggiatura finale ("...articolo.") non fa parte dell'URL.
      urls.add(match[0].replace(/[.,;:)\]}'"]+$/, ''));
    }
  }
  return urls.size;
}
