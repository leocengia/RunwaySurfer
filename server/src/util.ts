// Piccole utility condivise dai moduli route.

/** Trim + slice difensivo su input non fidato; '' per i non-string. */
export function truncate(text: unknown, max: number): string {
  return typeof text === 'string' ? text.trim().slice(0, max) : '';
}

/** ID breve per richieste /ask (timestamp base36 + suffisso casuale). */
export function newRequestId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
