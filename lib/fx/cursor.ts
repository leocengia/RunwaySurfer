// Ghost AI cursor: a glowing pointer that glides along a curved path to the
// tour target and "clicks" it with a ripple right before the navigation —
// as if an expert colleague were driving the mouse.
import { easeInOutCubic, prefersReducedMotion, sleep } from './motion';

const CURSOR_ID = 'rs-fx-cursor';

// Navy arrow with a yellow stroke, tip at the top-left of the viewBox: the
// element position IS the pointing position.
const CURSOR_SVG = `
  <svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 2 L11 22 L13.5 13.5 L22 11 Z" fill="#0b1f3a" stroke="#ffcc00" stroke-width="1.8" stroke-linejoin="round" />
  </svg>
`;

let lastPos: { x: number; y: number } | null = null;

function ensureCursor(): HTMLElement {
  let cursor = document.getElementById(CURSOR_ID);
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.id = CURSOR_ID;
    cursor.innerHTML = CURSOR_SVG;
    document.documentElement.appendChild(cursor);
    const start = lastPos ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    cursor.style.left = `${start.x}px`;
    cursor.style.top = `${start.y}px`;
  }
  return cursor;
}

function targetPoint(el: HTMLElement): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * Glide the cursor to `el` along a quadratic Bezier curve. The end point is
 * re-read from the live rect every frame because the page scrolls concurrently.
 */
export function cursorGlideTo(el: HTMLElement, durationMs = 1150): Promise<void> {
  if (prefersReducedMotion()) return Promise.resolve();
  ensureCursor();
  const p0 = lastPos ?? { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const startedAt = performance.now();

  return new Promise((resolve) => {
    const frame = (now: number) => {
      const cur = document.getElementById(CURSOR_ID);
      if (!cur) {
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
        x: (p0.x + p2.x) / 2 - (dy / len) * 120,
        y: (p0.y + p2.y) / 2 + (dx / len) * 120,
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

/** Press animation + click ripple at the cursor point; ~450ms total. */
export async function cursorClick(): Promise<void> {
  if (prefersReducedMotion()) return;
  const cursor = document.getElementById(CURSOR_ID);
  if (!cursor || !lastPos) return;
  cursor.classList.add('rs-fx-press');
  const ripple = document.createElement('div');
  ripple.className = 'rs-fx-ripple';
  ripple.style.left = `${lastPos.x}px`;
  ripple.style.top = `${lastPos.y}px`;
  ripple.addEventListener('animationend', () => ripple.remove());
  document.documentElement.appendChild(ripple);
  await sleep(450);
  cursor.classList.remove('rs-fx-press');
}

export function removeCursor(): void {
  document.getElementById(CURSOR_ID)?.remove();
  lastPos = null;
}
