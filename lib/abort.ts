// Scadenze per le fetch della sidebar.
//
// Perché non `AbortSignal.timeout()` + `AbortSignal.any()`: servono due cose che
// quelle primitive non danno. La prima è distinguere "è scaduto il tempo" da "ha
// premuto Stop l'agente" — con un signal combinato l'abort arriva identico nei
// due casi, e la sidebar mostrerebbe un errore dove non c'è nulla di rotto. La
// seconda è il timeout di INATTIVITÀ: su uno stream la durata totale è legittima
// (una risposta lunga richiede tempo), mentre il silenzio non lo è, quindi il
// contatore va riarmato a ogni pezzo che arriva.
//
// `AbortSignal.any` è inoltre recente (Chrome 116+) e non presente in tutti gli
// ambienti di test: qui la combinazione è fatta a mano.

export interface Deadline {
  /** Da passare a `fetch`. Aborta al timeout oppure quando aborta `external`. */
  readonly signal: AbortSignal;
  /** true solo se l'abort è stato causato dallo scadere del tempo. */
  expired(): boolean;
  /** Riarma il conto alla rovescia: usato a ogni chunk sugli stream. */
  touch(): void;
  /** Libera il timer e l'ascoltatore. Va chiamata sempre (finally). */
  dispose(): void;
}

/**
 * Crea una scadenza di `ms` millisecondi, opzionalmente legata a un segnale del
 * chiamante (il pulsante Stop). Il timer parte subito.
 */
export function withTimeout(ms: number, external?: AbortSignal): Deadline {
  const controller = new AbortController();
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const arm = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      expired = true;
      controller.abort();
    }, ms);
  };

  const onExternalAbort = () => controller.abort(external?.reason);

  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onExternalAbort, { once: true });
  }
  arm();

  return {
    signal: controller.signal,
    expired: () => expired,
    touch: arm,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      external?.removeEventListener('abort', onExternalAbort);
    },
  };
}

/**
 * true se l'errore viene da un abort (nostro o del chiamante) e non da un guasto.
 * `fetch` lancia `AbortError`; alcuni ambienti lanciano un `DOMException` senza
 * nome utile, quindi si guarda anche il signal.
 */
export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
}
