// Data contracts used by the extension. The shapes shared with the backend
// live in shared/contracts.d.ts (single source of truth, re-exported here so
// existing imports keep working).
export type {
  KbPage,
  KbLink,
  AskRequest,
  AiPlan,
  AskEvent,
  RankRequest,
  RankResponse,
} from '../shared/contracts';

/**
 * The operational outcome is streamed as markdown with these four sections.
 * Kept as a documented convention (rendered by the sidebar) rather than a rigid
 * schema, so the streaming UX stays simple.
 */
export const OUTCOME_SECTIONS = [
  'Procedura',
  'Eccezioni',
  'Risposta suggerita al cliente',
  'Fonti',
] as const;
