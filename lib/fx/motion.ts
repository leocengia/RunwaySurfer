// Motion primitives for the visual-tour effects on the HOST page.
// Everything degrades gracefully under prefers-reduced-motion.

/** Checked per call (not cached): the user can toggle it while a tour runs. */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Abortable sleep: resolves after `ms`, or early (in ~60ms ticks) as soon as
 * `shouldAbort()` becomes true, so a stop click during a pause is felt quickly.
 */
export function abortableSleep(ms: number, shouldAbort: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const step = 60;
    let elapsed = 0;
    const tick = () => {
      if (shouldAbort() || elapsed >= ms) {
        resolve();
        return;
      }
      elapsed += step;
      setTimeout(tick, Math.min(step, ms - elapsed + step));
    };
    tick();
  });
}

export interface SmoothScrollOptions {
  durationMs?: number;
  /** Fraction of the viewport height where the target should land (0 = top). */
  viewportAnchor?: number;
  /** Bail out of the tween as soon as this returns true (e.g. tour aborted). */
  shouldAbort?: () => boolean;
}

/**
 * Cinematic eased scroll to an element via a rAF tween of window.scrollTo.
 * A user gesture (wheel/touch/keys) cancels the tween — the user always wins.
 */
export function smoothScrollTo(el: HTMLElement, options: SmoothScrollOptions = {}): Promise<void> {
  const { durationMs = 550, viewportAnchor = 0.4, shouldAbort } = options;
  if (prefersReducedMotion()) {
    el.scrollIntoView({ block: 'center' });
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const startY = window.scrollY;
    const rect = el.getBoundingClientRect();
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const targetY = Math.min(
      Math.max(0, rect.top + startY - window.innerHeight * viewportAnchor),
      maxY,
    );
    const startedAt = performance.now();
    let cancelled = false;

    const cancel = () => {
      cancelled = true;
    };
    const gestures: Array<keyof WindowEventMap> = ['wheel', 'touchstart', 'keydown'];
    for (const type of gestures)
      window.addEventListener(type, cancel, { passive: true, once: true });

    const cleanup = () => {
      for (const type of gestures) window.removeEventListener(type, cancel);
      resolve();
    };

    const frame = (now: number) => {
      if (cancelled || shouldAbort?.()) {
        cleanup();
        return;
      }
      const t = Math.min(1, (now - startedAt) / durationMs);
      window.scrollTo(0, startY + (targetY - startY) * easeInOutCubic(t));
      if (t < 1) requestAnimationFrame(frame);
      else cleanup();
    };
    requestAnimationFrame(frame);
  });
}
