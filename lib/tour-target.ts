// Logica pura per scegliere la pagina di destinazione finale del tour visivo:
// dagli URL citati nella risposta (sezione Fonti prima, poi tutto il markdown)
// alla pagina effettivamente letta durante il tour. Estratta da App.tsx per
// renderla testabile.
import type { KbPage } from './outcome';
import { normalizeUrl } from './tour';

function trimUrl(raw: string): string {
  return raw.replace(/[),.;\]]+$/g, '');
}

export function urlsIn(text: string): string[] {
  return Array.from(text.matchAll(/https?:\/\/[^\s<>)\]]+/g), (match) => trimUrl(match[0]));
}

export function sourceSection(markdown: string): string {
  const lines = markdown.split('\n');
  const start = lines.findIndex((line) => /^##\s*fonti\b/i.test(line.trim()));
  if (start === -1) return '';
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line.trim()));
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n');
}

function matchingReadPage(url: string, pages: KbPage[], preferFollowed: boolean): KbPage | null {
  const want = normalizeUrl(url);
  const candidates = preferFollowed ? pages.filter((p) => p.origin === 'followed') : pages;
  return candidates.find((page) => normalizeUrl(page.url) === want) ?? null;
}

export function findTourTargetUrl(markdown: string, pages: KbPage[]): string | null {
  const fromSources = urlsIn(sourceSection(markdown));
  const fromAll = urlsIn(markdown);
  for (const url of fromSources) {
    const page = matchingReadPage(url, pages, true);
    if (page) return page.url;
  }
  for (const url of fromSources) {
    const page = matchingReadPage(url, pages, false);
    if (page) return page.url;
  }
  for (const url of fromAll) {
    const page = matchingReadPage(url, pages, true) ?? matchingReadPage(url, pages, false);
    if (page) return page.url;
  }
  return null;
}
