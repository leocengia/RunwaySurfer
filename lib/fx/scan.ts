// Reading-scan effect on followed pages: a luminous beam sweeps down the
// content while occurrences of the matched keywords light up in sync —
// a visualization of the AI actually reading the page.
import { abortableSleep, prefersReducedMotion, sleep } from './motion';

const BEAM_ID = 'rs-fx-beam';
const HIT_CLASS = 'rs-scan-hit';
const MAX_HITS = 15;
const MAX_NODES = 2500;

// Local copy of the keyword normalization (crawl.ts keeps its own private).
function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/** Wrap up to MAX_HITS keyword occurrences in <mark class="rs-scan-hit">. */
function markKeywords(keywords: string[], durationMs: number): HTMLElement[] {
  const wanted = keywords.map(normalize).filter((k) => k.length >= 3);
  if (!wanted.length) return [];
  const root = document.querySelector('#mw-content-text') ?? document.body;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent) return NodeFilter.FILTER_REJECT;
      const tag = parent.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT')
        return NodeFilter.FILTER_REJECT;
      if (parent.closest('[id^="rs-"], [class*="rs-fx"], mark.' + HIT_CLASS))
        return NodeFilter.FILTER_REJECT;
      if (!node.textContent || node.textContent.length < 3) return NodeFilter.FILTER_SKIP;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const marks: HTMLElement[] = [];
  let visited = 0;
  let node: Node | null;
  while ((node = walker.nextNode()) && marks.length < MAX_HITS && visited < MAX_NODES) {
    visited += 1;
    const text = node.textContent ?? '';
    const normalized = normalize(text);
    for (const keyword of wanted) {
      const at = normalized.indexOf(keyword);
      if (at === -1) continue;
      const parent = node.parentElement;
      if (!parent || !isVisible(parent)) break;
      // Single-text-node range: surroundContents can never throw here.
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + keyword.length);
      const mark = document.createElement('mark');
      mark.className = HIT_CLASS;
      try {
        range.surroundContents(mark);
      } catch {
        break;
      }
      // Ignite as the beam passes: delay proportional to vertical position.
      const top = mark.getBoundingClientRect().top;
      if (top > window.innerHeight * 2) {
        // Far below the fold: unwrap, not worth the flash.
        mark.replaceWith(...Array.from(mark.childNodes));
        mark.parentNode?.normalize();
        break;
      }
      mark.style.animationDelay = `${Math.min(1, Math.max(0, top / window.innerHeight)) * durationMs * 0.8}ms`;
      marks.push(mark);
      break; // one keyword per text node keeps it cheap and readable
    }
  }
  return marks;
}

function unmark(marks: HTMLElement[]): void {
  for (const mark of marks) {
    if (!mark.isConnected) continue;
    const parent = mark.parentNode;
    mark.replaceWith(...Array.from(mark.childNodes));
    parent?.normalize();
  }
}

/**
 * Run the reading scan: beam sweep + keyword flashes, fully reverted before
 * returning. Under reduced motion it is just a short pause.
 */
export async function runReadingScan(options: {
  keywords: string[];
  durationMs: number;
  shouldAbort?: () => boolean;
}): Promise<void> {
  if (prefersReducedMotion()) {
    await sleep(300);
    return;
  }
  const beam = document.createElement('div');
  beam.id = BEAM_ID;
  beam.style.animation = `rs-fx-scan ${options.durationMs}ms linear forwards`;
  document.documentElement.appendChild(beam);
  const marks = markKeywords(options.keywords, options.durationMs);
  try {
    // Interruptible: a stop click ends the scan promptly instead of waiting out
    // the full sweep. The short tail lets the last keyword flash settle.
    await abortableSleep(options.durationMs + 150, () => options.shouldAbort?.() ?? false);
  } finally {
    unmark(marks);
    beam.remove();
  }
}
