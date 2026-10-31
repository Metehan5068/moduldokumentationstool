import { expandModule } from './overview';
import { expectEditorText } from './editor';
import { mkdtemp, mkdir, readFile, readdir, rm, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { lectureId } from '../../src/server/registry';
import { parseNotes } from '../../src/shared/notes';
import { textPdf } from '../fixtures/pdf';
let root: string; let app: FastifyInstance; let baseURL: string;
test.beforeAll(async () => {
  const fixtures = join(process.cwd(), 'tests', 'fixtures', '.generated'); await mkdir(fixtures, { recursive: true });
  root = await mkdtemp(join(fixtures, 'phase6-')); await mkdir(join(root, 'module', 'ids'), { recursive: true });
  app = await buildApp(loadConfig({ DATA_ROOT: root })); baseURL = await app.listen({ host: '127.0.0.1', port: 0 });
});
test.afterAll(async () => { await app?.close(); if (root) await rm(root, { recursive: true, force: true }); });
const pdf = (name: string) => join(root, 'module', 'ids', `${name}.pdf`);
const notes = (name: string) => join(root, 'notes', 'ids', name, 'notes.md');
async function open(page: Page, name: string, count = 3) {
  await writeFile(pdf(name), textPdf(Array.from({ length: count }, (_, index) => [`${name} Thema ${index + 1}`])));
  await page.goto(baseURL); await expandModule(page); await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
}
async function note(page: Page, number: number, text: string) {
  await page.keyboard.press('Control+g'); await page.getByLabel('Gehe zu Folie').fill(String(number)); await page.keyboard.press('Enter');
  await page.getByLabel(`Notiz zu Folie ${number}`, { exact: true }).fill(text); await page.keyboard.press('Control+s');
  await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
}

test('ersetzte PDF warnt mit Seitenzahlen; Notiz ohne Folie bleibt editierbar und Zuordnung ist quittierbar', async ({ page }) => {
  const name = 'Geänderte Quelle'; await open(page, name); await note(page, 3, 'Meine ursprüngliche Frage');
  await writeFile(pdf(name), textPdf([['Nur noch eine Seite']])); await page.reload();
  const warning = page.locator('.source-warning'); await expect(warning).toContainText('vorher 3, jetzt 1 Seiten');
  const detached = page.getByLabel('Notiz ohne Folie 3', { exact: true }); await expectEditorText(detached, 'Meine ursprüngliche Frage');
  await detached.fill('Notiz ohne Folie weiter bearbeitet'); await page.keyboard.press('Control+s');
  await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(notes(name), 'utf8')).notes[3]).toBe('Notiz ohne Folie weiter bearbeitet');
  await page.screenshot({ path: 'test-results/phase6-changed-source.png' });
  await page.getByRole('button', { name: 'Zuordnung geprüft', exact: true }).click(); await expect(warning).toHaveCount(0);
  await page.reload(); await expectEditorText(detached, 'Notiz ohne Folie weiter bearbeitet'); await expect(warning).toHaveCount(0);
});

test('bestätigt eine inzwischen erneut ersetzte PDF nicht versehentlich', async ({ page }) => {
  const name = 'Nochmals geändert'; await open(page, name, 2);
  await writeFile(pdf(name), textPdf([['Neu 1'], ['Neu 2'], ['Neu 3']])); await page.reload();
  await expect(page.locator('.source-warning')).toContainText('vorher 2, jetzt 3 Seiten');
  await writeFile(pdf(name), textPdf([['Ganz neu 1'], ['Ganz neu 2'], ['Ganz neu 3'], ['Ganz neu 4']]));
  await page.getByRole('button', { name: 'Zuordnung geprüft', exact: true }).click();
  await expect(page.locator('.source-warning')).toContainText('erneut geändert');
  await page.reload(); await expect(page.locator('.source-warning')).toContainText('vorher 2, jetzt 4 Seiten');
});

test('umbenannte PDF wird per Hash vorgeschlagen und ausdrücklich mit erhaltenen Notizen und erledigt verknüpft', async ({ page }) => {
  const old = 'Vor Umbenennung'; const next = 'Nach Umbenennung';
  await open(page, old); await note(page, 1, 'Diese Frage bleibt nach Umbenennung erhalten.');
  await page.getByRole('checkbox', { name: 'erledigt', exact: true }).check(); await expect(page.getByRole('checkbox', { name: 'erledigt', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '← Übersicht' }).click(); await expandModule(page);
  await rename(pdf(old), pdf(next)); await page.getByRole('button', { name: 'Neu einlesen', exact: true }).click();
  const section = page.getByRole('region', { name: 'Notizen ohne PDF', exact: true });
  const row = section.locator('li').filter({ hasText: `ids/${old}` }); await expect(row).toContainText('umbenannt?');
  await row.getByRole('button', { name: 'Mit PDF verknüpfen…', exact: true }).click();
  await row.getByLabel(`PDF für ids/${old}`, { exact: true }).selectOption(lectureId(`module/ids/${next}.pdf`));
  await row.getByRole('button', { name: 'Verknüpfen', exact: true }).click();
  await expect(section).toHaveCount(0); await page.getByRole('link', { name: next, exact: true }).click();
  await expectEditorText(page.getByLabel('Notiz zu Folie 1', { exact: true }), 'Diese Frage bleibt nach Umbenennung erhalten.');
  await expect(page.getByRole('checkbox', { name: 'erledigt', exact: true })).toBeChecked();
  await expect(page.locator('.source-warning')).toHaveCount(0);
  const backups = await readdir(join(root, 'notes', '.relink-backups')); expect(backups.length).toBeGreaterThan(0);
});

test('gelöschte PDF bleibt als verwaiste Notiz sichtbar; belegte Ziele werden nicht überschrieben', async ({ page }) => {
  const old = 'Gelöschte PDF'; const target = 'Schon belegtes Ziel';
  await open(page, old); await note(page, 1, 'Originalnotiz'); await page.getByRole('link', { name: '← Übersicht' }).click(); await expandModule(page);
  await open(page, target); await note(page, 1, 'Zielnotiz'); await page.getByRole('link', { name: '← Übersicht' }).click(); await expandModule(page);
  await rm(pdf(old)); await page.getByRole('button', { name: 'Neu einlesen', exact: true }).click();
  const row = page.getByRole('region', { name: 'Notizen ohne PDF', exact: true }).locator('li').filter({ hasText: `ids/${old}` });
  await row.getByRole('button', { name: 'Mit PDF verknüpfen…', exact: true }).click();
  await row.getByLabel(`PDF für ids/${old}`, { exact: true }).selectOption(lectureId(`module/ids/${target}.pdf`));
  await row.getByRole('button', { name: 'Verknüpfen', exact: true }).click(); await expect(row.getByRole('alert')).toContainText('bereits Notizen');
  expect(parseNotes(await readFile(notes(old), 'utf8')).notes[1]).toBe('Originalnotiz');
  expect(parseNotes(await readFile(notes(target), 'utf8')).notes[1]).toBe('Zielnotiz');
  await expect.poll(async () => { try { return await readFile(join(root, 'INDEX.md'), 'utf8'); } catch { return ''; } }).toContain('## Notizen ohne PDF');
});

test('fremder Origin und Host werden auch am laufenden HTTP-Server abgewiesen', async ({ page, request }) => {
  const name = 'Sicherer Schreibzugriff'; await open(page, name, 1); const id = lectureId(`module/ids/${name}.pdf`);
  expect((await request.put(`${baseURL}/api/lectures/${id}/completed`, { headers: { origin: 'https://evil.test' }, data: { completed: true } })).status()).toBe(403);
  expect((await request.get(`${baseURL}/api/health`, { headers: { host: 'evil.test' } })).status()).toBe(403);
  await expect(page.getByRole('checkbox', { name: 'erledigt', exact: true })).not.toBeChecked();
  expect((await request.put(`${baseURL}/api/lectures/${id}/completed`, { headers: { origin: baseURL }, data: { completed: true } })).status()).toBe(200);
});
