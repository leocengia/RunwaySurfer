// Asset condivisi con l'estensione (design token, marchio, vocabolario delle
// sezioni di output), letti da shared/.
//
// Non sono import di moduli: `server/tsconfig.json` ha `rootDir: "src"`, quindi
// un import fuori da src romperebbe la build. Vengono letti a runtime
// relativamente a QUESTO modulo — e la profondità è la stessa in sviluppo
// (`server/src/`, via tsx) e in produzione (`server/dist/`, via tsc), perciò un
// solo path copre entrambi i casi.
import { readFileSync } from 'node:fs';

function readShared(relativePath: string): string {
  const url = new URL(`../../shared/${relativePath}`, import.meta.url);
  try {
    return readFileSync(url, 'utf8');
  } catch (error) {
    // Un asset condiviso mancante è un deploy rotto: meglio fermarsi al boot che
    // servire una dashboard senza palette, senza marchio o con sezioni sbagliate.
    throw new Error(
      `Impossibile leggere shared/${relativePath} (${url.pathname}): ${String(error)}`,
    );
  }
}

/** Blocco `:root, :host` dei design token, da inlinare in un <style>. */
export const THEME_CSS = readShared('theme.css');

/** Marchio come stringa SVG, dimensionato dal contenitore. */
export const LOGO_SVG = readShared('logo.svg');

export interface ScheduleChangeField {
  id: string;
  label: string;
}

interface SectionsFile {
  standard: string[];
  sources: string;
  scheduleChangeFields: ScheduleChangeField[];
}

const sections = JSON.parse(readShared('sections.json')) as SectionsFile;

/** Sezioni di una risposta libera, nell'ordine, esclusa quella delle fonti. */
export const STANDARD_SECTIONS: readonly string[] = sections.standard;

/**
 * Titolo della sezione delle fonti. Va SEMPRE per ultima e non è mai opzionale:
 * la sidebar ci aggancia la resa dei chip cliccabili (lib/sources.ts), quindi
 * togliendola i link tornerebbero URL nudi.
 */
export const SOURCES_SECTION: string = sections.sources;

/** Campi selezionabili nella risposta a una richiesta Schedule Change. */
export const SCHEDULE_CHANGE_FIELDS: readonly ScheduleChangeField[] = sections.scheduleChangeFields;
