import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { lectureId } from '../../src/server/registry';
import { lecturePdf } from '../fixtures/pdf';

let root: string;
let app: FastifyInstance;
let baseURL: string;
const id = lectureId('module/ids/132 Folien, Test.pdf');

test.beforeAll(async () => {
  // Selbst erzeugte PDFs ausschließlich im ignorierten Fixture-Unterordner.
  const fixtures = join(process.cwd(), 'tests', 'fixtures', '.generated');
  await mkdir(fixtures, { recursive: true });
  root = await mkdtemp(join(fixtures, 'phase2-'));
  await mkdir(join(root, 'module', 'ids'), { recursive: true });
  await writeFile(join(root, 'module', 'ids', '132 Folien, Test.pdf'), lecturePdf(132));
  app = await buildApp(loadConfig({ DATA_ROOT: root }));
  baseURL = await app.listen({ host: '127.0.0.1', port: 0 });
});
test.afterAll(async () => {
  await app?.close();
  // root stammt aus mkdtemp unter tests/fixtures/.generated.
  if (root) await rm(root, { recursive: true, force: true });
});
async function openLecture(page: Page) {
  await page.goto(baseURL);
  await page.getByRole('link', { name: '132 Folien, Test' }).click();
  await expect(page.locator('.slide-row')).toHaveCount(132);
  await expect(page.locator('canvas[data-rendered=true]').first()).toBeVisible();
}
async function jump(page: Page, number: number) {
  await page.keyboard.press('Control+g');
  await page.getByLabel('Gehe zu Folie').fill(String(number));
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
  await expect(page.getByLabel(`Notiz zu Folie ${number}`, { exact: true })).toBeFocused();
  await expect(page.locator(`[data-page="${number}"] canvas[data-rendered=true]`)).toBeVisible();
}

test('Kürzel funktionieren direkt nach dem Öffnen ohne vorherigen Klick', async ({ page }) => {
  await openLecture(page);
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByLabel('Notiz zu Folie 2', { exact: true })).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await page.reload();
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await page.keyboard.press('Control+g');
  await expect(page.getByLabel('Gehe zu Folie')).toBeFocused();
  await page.getByLabel('Gehe zu Folie').fill('3');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Notiz zu Folie 3', { exact: true })).toBeFocused();
});

test('132 Folien: Zeilenzuordnung, Tastatur, Trenner und dauerhafte Textareas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const external: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith(baseURL) && /^https?:/.test(request.url())) external.push(request.url()); });
  await openLecture(page);
  await expect(page.locator('textarea')).toHaveCount(132);
  await page.getByLabel('Notiz zu Folie 1', { exact: true }).fill('Lokaler Entwurf bleibt beim Scrollen erhalten.');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByLabel('Notiz zu Folie 6', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lecture-scroll')).toBeFocused();
  await jump(page, 132);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByLabel('Notiz zu Folie 132', { exact: true })).toBeFocused();
  await jump(page, 1);
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toHaveValue('Lokaler Entwurf bleibt beim Scrollen erhalten.');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  const separator = page.getByRole('separator', { name: 'Spaltenbreite ändern' });
  await separator.focus();
  await page.keyboard.press('ArrowRight');
  await expect(separator).toHaveAttribute('aria-valuenow', '52');
  const rect = await separator.boundingBox();
  if (!rect) throw new Error('Trenner nicht sichtbar');
  await page.mouse.move(rect.x + rect.width / 2, 300);
  await page.mouse.down(); await page.mouse.move(850, 300); await page.mouse.up();
  expect(Number(await separator.getAttribute('aria-valuenow'))).toBeGreaterThan(55);
  const ratio = await separator.getAttribute('aria-valuenow');
  for (const number of [1, 10, 67, 132]) {
    await jump(page, number);
    const row = page.locator(`[data-page="${number}"]`);
    await expect(row.getByLabel(`Notiz zu Folie ${number}`, { exact: true })).toHaveCount(1);
    const figure = await row.locator('figure').boundingBox();
    const note = await row.locator('.note-card').boundingBox();
    expect(figure).not.toBeNull(); expect(note).not.toBeNull();
    expect(Math.abs(figure!.y - note!.y)).toBeLessThan(1);
    expect(Math.abs(figure!.height - note!.height)).toBeLessThan(1);
  }
  await page.screenshot({ path: 'test-results/phase2-132-pages.png' });
  await page.getByLabel('Notiz zu Folie 1', { exact: true }).fill('');
  await page.reload();
  await expect(page.locator('.slide-row')).toHaveCount(132);
  await expect(page.getByRole('separator')).toHaveAttribute('aria-valuenow', ratio!);
  expect(errors).toEqual([]); expect(external).toEqual([]);
});

test('132 Folien: Canvas-Speicher und Renderzeiten bleiben beim Durchscrollen begrenzt', async ({ page, context }) => {
  test.setTimeout(120000);
  await openLecture(page);
  const cdp = await context.newCDPSession(page);
  let maximumCanvases = 0;
  let maximumBytes = 0;
  const renderTimes: number[] = [];
  const heaps: number[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (let number = 1; number <= 132; number++) {
      const start = Date.now();
      await page.locator(`[data-page="${number}"]`).evaluate((row) => row.scrollIntoView({ block: 'start' }));
      await expect(page.locator(`[data-page="${number}"] canvas[data-rendered=true]`)).toBeVisible();
      renderTimes.push(Date.now() - start);
      const sample = await page.locator('canvas').evaluateAll((canvases) => ({
        count: canvases.length,
        bytes: canvases.reduce((sum, element) => {
          const canvas = element as HTMLCanvasElement;
          return sum + canvas.width * canvas.height * 4;
        }, 0),
      }));
      maximumCanvases = Math.max(maximumCanvases, sample.count);
      maximumBytes = Math.max(maximumBytes, sample.bytes);
      expect(sample.count).toBeLessThanOrEqual(9);
      expect(sample.bytes).toBeLessThan(45 * 1024 * 1024);
      await expect(page.locator('textarea')).toHaveCount(132);
    }
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    heaps.push(heap.usedSize);
    test.info().annotations.push({ type: `Heap nach Durchlauf ${pass + 1}`, description: `${Math.round(heap.usedSize / 1024 / 1024)} MiB` });
  }
  expect(heaps[1]! - heaps[0]!).toBeLessThan(20 * 1024 * 1024);
  test.info().annotations.push({ type: 'Abnahme', description: `132 Seiten; maximal ${maximumCanvases} Canvases, ${Math.round(maximumBytes / 1024 / 1024)} MiB Canvas-Bitmaps; langsamster Sprung inkl. Rendering ${Math.max(...renderTimes)} ms` });
  await page.screenshot({ path: 'test-results/phase2-memory.png' });
});

test('direkter Einstieg, HiDPI und Resize rendern scharf; unbekannte IDs zeigen einen Fehler', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: 2 });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await page.goto(`${baseURL}/#vorlesung/${id}`);
    const canvas = page.locator('[data-page="1"] canvas[data-rendered=true]');
    await expect(canvas).toBeVisible();
    const pixels = () => canvas.evaluate((element) => ({ actual: (element as HTMLCanvasElement).width, css: element.getBoundingClientRect().width }));
    let size = await pixels();
    expect(Math.abs(size.actual - size.css * 2)).toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1200, height: 900 });
    await expect.poll(async () => (await pixels()).actual).toBeGreaterThan(size.actual);
    size = await pixels();
    expect(Math.abs(size.actual - size.css * 2)).toBeLessThanOrEqual(1);
    for (const asset of ['standard_fonts/LiberationSans-Regular.ttf', 'wasm/openjpeg.wasm', 'cmaps/Adobe-Japan1-UCS2.bcmap']) {
      const response = await page.request.get(`${baseURL}/pdf-assets/${asset}`);
      expect(response.status()).toBe(200);
      expect(response.headers()['content-type']).not.toContain('text/html');
    }
    await page.goto(`${baseURL}/#vorlesung/0000000000000000`);
    await expect(page.getByRole('alert')).toContainText('Vorlesung konnte nicht geladen werden');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
