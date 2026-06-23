// Backend copy of the shared contracts (kept in sync with the extension's
// lib/outcome.ts). A separate package, so the shapes are duplicated rather than
// imported.

export interface KbPage {
  url: string;
  title: string;
  text: string;
  origin: 'current' | 'followed';
}

export interface KbLink {
  url: string;
  text: string;
}

export interface AskRequest {
  query: string;
  pages: KbPage[];
  links: KbLink[];
}

export interface AiPlan {
  model: string;
  routingReason: string;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostUsd: number;
  egress: string;
  provider: 'mock' | 'anthropic';
}

export type AskEvent =
  | { type: 'plan'; plan: AiPlan }
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
