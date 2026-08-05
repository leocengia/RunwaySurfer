// Ghost AI cursor: a glowing pointer that glides along a curved path to the
// tour target and "clicks" it with a ripple right before the navigation —
// as if an expert colleague were driving the mouse.
import { easeInOutCubic, prefersReducedMotion, sleep } from './motion';

const CURSOR_ID = 'rs-fx-cursor';

// Blue arrow with a yellow stroke, tip at the top-left of the viewBox: the
// element position IS the pointing position.
const CURSOR_SVG = `
  <svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 2 L11 22 L13.5 13.5 L22 11 Z" fill="#000099" stroke="#ffcc00" stroke-width="1.8" stroke-linejoin="round" />
  </svg>
`;

let lastPos: { x: number; y: number } | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function targetPoint(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Punto di ingresso del cursore alla prima comparsa: appena sotto/sinistra del
 * bersaglio, non al centro del viewport. Un puntatore che si materializza in
 * mezzo alla pagina si legge come un indicatore di caricamento centrale — che è
 * esattamente ciò che il tour non deve mostrare.
 */
function entryPoint(el: HTMLElement): { x: number; y: number } {
  const t = targetPoint(el);
  return {
    x: clamp(t.x - 150, 12, Math.max(12, window.innerWidth - 12)),
    y: clamp(t.y + 110, 12, Math.max(12, window.innerHeight - 12)),
  };
}

function ensureCursor(el: HTMLElement): HTMLElement {
  let cursor = document.getElementById(CURSOR_ID);
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = CURSOR_ID;
    cursor.innerHTML = CURSOR_SVG;
    const start = lastPos ?? entryPoint(el);
    cursor.style.left = `${start.x}px`;
    cursor.style.top = `${start.y}px`;
    document.documentElement.appendChild(cursor);
  }
  return cursor;
}

/**
 * Glide the cursor to `el` along a quadratic Bezier curve. The end point is
 * re-read from the live rect every frame because the page scrolls concurrently.
 */
export function cursorGlideTo(
  el: HTMLElement,
  durationMs = 650,
  shouldAbort?: () => boolean,
): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  ensureCursor(el);
  const p0 = lastPos ?? entryPoint(el);
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const frame = (now: number) => {
      const cur = document.getElementById(CURSOR_ID);
      if (!cur || shouldAbort?.()) {
        resolve();
        return;
      }
      const t = Math.min(1, (now - startedAt) / durationMs);
      const e = easeInOutCubic(t);
      const p2 = targetPoint(el);
      // Control point: midway, offset perpendicular to the path for the curve.
      const dx = p2.x - p0.x;
      const dy = p2.y - p0.y;
      const len = Math.hypot(dx, dy) || 1;
      const p1 = {
        x: (p0.x + p2.x) / 2 - (dy / len) * 60,
        y: (p0.y + p2.y) / 2 + (dx / len) * 60,
      };
      const inv = 1 - e;
      const x = inv * inv * p0.x + 2 * inv * e * p1.x + e * e * p2.x;
      const y = inv * inv * p0.y + 2 * inv * e * p1.y + e * e * p2.y;
      cur.style.left = `${x}px`;
      cur.style.top = `${y}px`;
      lastPos = { x, y };
      if (t < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/**
 * Press animation + click ripple; ~250ms total. The ripple is centered on the
 * target link's rect (falling back to the cursor point) so it reads as a click
 * ON the link rather than wherever the cursor happens to sit.
 */
export async function cursorClick(el?: HTMLElement): Promise<void> {
  if (prefersReducedMotion()) return;
  const cursor = document.getElementById(CURSOR_ID);
  if (!cursor || !lastPos) return;
  const center = el ? targetPoint(el) : lastPos;
  cursor.classList.add('rs-fx-press');
  const ripple = document.createElement('div');
  ripple.className = 'rs-fx-ripple';
  ripple.style.left = `${center.x}px`;
  ripple.style.top = `${center.y}px`;
  ripple.addEventListener('animationend', () => ripple.remove());
  document.documentElement.appendChild(ripple);
  await sleep(250);
  cursor.classList.remove('rs-fx-press');
}

export function removeCursor(): void {
  document.getElementById(CURSOR_ID)?.remove();
  lastPos = null;
}
