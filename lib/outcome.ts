// Data contracts used by the extension. The shapes shared with the backend
// live in shared/contracts.d.ts (single source of truth, re-exported here so
// existing imports keep working).
export type {
  KbPage,
  KbLink,
  AnswerLanguage,
  AskRequest,
  AskTurn,
  ScheduleChangeRequest,
  AiPlan,
  AskEvent,
  RankRequest,
  RankResponse,
} from '../shared/contracts';

// Vocabolario delle sezioni di output. La sorgente è shared/sections.json, lo
// stesso file che il server legge da disco (server/src/shared-assets.ts): prima
// gli stessi titoli erano scritti in quattro posti e OUTCOME_SECTIONS era
// dichiarato senza essere usato da nessuno.
import sections from '../shared/sections.json';

/** Sezioni di una risposta libera, escluse le fonti. */
export const STANDARD_SECTIONS: readonly string[] = sections.standard;

/**
 * Titolo della sezione delle fonti: sempre ultima e mai opzionale, perché è
 * l'aggancio con cui lib/sources.ts rende i link come chip cliccabili.
 */
export const SOURCES_SECTION: string = sections.sources;

/** Campi selezionabili nella risposta a una richiesta Schedule Change. */
export const SCHEDULE_CHANGE_FIELDS: readonly { id: string; label: string }[] =
  sections.scheduleChangeFields;

/** Le sezioni di una risposta libera, fonti incluse, nell'ordine. */
export const OUTCOME_SECTIONS: readonly string[] = [...sections.standard, sections.sources];
