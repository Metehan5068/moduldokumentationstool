import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api.js';

export const SOURCE_TEXT_VERSION = 2;
export interface TextLine { text: string; height: number; top: number }
export interface TextPage { lines: TextLine[]; height: number }
export interface ExtractedPdf { pages: string[]; titles: Record<number, string>; boilerplate: string[]; pagesWithoutText: number[] }

function textLines(items: (TextItem | TextMarkedContent)[], point: (x: number, y: number) => number[] = (_, y) => [0, -y]): TextLine[] {
  const lines: TextLine[] = [];
  let line = ''; let height = 0; let top = Infinity;
  let previous: TextItem | undefined;
  const flush = () => {
    for (const text of line.split('\n')) if (text.trim()) lines.push({ text: text.trim(), height, top });
    line = ''; height = 0; top = Infinity; previous = undefined;
  };
  for (const item of items) {
    if (!('str' in item)) continue;
    if (previous && Math.abs(item.transform[5]! - previous.transform[5]!) > Math.max(2, item.height * 0.35)) flush();
    if (line && previous && !/\s$/.test(line) && !/^\s/.test(item.str)) {
      const gap = item.transform[4]! - (previous.transform[4]! + previous.width);
      if (gap > Math.max(1, item.height * 0.15)) line += ' ';
    }
    const fontHeight = Math.abs(item.height) || Math.hypot(item.transform[2]!, item.transform[3]!);
    if (item.str.trim()) { height = Math.max(height, fontHeight); top = Math.min(top, point(item.transform[4]!, item.transform[5]!)[1]! - fontHeight); }
    line += item.str.replace(/\r\n?/g, '\n'); previous = item;
    if (item.hasEOL) flush();
  }
  flush(); return lines;
}
export function pageText(items: (TextItem | TextMarkedContent)[]): string { return textLines(items).map((line) => line.text).join('\n'); }

export function analyzePages(pages: TextPage[]): ExtractedPdf {
  const frequencies = new Map<string, number>();
  const key = (text: string) => text.normalize('NFC').trim();
  for (const page of pages) for (const text of new Set(page.lines.map((line) => key(line.text)))) frequencies.set(text, (frequencies.get(text) ?? 0) + 1);
  // Wiederkehrend bedeutet mindestens zwei verschiedene Seiten, auch bei sehr kurzen PDFs.
  const boilerplate = [...frequencies].filter(([text, count]) => text && count >= 2 && count / pages.length >= 0.3).map(([text]) => text);
  const repeated = new Set(boilerplate);
  const titles: Record<number, string> = {};
  const cleaned = pages.map((page, index) => {
    const lines = page.lines.filter((line) => !repeated.has(key(line.text)));
    // Oberer Seitenbereich = obere Hälfte; bei gleicher Schrifthöhe gewinnt die höhere Zeile.
    const title = lines.filter((line) => line.height > 0 && line.top >= -line.height && line.top < page.height / 2)
      .sort((a, b) => b.height - a.height || a.top - b.top)[0];
    if (title) titles[index + 1] = title.text;
    return lines.map((line) => line.text).join('\n');
  });
  return { pages: cleaned, titles, boilerplate, pagesWithoutText: pages.flatMap((page, index) => page.lines.length ? [] : [index + 1]) };
}
export async function extractPdf(data: Uint8Array): Promise<ExtractedPdf> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = new URL('./', import.meta.resolve('pdfjs-dist/package.json'));
  const local = (folder: string) => fileURLToPath(new URL(`${folder}/`, root)).replaceAll('\\', '/');
  const task = getDocument({ data, useSystemFonts: false, useWorkerFetch: false,
    cMapUrl: local('cmaps'), cMapPacked: true, standardFontDataUrl: local('standard_fonts'), wasmUrl: local('wasm'), iccUrl: local('iccs') });
  try {
    const pdf = await task.promise; const pages: TextPage[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try {
        const viewport = page.getViewport({ scale: 1 });
        pages.push({ lines: textLines((await page.getTextContent()).items, (x, y) => viewport.convertToViewportPoint(x, y)), height: viewport.height });
      } finally { page.cleanup(); }
      await setImmediate();
    }
    return analyzePages(pages);
  } finally { await task.destroy(); }
}
export function sourceMarkdown(source: string, title: string, hash: string, pages: string[], generated = new Date().toISOString(), boilerplate: string[] = []): string {
  const header = `---\nquelle: ${JSON.stringify(source)}\nsha256: ${hash}\nsourceTextVersion: ${SOURCE_TEXT_VERSION}\ngeneriert: ${generated}\nhinweis: Automatisch aus dem PDF extrahiert. Nicht bearbeiten. Maßgeblich ist das PDF.\n---\n# ${title}: Folientext`;
  const recurring = boilerplate.length ? `\n\n## Wiederkehrende Kopf-/Fußzeilen\n${boilerplate.map((line) => `- ${line}`).join('\n')}` : '';
  return `${header}${recurring}\n\n${pages.map((text, index) => `## Seite ${index + 1}\n${text ? text.replace(/^## Seite \d+\s*$/gm, (line) => `\\${line}`) : '_[Kein extrahierbarer Text auf dieser Seite]_'}`).join('\n\n')}\n`;
}
