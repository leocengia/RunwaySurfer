// Data contracts used by the backend. The canonical definitions live in
// shared/contracts.d.ts at the repo root (single source of truth shared with
// the extension); this module only re-exports them so existing imports keep
// working. Type-only, so nothing is emitted at build time.
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
} from '../../shared/contracts';
