import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api.js';

/** PDF.js liefert Textfragmente; Zeilenenden und Baseline verhindern zusammengeklebte Folien. */
export function pageText(items: (TextItem | TextMarkedContent)[]): string {
  const lines: string[] = [];
  let line = '';
  let previous: TextItem | undefined;
  const flush = () => { if (line.trim()) lines.push(line.trimEnd()); line = ''; previous = undefined; };
  for (const item of items) {
    if (!('str' in item)) continue;
    if (previous && Math.abs(item.transform[5]! - previous.transform[5]!) > Math.max(2, item.height * 0.35)) flush();
    if (line && previous && !/\s$/.test(line) && !/^\s/.test(item.str)) {
      const gap = item.transform[4]! - (previous.transform[4]! + previous.width);
      if (gap > Math.max(1, item.height * 0.15)) line += ' ';
    }
    line += item.str.replace(/\r\n?/g, '\n');
    previous = item;
    if (item.hasEOL) flush();
  }
  flush();
  return lines.join('\n').trim();
}
export async function extractPdf(data: Uint8Array): Promise<string[]> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const root = new URL('./', import.meta.resolve('pdfjs-dist/package.json'));
  const local = (folder: string) => fileURLToPath(new URL(`${folder}/`, root)).replaceAll('\\', '/');
  const task = getDocument({ data, useSystemFonts: false, useWorkerFetch: false,
    cMapUrl: local('cmaps'), cMapPacked: true, standardFontDataUrl: local('standard_fonts'), wasmUrl: local('wasm'), iccUrl: local('iccs') });
  try {
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      try { pages.push(pageText((await page.getTextContent()).items)); }
      finally { page.cleanup(); }
      await setImmediate(); // API-Requests zwischen den Seiten weiter bedienen.
    }
    return pages;
  } finally { await task.destroy(); }
}
export function sourceMarkdown(source: string, title: string, hash: string, pages: string[], generated = new Date().toISOString()): string {
  const header = `---\nquelle: ${JSON.stringify(source)}\nsha256: ${hash}\ngeneriert: ${generated}\nhinweis: Automatisch aus dem PDF extrahiert. Nicht bearbeiten. Maßgeblich ist das PDF.\n---\n# ${title}: Folientext`;
  return `${header}\n\n${pages.map((text, index) => `## Seite ${index + 1}\n${text ? text.replace(/^## Seite \d+\s*$/gm, (line) => `\\${line}`) : '_[Kein extrahierbarer Text auf dieser Seite]_'}`).join('\n\n')}\n`;
}
