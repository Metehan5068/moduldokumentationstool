import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { lectureId } from '../../src/server/registry';
import { INITIAL_STATE } from '../../src/shared/state';
import { lecturePdf } from '../fixtures/pdf';
import { expandModule } from './overview';

let root: string;
let module: string;
let app: FastifyInstance;
let baseURL: string;
const id = lectureId('module/Cryptography/lecture/1');
const board = lectureId('module/Cryptography/whiteboard/Lecture 1 - Example.pdf');
const script = lectureId('module/Cryptography/mini-script.pdf');
const md = '# Lernskript Lecture 1\n\n[Abschnitt](#abschnitt)\n\nQuelle [3][src-3] und Skript [8][src-8].\n\n'
  + '| Begriff | Erklärung |\n|---|---|\n| Key | Schlüssel |\n\n\\[ x^2 + y^2 = z^2 \\]\n\n'
  + '<details><summary>Selbsttest</summary>Die Antwort lautet 42.</details>\n\n'
  + ['flowchart LR\nA["Alice<br/>Senderin"] --> B[Bob]', 'flowchart TD\nA[Start] --> B{Fertig?}\nB --> C[Ende]', 'flowchart LR\nX --> Y'].map((graph) => `\n\n\`\`\`mermaid\n${graph}\n\`\`\`\n`).join('')
  + Array.from({ length: 24 }, (_, i) => `\n\n## Abschnitt ${i + 1}\n\nErklärung zum Thema Kryptographie. Ein Beleg [3][src-3] und ein Skriptverweis [8][src-8].\n\n${'Ein ausführlicher Lerntext. '.repeat(16)}`).join('')
  + '\n\n## Abschnitt\n\nZiel des internen Links.\n\n[src-3]: <Lecture 1 - Example - Summary.pdf#page=3>\n[src-8]: <mini-script.pdf#page=2>\n'
  + '<script>window.__unsafe = true</script>\n<img src="https://example.com/unwanted.png" onerror="window.__unsafe=true">';

test.beforeEach(async () => {
  const fixtures = join(process.cwd(), 'tests', 'fixtures', '.generated');
  await mkdir(fixtures, { recursive: true }); root = await mkdtemp(join(fixtures, 'cryptography-'));
  module = join(root, 'module', 'Cryptography');
  await mkdir(join(module, 'whiteboard'), { recursive: true }); await mkdir(join(module, 'mds'));
  await writeFile(join(module, 'whiteboard', 'Lecture 1 - Example.pdf'), lecturePdf(7));
  await writeFile(join(module, 'whiteboard', 'Lecture 2 - Second.pdf'), lecturePdf(4));
  await writeFile(join(module, 'mini-script.pdf'), lecturePdf(5));
  await writeFile(join(module, 'mds', 'Lecture 1.md'), md);
  app = await buildApp(loadConfig({ DATA_ROOT: root })); baseURL = await app.listen({ host: '127.0.0.1', port: 0 });
});
test.afterEach(async () => {
  app?.server.closeAllConnections();
  await app?.close();
  // Verify the mkdtemp target before recursive cleanup, also on Windows.
  if (root && resolve(root).startsWith(resolve('tests/fixtures/.generated') + '\\')) await rm(root, { recursive: true, force: true });
});
async function open(page: Page) {
  await page.goto(baseURL); await expandModule(page, 'Cryptography');
  await expect(page.getByRole('link', { name: 'mini-script', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Lecture 1', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Whiteboard', exact: true })).toBeVisible();
  await expect(page.locator('.source-pdf-scroll:visible canvas[data-rendered=true]').first()).toBeVisible();
}
async function jump(page: Page, target: number) {
  await page.keyboard.press('Control+g'); await page.getByLabel('Gehe zu Seite').fill(String(target));
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
}

test('rendert Lernskript, springt zu beiden Quellen und erhält die rechte Leseposition', async ({ page }) => {
  const errors: string[] = []; const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (!request.url().startsWith(baseURL) && !request.url().startsWith('data:')) external.push(request.url()); });
  await open(page);
  await expect(page.locator('.markdown-content .katex-display')).toHaveCount(1);
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(3);
  await expect(page.locator('.markdown-content table')).toHaveCount(1);
  await page.getByText('Selbsttest', { exact: true }).click();
  await expect(page.locator('.markdown-content details')).toHaveAttribute('open', '');
  await expect(page.locator('.markdown-content details')).toContainText('Die Antwort lautet 42.');
  const citation = page.locator('.citation-link').filter({ hasText: /^3$/ }).nth(8);
  await citation.scrollIntoViewIfNeeded();
  const right = page.locator('.markdown-scroll'); const before = await right.evaluate((node) => node.scrollTop);
  await citation.click();
  await expect(page.getByRole('button', { name: 'Whiteboard · Seite 3 / 7', exact: true })).toBeVisible();
  expect(Math.abs(await right.evaluate((node) => node.scrollTop) - before)).toBeLessThan(3);
  await expect(page.locator('.source-page.citation-target:visible')).toHaveAttribute('data-page', '3');
  await page.locator('.citation-link').filter({ hasText: /^8$/ }).nth(8).click();
  await expect(page.getByRole('tab', { name: 'Mini-Skript', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Mini-Skript · Seite 2 / 5', exact: true })).toBeVisible();
  await expect(page.locator('.source-pdf-scroll:visible [data-page="2"] canvas[data-rendered=true]')).toBeVisible();
  expect(Math.abs(await right.evaluate((node) => node.scrollTop) - before)).toBeLessThan(3);
  await page.getByRole('tab', { name: 'Whiteboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Whiteboard · Seite 3 / 7', exact: true })).toBeVisible();
  await page.locator('.source-pdf-scroll:visible [data-page="3"]').getByRole('button', { name: 'Folie 3 hineinzoomen', exact: true }).click();
  await expect(page.getByLabel('Vergrößerung Folie 3', { exact: true }).filter({ visible: true })).toHaveText('125 %');
  const separator = page.getByRole('separator', { name: 'Spaltenbreite ändern' }); await separator.focus(); await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '52');
  expect(await page.evaluate(() => (window as unknown as { __unsafe?: boolean }).__unsafe)).toBeUndefined();
  expect(external).toEqual([]); expect(errors).toEqual([]);
  await page.screenshot({ path: 'test-results/cryptography-reader.png' });
});

test('stellt Reiter und unabhängige Lesepositionen nach Serverneustart wieder her und erhält erledigt', async ({ page }) => {
  await open(page); await jump(page, 4);
  await page.getByRole('tab', { name: 'Mini-Skript', exact: true }).click();
  await expect(page.locator('.source-pdf-scroll:visible canvas[data-rendered=true]').first()).toBeVisible();
  await jump(page, 2);
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(3);
  await page.locator('.markdown-scroll').evaluate((node) => { node.scrollTop = (node.scrollHeight - node.clientHeight) * 0.45; });
  await page.getByRole('link', { name: '← Übersicht', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Moduldokumentation', exact: true })).toBeVisible();
  const state = JSON.parse(await readFile(join(root, 'notes', 'Cryptography', 'Lecture 1', 'state.json'), 'utf8'));
  expect(state.reader.activeDocumentId).toBe(script); expect(state.reader.positions[board].page).toBe(4);
  expect(state.reader.markdownScrollRatio).toBeCloseTo(0.45, 1);
  app.server.closeAllConnections(); await app.close(); app = await buildApp(loadConfig({ DATA_ROOT: root })); baseURL = await app.listen({ host: '127.0.0.1', port: 0 });
  await page.goto(baseURL);
  await page.getByRole('region', { name: 'Weiter mit', exact: true }).getByRole('link', { name: 'Öffnen', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Mini-Skript', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Mini-Skript · Seite 2 / 5', exact: true })).toBeVisible();
  await expect(page.locator('.mermaid-diagram svg')).toHaveCount(3);
  await expect.poll(async () => page.locator('.markdown-scroll').evaluate((node) => node.scrollTop / (node.scrollHeight - node.clientHeight))).toBeCloseTo(0.45, 1);
  await page.getByRole('checkbox', { name: 'erledigt', exact: true }).check();
  await expect(page.getByRole('checkbox', { name: 'erledigt', exact: true })).toBeEnabled();
  await page.getByRole('link', { name: '← Übersicht', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Weiter mit', exact: true })).toHaveCount(0);
  await expandModule(page, 'Cryptography'); await page.getByRole('link', { name: 'Lecture 1', exact: true }).click();
  await expect(page.getByRole('checkbox', { name: 'erledigt', exact: true })).toBeChecked();
});

test('findet nachträglich hinzugefügtes Markdown und zeigt vorher den fehlenden Inhalt an', async ({ page }) => {
  await page.goto(baseURL); await expandModule(page, 'Cryptography'); await page.getByRole('link', { name: 'Lecture 2', exact: true }).click();
  await expect(page.getByText('Für Lecture 2 liegt noch keine Markdown-Datei vor.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: '← Übersicht', exact: true }).click();
  await writeFile(join(module, 'mds', 'Lecture 2.md'), '# Nachträglich importiert\n\nEin Beleg [1][src-1].\n\n[src-1]: <mini-script.pdf#page=1>');
  await page.getByRole('button', { name: 'Neu einlesen', exact: true }).click();
  await expandModule(page, 'Cryptography'); await page.getByRole('link', { name: 'Lecture 2', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Nachträglich importiert', exact: true })).toBeVisible();
  await page.locator('.citation-link').filter({ hasText: /^1$/ }).click();
  await expect(page.getByRole('tab', { name: 'Mini-Skript', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('zählt die Drei-Sekunden-Regel nur für das eigene Whiteboard', async ({ page, request }) => {
  const seeded = await request.put(`${baseURL}/api/lectures/${id}/state`, { headers: { origin: baseURL }, data: { ...INITIAL_STATE, updatedAt: new Date().toISOString(),
    reader: { activeDocumentId: script, positions: { [script]: { page: 2, offsetRatio: 0 } }, markdownScrollRatio: 0 } } });
  expect(seeded.ok()).toBe(true);
  await page.goto(`${baseURL}/#vorlesung/${id}`);
  await expect(page.getByRole('button', { name: 'Mini-Skript · Seite 2 / 5', exact: true })).toBeVisible();
  await page.waitForTimeout(3300);
  expect((await (await request.get(`${baseURL}/api/lectures/${id}`)).json()).state.maxPageVisited).toBe(0);
  await page.getByRole('tab', { name: 'Whiteboard', exact: true }).click(); await jump(page, 3);
  await expect.poll(async () => (await (await request.get(`${baseURL}/api/lectures/${id}`)).json()).state.maxPageVisited, { timeout: 8000 }).toBeGreaterThanOrEqual(3);
});
