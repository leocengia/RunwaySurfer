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

export interface SmoothScrollOptions {
  durationMs?: number;
  /** Fraction of the viewport height where the target should land (0 = top). */
  viewportAnchor?: number;
}

/**
 * Cinematic eased scroll to an element via a rAF tween of window.scrollTo.
 * A user gesture (wheel/touch/keys) cancels the tween — the user always wins.
 */
export function smoothScrollTo(el: HTMLElement, options: SmoothScrollOptions = {}): Promise<void> {
  const { durationMs = 950, viewportAnchor = 0.4 } = options;
  if (prefersReducedMotion()) {
    el.scrollIntoView({ block: 'center' });
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const startY = window.scrollY;
    const rect = el.getBoundingClientRect();
    const maxY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const targetY = Math.min(Math.max(0, rect.top + startY - window.innerHeight * viewportAnchor), maxY);
    const startedAt = performance.now();
    let cancelled = false;

    const cancel = () => {
      cancelled = true;
    };
    const gestures: Array<keyof WindowEventMap> = ['wheel', 'touchstart', 'keydown'];
    for (const type of gestures) window.addEventListener(type, cancel, { passive: true, once: true });

    const cleanup = () => {
      for (const type of gestures) window.removeEventListener(type, cancel);
      resolve();
    };

    const frame = (now: number) => {
      if (cancelled) {
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
