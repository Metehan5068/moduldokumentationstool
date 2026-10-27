import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/server/app';
import { loadConfig } from '../../src/server/config';
import { lectureId } from '../../src/server/registry';
import { lecturePdf } from '../fixtures/pdf';
import { newNotes, parseNotes, serializeNotes } from '../../src/shared/notes';

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
  await page.keyboard.press('Control+s');
  await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
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

async function openNotesLecture(page: Page, title: string) {
  await writeFile(join(root, 'module', 'ids', `${title}.pdf`), lecturePdf(4));
  await page.goto(baseURL);
  await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  return join(root, 'notes', 'ids', title, 'notes.md');
}
const savedStatus = (page: Page) => page.locator('.lecture-toolbar [role=status]');

test('Autosave, Blur und Strg+S überleben Reload und erhalten externe Änderungen an anderen Seiten', async ({ page }) => {
  const path = await openNotesLecture(page, 'Autosave');
  await jump(page, 3);
  const note = page.getByLabel('Notiz zu Folie 3', { exact: true });
  const text = '\n# Eigene Überschrift\nÄnderung mit Umlauten\n<!-- lecture-note:page=4 -->\n\\<!-- /lecture-note -->\n\n';
  await note.fill(text);
  await expect(savedStatus(page)).toHaveText('Ungespeichert');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  await page.reload();
  await expect(page.getByLabel('Notiz zu Folie 3', { exact: true })).toHaveValue(text);
  const document = parseNotes(await readFile(path, 'utf8'));
  document.notes[2] = 'Extern an einer anderen Folie ergänzt';
  await writeFile(path, serializeNotes(document));
  await page.getByLabel('Notiz zu Folie 3', { exact: true }).fill(`${text}Noch etwas`);
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(path, 'utf8')).notes[2]).toBe('Extern an einer anderen Folie ergänzt');
  await page.getByLabel('Notiz zu Folie 1', { exact: true }).fill('Sofort bei Folienwechsel');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe('Sofort bei Folienwechsel');
  await page.getByLabel('Notiz zu Folie 4', { exact: true }).fill('Beim Verlassen der Ansicht speichern');
  await page.getByRole('link', { name: '← Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Moduldokumentation', exact: true })).toBeVisible();
  expect(parseNotes(await readFile(path, 'utf8')).notes[4]).toBe('Beim Verlassen der Ansicht speichern');
  expect(parseNotes(await readFile(path, 'utf8')).notes[2]).toBe('Extern an einer anderen Folie ergänzt');
});

for (const choice of ['Eigene behalten', 'Datei übernehmen', 'Beide zusammenfügen']) {
  test(`Konflikt gleicher Seite: ${choice}`, async ({ page }) => {
    const title = `Konflikt ${choice}`;
    const path = await openNotesLecture(page, title);
    const document = newNotes(`module/ids/${title}.pdf`, title, 4);
    document.notes[1] = 'Dateifassung aus dem Editor';
    await writeFile(path, serializeNotes(document));
    await page.getByLabel('Notiz zu Folie 1', { exact: true }).fill('Meine Fassung aus der App');
    await page.keyboard.press('Control+s');
    const conflict = page.getByRole('group', { name: 'Konflikt Folie 1' });
    await expect(conflict).toBeVisible();
    await expect(page.getByLabel('Dateifassung Folie 1', { exact: true })).toHaveValue('Dateifassung aus dem Editor');
    await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toHaveValue('Meine Fassung aus der App');
    if (choice === 'Beide zusammenfügen') await page.screenshot({ path: 'test-results/phase3-conflict.png', fullPage: true });
    expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe('Dateifassung aus dem Editor');
    // Auch Browsernavigation innerhalb der SPA darf einen ungelösten Entwurf nicht verwerfen.
    await page.getByRole('link', { name: '← Übersicht' }).click();
    await expect(conflict).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#vorlesung/${lectureId(`module/ids/${title}.pdf`)}$`));
    await conflict.getByRole('button', { name: choice, exact: true }).click();
    await expect(savedStatus(page)).toHaveText('Gespeichert');
    const expected = choice === 'Datei übernehmen' ? 'Dateifassung aus dem Editor' : choice === 'Eigene behalten' ? 'Meine Fassung aus der App' : 'Dateifassung aus dem Editor\n\nMeine Fassung aus der App';
    await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toHaveValue(expected);
    await page.reload();
    await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toHaveValue(expected);
    expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe(expected);
  });
}

test('Speicherfehler behalten Text, bieten Wiederholen und versuchen automatisch erneut', async ({ page }) => {
  const path = await openNotesLecture(page, 'Wiederholung');
  const endpoint = `**/api/lectures/${lectureId('module/ids/Wiederholung.pdf')}/notes/1`;
  let failures = 1;
  await page.route(endpoint, async (route) => {
    if (failures-- > 0) await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"save_failed"}' });
    else await route.continue();
  });
  const note = page.getByLabel('Notiz zu Folie 1', { exact: true });
  await note.fill('Text bleibt im Browser');
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Fehler beim Speichern');
  await expect(note).toHaveValue('Text bleibt im Browser');
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  failures = 1;
  await note.fill('Auch automatische Wiederholung funktioniert');
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Fehler beim Speichern');
  await expect(savedStatus(page)).toHaveText('Gespeichert', { timeout: 8000 });
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe('Auch automatische Wiederholung funktioniert');
});

test('kaputte Notizdateien bleiben unverändert und werden nach Reparatur wieder beschreibbar', async ({ page }) => {
  const title = 'Reparatur';
  const path = await openNotesLecture(page, title);
  const broken = '<!-- lecture-note:page=1 -->\n## Folie 1\n\nEndmarker fehlt';
  await writeFile(path, broken);
  await page.getByLabel('Notiz zu Folie 1', { exact: true }).fill('Entwurf wird behalten');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('alert')).toContainText('Zeile 1');
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toHaveAttribute('readonly', '');
  expect(await readFile(path, 'utf8')).toBe(broken);
  await writeFile(path, serializeNotes(newNotes(`module/ids/${title}.pdf`, title, 4)));
  await page.getByRole('button', { name: 'Datei erneut prüfen' }).click();
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toHaveValue('Entwurf wird behalten');
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe('Entwurf wird behalten');
});

test('warnt bei ungespeicherten Änderungen und flusht ausstehende Notizen bei pagehide', async ({ page }) => {
  const path = await openNotesLecture(page, 'Seite verlassen');
  await page.getByLabel('Notiz zu Folie 1', { exact: true }).fill('Beim Ausblenden sichern');
  const warns = () => page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(await warns()).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(await warns()).toBe(false);
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe('Beim Ausblenden sichern');
});
