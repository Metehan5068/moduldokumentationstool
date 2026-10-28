import { copyFile, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { newNotes, parseNotes, serializeNotes } from '../../src/shared/notes';
import { textPdf } from '../fixtures/pdf';
let root: string; let app: FastifyInstance; let baseURL: string;
const title = 'IDS-3-Decision-trees';
const question = 'Offene Frage: Warum wird bei der Entropie log2 verwendet?';
test.beforeAll(async () => {
  const fixtures = join(process.cwd(), 'tests', 'fixtures', '.generated'); await mkdir(fixtures, { recursive: true });
  root = await mkdtemp(join(fixtures, 'phase5-')); await mkdir(join(root, 'module', 'ids'), { recursive: true });
  await writeFile(join(root, 'module', 'ids', `${title}.pdf`), textPdf([
    ['Entropy and information gain', 'Entropy measures impurity.', 'Information gain compares entropy before and after a split.'],
    ['Pruning', 'Pruning reduces overfitting by removing branches.'], [],
  ]));
  await writeFile(join(root, 'module', 'ids', 'IDS-4-Regression.PDF'), textPdf([['Linear Regression', 'Fit a line by minimizing squared error.']]));
  const directory = join(root, 'notes', 'ids', title); await mkdir(directory, { recursive: true });
  const notes = newNotes(`module/ids/${title}.pdf`, title, 3); notes.notes[1] = question;
  await writeFile(join(directory, 'notes.md'), serializeNotes(notes));
  app = await buildApp(loadConfig({ DATA_ROOT: root })); baseURL = await app.listen({ host: '127.0.0.1', port: 0 });
});
test.afterAll(async () => { await app?.close(); if (root) await rm(root, { recursive: true, force: true }); });

test('Phase-5-Abnahme: offene Fragen und zugehörige Folientexte sind anhand der Dateien mit Fundstellen lesbar', async ({ page }) => {
  const external: string[] = []; page.on('request', (request) => { if (/^https?:/.test(request.url()) && !request.url().startsWith(baseURL)) external.push(request.url()); });
  await page.goto(baseURL); await expect(page.getByRole('link', { name: title, exact: true })).toBeVisible();
  const directory = join(root, 'notes', 'ids', title); const sourcePath = join(directory, 'source.md');
  await expect.poll(async () => { try { return await readFile(sourcePath, 'utf8'); } catch { return ''; } }).toContain('Entropy measures impurity.');
  await expect.poll(async () => { try { return await readFile(join(root, 'notes', 'ids', 'IDS-4-Regression', 'source.md'), 'utf8'); } catch { return ''; } }).toContain('Linear Regression');
  // Beide Vorlesungen sind bereits lesbar, bevor irgendeine Vorlesung geöffnet wurde.
  const guide = await readFile(join(root, 'CLAUDE.md'), 'utf8'); expect(guide).toContain('Beantworte Inhaltsfragen mit Fundstelle');
  await expect.poll(() => readFile(join(directory, 'notes.md'), 'utf8')).toContain('## Folie 1 · Entropy and information gain');
  expect(parseNotes(await readFile(join(directory, 'notes.md'), 'utf8')).notes[1]).toBe(question);
  const source = await readFile(sourcePath, 'utf8'); expect(source).toContain('## Seite 3\n_[Kein extrahierbarer Text auf dieser Seite]_');
  const meta = JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8')); expect(source).toContain(`sha256: ${meta.sourceSha256}`);
  const sourceTime = (await stat(sourcePath)).mtimeMs;
  await writeFile(join(root, 'CLAUDE.md'), `${guide}\nEigene Regel: Antworten bitte knapp.\n`);
  await page.getByRole('button', { name: 'Neu einlesen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Neu einlesen', exact: true })).toBeEnabled();
  expect(await readFile(join(root, 'CLAUDE.md'), 'utf8')).toBe(`${guide}\nEigene Regel: Antworten bitte knapp.\n`);
  expect((await stat(sourcePath)).mtimeMs).toBe(sourceTime);
  await page.getByRole('link', { name: title, exact: true }).click(); await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await page.keyboard.press('Control+g'); await page.getByLabel('Gehe zu Folie').fill('2'); await page.keyboard.press('Enter');
  await page.getByLabel('Notiz zu Folie 2', { exact: true }).fill('Offene Frage: Welches Abbruchkriterium beim Pruning?');
  await page.keyboard.press('Control+s'); await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
  expect(await readFile(join(directory, 'notes.md'), 'utf8')).toContain('## Folie 2 · Pruning');
  await expect.poll(() => readFile(join(root, 'INDEX.md'), 'utf8')).toContain('| 3 | 2 | bis Folie 2 |');
  await page.getByRole('link', { name: '← Übersicht' }).click();
  for (const width of [1440, 650]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const row of await page.locator('.lectures li').all()) {
      const titleBox = await row.locator('.lecture-title').boundingBox(); const progressBox = await row.locator('.lecture-progress').boundingBox();
      expect(progressBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
    }
  }
  await page.screenshot({ path: 'test-results/phase5-overview.png' });
  expect(external).toEqual([]);
  // Lesbare Abnahme-Artefakte für die Prüfung ohne App; keine echten Vorlesungsdaten.
  const output = join(process.cwd(), 'test-results', 'phase5-readable');
  await mkdir(join(output, 'notes', 'ids', title), { recursive: true });
  for (const name of ['CLAUDE.md', 'INDEX.md']) await copyFile(join(root, name), join(output, name));
  for (const name of ['notes.md', 'source.md', 'meta.json']) await copyFile(join(directory, name), join(output, 'notes', 'ids', title, name));
});
