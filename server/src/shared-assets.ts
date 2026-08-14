// Asset condivisi con l'estensione (design token, marchio, vocabolario delle
// sezioni di output), letti da shared/.
//
// Non sono import di moduli: `server/tsconfig.json` ha `rootDir: "src"`, quindi
// un import fuori da src romperebbe la build. Vengono letti a runtime
// relativamente a QUESTO modulo — e la profondità è la stessa in sviluppo
// (`server/src/`, via tsx) e in produzione (`server/dist/`, via tsc), perciò un
// solo path copre entrambi i casi.
import { readFileSync } from 'node:fs';

function sharedUrl(relativePath: string): URL {
  return new URL(`../../shared/${relativePath}`, import.meta.url);
}

function readShared(relativePath: string): string {
  const url = sharedUrl(relativePath);
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

/**
 * Marchio come data-URI, pronto per un `<img src>`.
 *
 * Lo stesso file (shared/logo-mark.png, 96px generato da docs/build-icons.mjs)
 * alimenta anche l'estensione, che lo importa come modulo TS: il server non può
 * fare quell'import perché `rootDir: "src"` glielo vieta, quindi legge il PNG.
 * Una sola fonte, due modi di raggiungerla.
 *
 * 96px e non l'originale da 1,7 MB: questa stringa viene inlinata in OGNI
 * caricamento della dashboard e delle pagine di login.
 */
export const LOGO_MARK = (() => {
  const url = sharedUrl('logo-mark.png');
  try {
    return `data:image/png;base64,${readFileSync(url).toString('base64')}`;
  } catch (error) {
    throw new Error(
      `Impossibile leggere shared/logo-mark.png (${url.pathname}): ${String(error)}. ` +
        'Rigeneralo con `node docs/build-icons.mjs`.',
    );
  }
})();

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
