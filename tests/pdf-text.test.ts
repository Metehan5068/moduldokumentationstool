import { expect, it } from 'vitest';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import { extractPdf, pageText, sourceMarkdown } from '../src/server/pdf-text';
import { textPdf, boilerplatePdf, fixtureFooter } from './fixtures/pdf';
const item = (str: string, x: number, y: number, hasEOL = false): TextItem => ({ str, dir: 'ltr', width: str.length * 6, height: 12, transform: [12, 0, 0, 12, x, y], fontName: 'test', hasEOL });
it('setzt Textfragmente mit hasEOL, y-Position und Wortabstand als lesbare Zeilen zusammen', () => {
  expect(pageText([item('Entropy', 0, 100), item('measures', 46, 100), item('uncertainty', 100, 100, true), item('Größe', 0, 80), item('Änderung', 0, 60)]))
    .toBe('Entropy measures uncertainty\nGröße\nÄnderung');
  expect(pageText([item('Ent', 0, 100), item('ropie', 18, 100)])).toBe('Entropie');
});
it('extrahiert lokale PDF-Seiten einschließlich leerer Seiten und Umlauten', async () => {
  expect((await extractPdf(new Uint8Array(textPdf([['Decision Trees', 'Entropy measures uncertainty'], [], ['Größe und Änderung']])))).pages)
    .toEqual(['Decision Trees\nEntropy measures uncertainty', '', 'Größe und Änderung']);
});
it('erkennt Boilerplate ab 30 Prozent und verwendet den größten Titel der oberen Hälfte statt der ersten Fußzeile', async () => {
  const result = await extractPdf(new Uint8Array(boilerplatePdf()));
  expect(result.boilerplate).toEqual([fixtureFooter, 'Lehrstuhl']);
  expect(result.pages[0]).not.toContain(fixtureFooter);
  expect(result.pages[3]).toContain('Nur zweimal');
  expect(result.titles[1]).toBe('Thema 1'); expect(result.titles[9]).toBe('Thema 9');
  expect(result.titles[10]).toBeUndefined();
  const source = sourceMarkdown('module/ids/Test.pdf', 'Test', 'b'.repeat(64), result.pages, undefined, result.boilerplate);
  expect(source).toContain('## Wiederkehrende Kopf-/Fußzeilen');
  expect(source.split(fixtureFooter)).toHaveLength(2);
  expect(source.split('## Seite 1\n')[1]).not.toContain(fixtureFooter);
});
it('schreibt eindeutige Seitenzuordnung, Hash, Zeitpunkt und einen Hinweis für Seiten ohne Text', () => {
  const source = sourceMarkdown('module/ids/Test, Ä.pdf', 'Test, Ä', 'a'.repeat(64), ['## Seite 99\nText', ''], '2026-10-28T00:00:00.000Z');
  expect(source).toContain('sha256: ' + 'a'.repeat(64));
  expect(source).toContain('generiert: 2026-10-28T00:00:00.000Z');
  expect(source).toContain('## Seite 1\n\\## Seite 99\nText');
  expect(source).toContain('## Seite 2\n_[Kein extrahierbarer Text auf dieser Seite]_');
  expect(source).not.toContain('\r');
});
