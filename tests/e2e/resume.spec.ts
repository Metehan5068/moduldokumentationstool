import { expectEditorText, setEditorSelection, editorSelection } from './editor';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { lectureId } from '../../src/server/registry';
import { lecturePdf } from '../fixtures/pdf';
import type { LectureState } from '../../src/shared/state';

let root: string;
let port: number;
let baseURL: string;
let processHandle: ChildProcess;
const title = 'Resume 20 Folien';
const id = lectureId(`module/ids/${title}.pdf`);
const directory = () => join(root, 'notes', 'ids', title);
async function start(request: APIRequestContext) {
  let diagnostics = '';
  processHandle = spawn(process.execPath, ['dist/node/server/index.js'], {
    cwd: process.cwd(), env: { ...process.env, DATA_ROOT: root, PORT: String(port) }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  processHandle.stdout?.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
  processHandle.stderr?.on('data', (chunk: Buffer) => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
  await expect.poll(async () => {
    if (processHandle.exitCode !== null) throw new Error(`Serverstart fehlgeschlagen: ${diagnostics}`);
    try { return (await request.get(`${baseURL}/api/health`, { timeout: 1000 })).ok(); } catch { return false; }
  }, { timeout: 15000 }).toBe(true);
}
async function stop() {
  if (processHandle && processHandle.exitCode === null) {
    const exited = new Promise<void>((resolve) => processHandle.once('exit', () => resolve()));
    processHandle.kill(); await exited;
  }
}
test.beforeAll(async ({ request }) => {
  const fixtures = join(process.cwd(), 'tests', 'fixtures', '.generated');
  await mkdir(fixtures, { recursive: true }); root = await mkdtemp(join(fixtures, 'phase4-'));
  await mkdir(join(root, 'module', 'ids'), { recursive: true });
  await writeFile(join(root, 'module', 'ids', `${title}.pdf`), lecturePdf(20));
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, '127.0.0.1', resolve));
  port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  baseURL = `http://127.0.0.1:${port}`;
  await start(request);
});
test.afterAll(async () => { await stop(); if (root) await rm(root, { recursive: true, force: true }); });
async function goTo(page: Page, number: number) {
  await page.keyboard.press('Control+g');
  await page.getByLabel('Gehe zu Folie').fill(String(number));
  await page.keyboard.press('Enter');
  await expect(page.getByLabel(`Notiz zu Folie ${number}`, { exact: true })).toBeFocused();
}
async function offset(page: Page, number: number) {
  return page.locator(`[data-page="${number}"]`).evaluate((row) => {
    const container = row.closest('.lecture-scroll')!;
    const bounds = row.getBoundingClientRect();
    return (container.getBoundingClientRect().top + container.clientTop - bounds.top) / bounds.height;
  });
}
async function storedState(): Promise<LectureState | undefined> {
  try { return JSON.parse(await readFile(join(directory(), 'state.json'), 'utf8')) as LectureState; } catch { return undefined; }
}

test('Plan-Abnahme: Folie 13 halb gescrollt, Cursor im Satz, Tab schließen, Serverprozess neu starten und weiterlernen', async ({ page, context, request }) => {
  await page.goto(baseURL); await page.getByRole('link', { name: title, exact: true }).click();
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await goTo(page, 13);
  const text = 'Die Entropie beschreibt die Unreinheit der Daten. Hier steht ein längerer Satz für die Cursor-Wiederherstellung. '.repeat(3);
  await page.getByLabel('Notiz zu Folie 13', { exact: true }).fill(text);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
  await page.locator('[data-page="13"]').evaluate((row) => {
    const container = row.closest('.lecture-scroll')!;
    const bounds = row.getBoundingClientRect();
    container.scrollTop += bounds.top - container.getBoundingClientRect().top - container.clientTop + bounds.height * 0.5;
  });
  await setEditorSelection(page.getByLabel('Notiz zu Folie 13', { exact: true }), 84, 84);
  expect(await offset(page, 13)).toBeCloseTo(0.5, 2);
  await page.close(); // pagehide muss den letzten Stand sofort senden, ohne auf den Throttle zu warten.
  await expect.poll(async () => {
    const state = await storedState();
    return state?.lastPage === 13 && state.activeNotePage === 13 && state.selection.start === 84 && state.selection.end === 84 && Math.abs(state.pageOffsetRatio - 0.5) < 0.005;
  }).toBe(true);
  const before = (await storedState())!;
  await stop(); await start(request); // Tatsächlich neuer Node-Prozess, gleicher Datenordner und Port.
  const reopened = await context.newPage(); await reopened.goto(baseURL);
  const resume = reopened.getByRole('region', { name: 'Weiter mit', exact: true });
  await expect(resume).toContainText('Folie 13 von 20');
  await resume.getByRole('link', { name: 'Öffnen', exact: true }).click();
  const note = reopened.getByLabel('Notiz zu Folie 13', { exact: true });
  await expect(note).toBeFocused(); await expectEditorText(note, text);
  expect(await editorSelection(note).then(({ start, end }) => ({ start, end }))).toEqual({ start: 84, end: 84 });
  expect(await offset(reopened, 13)).toBeCloseTo(before.pageOffsetRatio, 2);
  await expect(reopened.locator('[data-page="13"] canvas[data-rendered=true]')).toBeVisible();
  await reopened.screenshot({ path: 'test-results/phase4-resume.png' });
  await reopened.getByRole('checkbox', { name: 'erledigt', exact: true }).check();
  await expect(reopened.getByRole('checkbox', { name: 'erledigt', exact: true })).toBeChecked();
  await goTo(reopened, 20);
  await expect.poll(async () => (await (await request.get(`${baseURL}/api/lectures/${id}`)).json()).state.maxPageVisited, { timeout: 8000 }).toBe(20);
  await goTo(reopened, 3);
  await reopened.getByRole('link', { name: '← Übersicht' }).click();
  const row = reopened.locator('.lectures li').filter({ has: reopened.getByRole('link', { name: title, exact: true }) });
  await expect(row).toContainText('✓ erledigt'); await expect(row).toContainText('1 Notiz');
  const detail = await request.get(`${baseURL}/api/lectures/${id}`);
  expect((await detail.json()).state.maxPageVisited).toBe(20);
  await row.getByRole('link', { name: title, exact: true }).click();
  await expect(reopened.getByRole('checkbox', { name: 'erledigt', exact: true })).toBeChecked();
  await reopened.getByRole('checkbox', { name: 'erledigt', exact: true }).uncheck();
  await expect(reopened.getByRole('checkbox', { name: 'erledigt', exact: true })).not.toBeChecked();
  await reopened.getByRole('link', { name: '← Übersicht' }).click();
  await expect(row).toContainText('bis Folie 20/20');
  await reopened.screenshot({ path: 'test-results/phase4-overview.png' });
});

test('aktives Notizfeld und Cursor werden ohne Verschieben der separat gespeicherten Scrollposition wiederhergestellt', async ({ page }) => {
  const separateTitle = 'Getrennte Position';
  await writeFile(join(root, 'module', 'ids', `${separateTitle}.pdf`), lecturePdf(20));
  await page.goto(baseURL); await page.getByRole('link', { name: separateTitle, exact: true }).click();
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await goTo(page, 5); const note = page.getByLabel('Notiz zu Folie 5', { exact: true });
  await note.fill('Eine Auswahl im Text bleibt beim Scrollen erhalten.'); await page.keyboard.press('Control+s');
  await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
  await setEditorSelection(note, 5, 12);
  await page.keyboard.press('Escape');
  await expect(page.locator('.lecture-scroll')).toBeFocused();
  await page.locator('[data-page="13"]').evaluate((row) => row.scrollIntoView({ block: 'start' }));
  const scrollBefore = await page.locator('.lecture-scroll').evaluate((element) => element.scrollTop);
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const separateId = lectureId(`module/ids/${separateTitle}.pdf`);
  await expect.poll(async () => {
    const response = await page.request.get(`${baseURL}/api/lectures/${separateId}`);
    const detail = await response.json(); return detail.state.lastPage === 13 && detail.state.activeNotePage === 5 && detail.state.selection.end === 12;
  }).toBe(true);
  await page.reload(); await expect(note).toBeFocused();
  expect(await editorSelection(note).then(({ start, end }) => ({ start, end }))).toEqual({ start: 5, end: 12 });
  const scrollAfter = await page.locator('.lecture-scroll').evaluate((element) => element.scrollTop);
  expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(2);
});

test('relativer Seitenversatz bleibt bei anderer Fensterbreite erhalten', async ({ page, context, request }) => {
  const name = 'Andere Fensterbreite';
  const lecture = lectureId(`module/ids/${name}.pdf`);
  await writeFile(join(root, 'module', 'ids', `${name}.pdf`), lecturePdf(20));
  await page.goto(baseURL); await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await goTo(page, 13);
  await page.getByLabel('Notiz zu Folie 13', { exact: true }).fill('Cursor und relative Folienposition funktionieren auch bei anderer Fensterbreite.');
  await page.keyboard.press('Control+s'); await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
  await page.locator('[data-page="13"]').evaluate((row) => {
    const container = row.closest('.lecture-scroll')!;
    const bounds = row.getBoundingClientRect();
    container.scrollTop += bounds.top - container.getBoundingClientRect().top - container.clientTop + bounds.height * 0.42;
  });
  await setEditorSelection(page.getByLabel('Notiz zu Folie 13', { exact: true }), 15, 15);
  await page.close();
  await expect.poll(async () => {
    const response = await request.get(`${baseURL}/api/lectures/${lecture}`);
    const detail = await response.json(); return detail.state.lastPage === 13 && Math.abs(detail.state.pageOffsetRatio - 0.42) < 0.005 && detail.state.selection.start === 15;
  }).toBe(true);
  const reopened = await context.newPage(); await reopened.setViewportSize({ width: 1000, height: 800 });
  await reopened.goto(`${baseURL}/#vorlesung/${lecture}`);
  const note = reopened.getByLabel('Notiz zu Folie 13', { exact: true });
  await expect(note).toBeFocused(); expect(await offset(reopened, 13)).toBeCloseTo(0.42, 2);
  expect((await editorSelection(note)).start).toBe(15);
});

test('anhaltendes Scrollen erzeugt höchstens alle 1,5 Sekunden einen State-Request', async ({ page }) => {
  const name = 'Scroll-Throttle'; const lecture = lectureId(`module/ids/${name}.pdf`);
  await writeFile(join(root, 'module', 'ids', `${name}.pdf`), lecturePdf(20));
  const requests: number[] = [];
  page.on('request', (request) => { if (request.method() === 'PUT' && request.url().endsWith(`/api/lectures/${lecture}/state`)) requests.push(Date.now()); });
  await page.goto(baseURL); await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await page.locator('.lecture-scroll').evaluate(async (element) => {
    const end = performance.now() + 3600;
    let frame = 0;
    await new Promise<void>((resolve) => {
      function scroll() {
        element.scrollTop = (frame++ % 12) * 220;
        if (performance.now() < end) requestAnimationFrame(scroll); else resolve();
      }
      scroll();
    });
  });
  expect(requests.length).toBeGreaterThanOrEqual(2); expect(requests.length).toBeLessThanOrEqual(3);
  for (let index = 1; index < requests.length; index++) expect(requests[index]! - requests[index - 1]!).toBeGreaterThanOrEqual(1300);
});

test('fehlgeschlagenes Erledigt-Speichern wird angezeigt und der Haken zurückgesetzt', async ({ page }) => {
  const name = 'Erledigt Fehler'; const lecture = lectureId(`module/ids/${name}.pdf`);
  await writeFile(join(root, 'module', 'ids', `${name}.pdf`), lecturePdf(4));
  await page.goto(baseURL); await page.getByRole('link', { name, exact: true }).click();
  const checkbox = page.getByRole('checkbox', { name: 'erledigt', exact: true });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const endpoint = `**/api/lectures/${lecture}/completed`;
  await page.route(endpoint, async (route) => { await gate; await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"save_failed"}' }); });
  await checkbox.check(); release();
  await expect(page.getByRole('alert')).toContainText('Erledigt-Status konnte nicht gespeichert werden');
  await expect(checkbox).not.toBeChecked();
  expect((await (await page.request.get(`${baseURL}/api/lectures/${lecture}`)).json()).completed).toBe(false);
  await page.unroute(endpoint); await checkbox.check(); await expect(checkbox).toBeEnabled();
  expect((await (await page.request.get(`${baseURL}/api/lectures/${lecture}`)).json()).completed).toBe(true);
});

test('kurzer Strg+G-Sprung zählt nicht; ununterbrochene Sichtbarkeit und Notizbearbeitung zählen', async ({ page, request }) => {
  const name = 'Besuchsregel'; const lecture = lectureId(`module/ids/${name}.pdf`);
  await writeFile(join(root, 'module', 'ids', `${name}.pdf`), lecturePdf(20));
  const maximum = async () => (await (await request.get(`${baseURL}/api/lectures/${lecture}`)).json()).state.maxPageVisited as number;
  await page.goto(baseURL); await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await goTo(page, 18); await goTo(page, 1);
  await page.getByRole('link', { name: '← Übersicht' }).click();
  await expect(page.getByRole('heading', { name: 'Moduldokumentation', exact: true })).toBeVisible();
  expect(await maximum()).toBeLessThan(18);
  const row = page.locator('.lectures li').filter({ has: page.getByRole('link', { name, exact: true }) });
  const titleBox = await row.locator('.lecture-title').boundingBox(); const progressBox = await row.locator('.lecture-progress').boundingBox();
  expect(progressBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
  await row.getByRole('link', { name, exact: true }).click(); await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toBeFocused();
  await goTo(page, 18);
  // Fachliche Zeitgrenze: Zwei getrennte Aufenthalte von 1,8 s dürfen nicht addiert werden.
  await page.waitForTimeout(1800); expect(await maximum()).toBeLessThan(18);
  await goTo(page, 1); await goTo(page, 18);
  await page.waitForTimeout(1800); expect(await maximum()).toBeLessThan(18);
  await expect.poll(maximum, { timeout: 6500 }).toBeGreaterThanOrEqual(18);
  await goTo(page, 20); await page.getByLabel('Notiz zu Folie 20', { exact: true }).fill('Bearbeitung zählt sofort');
  await page.keyboard.press('Control+s'); await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
  expect(await maximum()).toBe(20);
});
