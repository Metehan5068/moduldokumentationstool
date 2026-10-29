import { expectEditorText, setEditorSelection, editorSelection } from './editor';
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
let id: string;
let lectureTitle: string;
let fixtureCount = 0;

test.beforeAll(async () => {
  // Selbst erzeugte PDFs ausschließlich im ignorierten Fixture-Unterordner.
  const fixtures = join(process.cwd(), 'tests', 'fixtures', '.generated');
  await mkdir(fixtures, { recursive: true });
  root = await mkdtemp(join(fixtures, 'phase2-'));
  await mkdir(join(root, 'module', 'ids'), { recursive: true });
  app = await buildApp(loadConfig({ DATA_ROOT: root }));
  baseURL = await app.listen({ host: '127.0.0.1', port: 0 });
});
test.beforeEach(async () => {
  // Jede Abnahme startet mit einer eigenen Vorlesung und unabhängiger Leseposition.
  lectureTitle = `132 Folien, Test ${++fixtureCount}`;
  id = lectureId(`module/ids/${lectureTitle}.pdf`);
  await writeFile(join(root, 'module', 'ids', `${lectureTitle}.pdf`), lecturePdf(132));
});
test.afterAll(async () => {
  await app?.close();
  // root stammt aus mkdtemp unter tests/fixtures/.generated.
  if (root) await rm(root, { recursive: true, force: true });
});
async function openLecture(page: Page) {
  await page.goto(baseURL);
  await page.getByRole('link', { name: lectureTitle, exact: true }).click();
  await expect(page.locator('.slide-row')).toHaveCount(132);
  await expect(page.locator('canvas[data-rendered=true]:visible').first()).toBeVisible();
}
async function jump(page: Page, number: number) {
  await page.keyboard.press('Control+g');
  await page.getByLabel('Gehe zu Folie').fill(String(number));
  await page.getByRole('button', { name: 'Öffnen', exact: true }).click();
  await expect(page.getByLabel(`Notiz zu Folie ${number}`, { exact: true })).toBeFocused();
  await expect(page.locator(`[data-page="${number}"] canvas[data-rendered=true]`)).toBeVisible();
}

test('Kopieren: Eingaben prüfen, ungespeicherte Quelle unabhängig übernehmen, Undo und Speichern', async ({ page }) => {
  const path = await openNotesLecture(page, 'Notizkopie Entwurf');
  const source = page.getByLabel('Notiz zu Folie 2', { exact: true });
  const target = page.getByLabel('Notiz zu Folie 1', { exact: true });
  const endpoint = `**/api/lectures/${lectureId('module/ids/Notizkopie Entwurf.pdf')}/notes/2`;
  let failing = true;
  await page.route(endpoint, async (route) => {
    if (failing) await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"save_failed"}' });
    else await route.continue();
  });
  const text = '- Noch ungespeicherter Quelltext\n    - Mit Unterpunkt';
  await source.fill(text);
  await page.getByRole('button', { name: 'Kopieren: Notiz zu Folie 1', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Notiz aus anderer Folie kopieren' });
  const input = dialog.getByLabel('Von Folie');
  const accept = dialog.getByRole('button', { name: 'Notiz übernehmen', exact: true });
  await expect(input).toBeFocused();
  for (const value of ['0', '5', '1.5']) {
    await input.fill(value); await accept.click();
    await expect(dialog.getByRole('alert')).toHaveText('Bitte eine Foliennummer von 1 bis 4 eingeben.');
  }
  await input.fill('1'); await accept.click();
  await expect(dialog.getByRole('alert')).toContainText('andere Folie');
  await input.fill('4'); await accept.click();
  await expect(dialog.getByRole('alert')).toContainText('keine Notiz');
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Control+g');
  await expect(page.getByLabel('Gehe zu Folie')).toHaveCount(0);
  await expectEditorText(target, '');
  await input.fill('2'); await accept.click();
  await expect(dialog).toHaveCount(0);
  await expectEditorText(target, text);
  await expect(target).toBeFocused();
  await expectEditorText(source, text);
  await page.keyboard.press('Control+z');
  await expectEditorText(target, '');
  await page.keyboard.press('Control+Shift+z');
  await expectEditorText(target, text);
  await source.fill('- Später geänderte Quelle');
  await expectEditorText(target, text);
  failing = false;
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  const stored = parseNotes(await readFile(path, 'utf8')).notes;
  expect(stored[1]).toBe(text); expect(stored[2]).toBe('- Später geänderte Quelle');
  await page.reload();
  await expectEditorText(target, text);
  await expectEditorText(source, '- Später geänderte Quelle');
});

test('Kopieren: Ersetzen erst bestätigen, abbrechen und Nicht-relevant-Notizen in beide Richtungen kopieren', async ({ page }) => {
  const path = await openNotesLecture(page, 'Notizkopie Ansichten');
  const source = page.getByLabel('Notiz zu Folie 1', { exact: true });
  const target = page.getByLabel('Notiz zu Folie 2', { exact: true });
  await source.fill('- Unveränderte Quelle');
  await target.fill('- Eigener Zieltext');
  const open = page.getByRole('button', { name: 'Kopieren: Notiz zu Folie 2', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Die vorhandene Zielnotiz wird dabei ersetzt.');
  await page.keyboard.press('Escape');
  await expectEditorText(target, '- Eigener Zieltext');
  await open.click();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expectEditorText(target, '- Eigener Zieltext');
  await open.click();
  await dialog.getByLabel('Von Folie').fill('1');
  await page.screenshot({ path: 'test-results/note-copy-dialog.png' });
  await dialog.getByRole('button', { name: 'Text ersetzen und übernehmen', exact: true }).click();
  await expectEditorText(target, '- Unveränderte Quelle');
  await expect(target).toBeFocused();
  await page.getByRole('button', { name: 'Nicht relevant: Notiz zu Folie 3', exact: true }).click();
  await open.click();
  await dialog.getByLabel('Von Folie').fill('3');
  await dialog.getByRole('button', { name: 'Text ersetzen und übernehmen', exact: true }).click();
  await expect(target).toHaveText('Keine relevanten Informationen enthalten');
  await expect(target).toBeFocused();
  await expect(page.getByRole('button', { name: 'Nicht relevant: Notiz zu Folie 3', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await open.click();
  await page.keyboard.press('Escape');
  await expect(target).toHaveText('Keine relevanten Informationen enthalten');
  await open.click();
  await dialog.getByLabel('Von Folie').fill('1');
  await dialog.getByRole('button', { name: 'Text ersetzen und übernehmen', exact: true }).click();
  await expectEditorText(target, '- Unveränderte Quelle');
  await expect(target).toBeFocused();
  await expect(page.getByRole('button', { name: 'Stichpunkte: Notiz zu Folie 2', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Kopieren: Notiz zu Folie 4', exact: true }).click();
  await dialog.getByLabel('Von Folie').fill('3');
  await dialog.getByRole('button', { name: 'Notiz übernehmen', exact: true }).click();
  await expect(page.getByLabel('Notiz zu Folie 4', { exact: true })).toHaveText('Keine relevanten Informationen enthalten');
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(path, 'utf8')).notes).toEqual({ 1: '- Unveränderte Quelle', 2: '- Unveränderte Quelle', 3: '- Nicht relevant', 4: '- Nicht relevant' });
  await page.reload();
  await expectEditorText(target, '- Unveränderte Quelle');
  await expect(page.getByLabel('Notiz zu Folie 4', { exact: true })).toHaveText('Keine relevanten Informationen enthalten');
});

test('Kopieren: ungelöste Quelle blockieren, geändertes Ziel schützen und Schreibschutz beachten', async ({ page }) => {
  await openNotesLecture(page, 'Notizkopie Konflikt');
  const source = page.getByLabel('Notiz zu Folie 1', { exact: true });
  const target = page.getByLabel('Notiz zu Folie 2', { exact: true });
  const lecture = lectureId('module/ids/Notizkopie Konflikt.pdf');
  await page.route(`**/api/lectures/${lecture}/notes/1`, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ currentText: '- Andere Quellfassung', currentHash: 'a'.repeat(64) }) }));
  await source.fill('- Lokale Quellfassung');
  await page.keyboard.press('Control+s');
  const sourceConflict = page.getByRole('group', { name: 'Konflikt Folie 1', exact: true });
  await expect(sourceConflict).toBeVisible();
  const open = page.getByRole('button', { name: 'Kopieren: Notiz zu Folie 2', exact: true });
  await open.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Von Folie').fill('1');
  await dialog.getByRole('button', { name: 'Notiz übernehmen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Quellnotiz hat einen ungelösten Konflikt');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await sourceConflict.getByRole('button', { name: 'Datei übernehmen', exact: true }).click();
  const endpoint = `**/api/lectures/${lecture}/notes/2`;
  let release: (() => void) | undefined;
  await page.route(endpoint, async (route) => {
    await new Promise<void>((done) => { release = done; });
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ currentText: '- Andere Zielfassung', currentHash: 'b'.repeat(64) }) });
  });
  await target.fill('- Mein Zieltext');
  await open.click();
  await dialog.getByLabel('Von Folie').fill('1');
  await expect.poll(() => Boolean(release)).toBe(true); release!();
  const targetConflict = page.getByRole('group', { name: 'Konflikt Folie 2', exact: true });
  await expect(targetConflict).toBeVisible();
  await dialog.getByRole('button', { name: 'Text ersetzen und übernehmen', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Zielnotiz hat sich inzwischen geändert');
  await expectEditorText(target, '- Mein Zieltext');
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await open.click();
  await dialog.getByLabel('Von Folie').fill('1');
  await dialog.getByRole('button', { name: 'Text ersetzen und übernehmen', exact: true }).click();
  await expectEditorText(target, '- Andere Quellfassung');
  await expect(targetConflict).toBeVisible();
  await targetConflict.getByRole('button', { name: 'Datei übernehmen', exact: true }).click();
  await page.unroute(endpoint);
  await page.route(endpoint, (route) => route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'Test: schreibgeschützt' }) }));
  await target.fill('- Geschützter Entwurf');
  await open.click();
  await expect(dialog.getByRole('button', { name: 'Text ersetzen und übernehmen', exact: true })).toBeDisabled();
  await expect(open).toBeDisabled();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expectEditorText(target, '- Geschützter Entwurf');
});

test('Nicht relevant: leer markieren, Fehler wiederholen, Fokus, Speichern und leeres Feld wieder öffnen', async ({ page }) => {
  const path = await openNotesLecture(page, 'Relevanz leer');
  const note = page.getByLabel('Notiz zu Folie 1', { exact: true });
  const toggle = page.getByRole('button', { name: 'Nicht relevant: Notiz zu Folie 1', exact: true });
  const endpoint = `**/api/lectures/${lectureId('module/ids/Relevanz leer.pdf')}/notes/1`;
  let failing = true;
  await page.route(endpoint, async (route) => {
    if (failing) await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"save_failed"}' });
    else await route.continue();
  });
  await toggle.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(note).toHaveText('Keine relevanten Informationen enthalten');
  await expect(note).toBeFocused();
  await expect(page.locator('[data-page="1"] .cm-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Stichpunkte: Notiz zu Folie 1', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Fehler beim Speichern');
  await expect(note).toHaveText('Keine relevanten Informationen enthalten');
  failing = false;
  await page.getByRole('button', { name: 'Wiederholen', exact: true }).click();
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe('- Nicht relevant');
  await page.screenshot({ path: 'test-results/not-relevant.png' });
  await note.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByLabel('Notiz zu Folie 2', { exact: true })).toBeFocused();
  await page.keyboard.press('Alt+ArrowUp');
  await expect(note).toBeFocused();
  await page.reload();
  await expect(note).toBeFocused();
  await expect(note).toHaveText('Keine relevanten Informationen enthalten');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expectEditorText(note, '');
  await expect(note).toBeFocused();
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBeUndefined();
});

test('Nicht relevant: Bestand erkennen ohne Migration; weiter getippte Sätze bleiben editierbar', async ({ page }) => {
  const path = await openNotesLecture(page, 'Relevanz Bestand');
  const document = newNotes('module/ids/Relevanz Bestand.pdf', 'Relevanz Bestand', 4);
  document.notes = { 1: '- nicht relevant', 2: '  -   NICHT\tRELEVANT \n', 3: '- nicht relevant, weil eine Frage offen ist', 4: 'Eine Frage\n- Nicht relevant' };
  const before = serializeNotes(document);
  await writeFile(path, before);
  await page.reload();
  for (const number of [1, 2]) {
    await expect(page.getByRole('button', { name: `Nicht relevant: Notiz zu Folie ${number}`, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByLabel(`Notiz zu Folie ${number}`, { exact: true })).toHaveText('Keine relevanten Informationen enthalten');
  }
  for (const number of [3, 4]) await expect(page.getByRole('button', { name: `Nicht relevant: Notiz zu Folie ${number}`, exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(parseNotes(await readFile(path, 'utf8')).notes).toEqual(document.notes);
  await jump(page, 3);
  const note = page.getByLabel('Notiz zu Folie 3', { exact: true });
  await note.fill('- nicht relevant');
  await expect(page.getByRole('button', { name: 'Nicht relevant: Notiz zu Folie 3', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('End');
  await page.keyboard.type(', weil noch eine Frage offen ist');
  await expectEditorText(note, '- nicht relevant, weil noch eine Frage offen ist');
});

test('Nicht relevant: Text nur nach Bestätigung verwerfen; Abbrechen und Escape erhalten ihn', async ({ page }) => {
  const path = await openNotesLecture(page, 'Relevanz Bestätigung');
  const note = page.getByLabel('Notiz zu Folie 1', { exact: true });
  const toggle = page.getByRole('button', { name: 'Nicht relevant: Notiz zu Folie 1', exact: true });
  const text = '- Diese wichtige Frage darf nicht versehentlich verloren gehen.';
  await note.fill(text);
  await toggle.click();
  const dialog = page.getByRole('dialog', { name: 'Notiz als nicht relevant markieren?' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeFocused();
  await expectEditorText(note, text);
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Control+g');
  await expect(page.getByLabel('Gehe zu Folie')).toHaveCount(0);
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe(text);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(note).toBeFocused();
  await expectEditorText(note, text);
  await toggle.click();
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expectEditorText(note, text);
  await toggle.click();
  await page.screenshot({ path: 'test-results/not-relevant-confirm.png' });
  await dialog.getByRole('button', { name: 'Text verwerfen und markieren', exact: true }).click();
  await expect(note).toHaveText('Keine relevanten Informationen enthalten');
  await expect(note).toBeFocused();
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe('- Nicht relevant');
  await toggle.click();
  await expectEditorText(note, '');
});

test('Nicht relevant: Konflikte bleiben sichtbar; geänderte Notizen werden nicht blind bestätigt', async ({ page }) => {
  await openNotesLecture(page, 'Relevanz Konflikt');
  const note = page.getByLabel('Notiz zu Folie 1', { exact: true });
  const toggle = page.getByRole('button', { name: 'Nicht relevant: Notiz zu Folie 1', exact: true });
  const endpoint = `**/api/lectures/${lectureId('module/ids/Relevanz Konflikt.pdf')}/notes/1`;
  let release: (() => void) | undefined;
  await page.route(endpoint, async (route) => {
    await new Promise<void>((resolve) => { release = resolve; });
    await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ currentText: 'Zwischenzeitlich geänderte Dateifassung', currentHash: 'a'.repeat(64) }) });
  });
  await note.fill('Meine Frage');
  await toggle.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect.poll(() => Boolean(release)).toBe(true);
  release!();
  await expect(page.getByRole('group', { name: 'Konflikt Folie 1', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Text verwerfen und markieren', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Die Notiz hat sich inzwischen geändert');
  await expectEditorText(note, 'Meine Frage');
  await toggle.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Text verwerfen und markieren', exact: true }).click();
  await expect(note).toHaveText('Keine relevanten Informationen enthalten');
  await expect(page.getByRole('group', { name: 'Konflikt Folie 1', exact: true })).toBeVisible();
  await page.unroute(endpoint);
  await page.getByRole('button', { name: 'Datei übernehmen', exact: true }).click();
  await expectEditorText(note, 'Zwischenzeitlich geänderte Dateifassung');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await page.route(endpoint, async (route) => {
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'notes_invalid', message: 'Test: Datei schreibgeschützt' }) });
  });
  await note.fill('Entwurf bleibt bei Schreibschutz erhalten');
  await toggle.click();
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Text verwerfen und markieren', exact: true })).toBeDisabled();
  await expect(toggle).toBeDisabled();
  await page.getByRole('dialog').getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expectEditorText(note, 'Entwurf bleibt bei Schreibschutz erhalten');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('Hängender Listeneinzug: echte Zeichenpositionen, verschachtelte Punkte und exakter Text nach Resize/Reload', async ({ page }) => {
  const path = await openNotesLecture(page, 'Hängender Einzug');
  const note = page.getByLabel('Notiz zu Folie 1', { exact: true });
  const text = [
    'Prosa bleibt gewöhnlicher Text ohne Listeneinzug.',
    '- ' + 'Ein langer Stichpunkt behält seinen Text und läuft automatisch in die nächste sichtbare Zeile. '.repeat(3),
    '    - ' + 'Ein Unterpunkt erhält denselben hängenden Einzug auf seiner eigenen Ebene. '.repeat(3),
    '        - ' + 'LangesWort'.repeat(15),
    '      Eine bewusst gespeicherte Fortsetzungszeile bleibt ebenfalls exakt erhalten.',
  ].join('\n');
  await note.fill(text);
  await expectEditorText(note, text);
  await page.getByRole('button', { name: 'Stichpunkte: Notiz zu Folie 1', exact: true }).focus();
  await page.locator('[data-page="1"] .note-field-toolbar label').click();
  await expect(note).toBeFocused();
  await expect(page.getByRole('button', { name: 'Stichpunkte: Notiz zu Folie 1', exact: true })).toHaveAttribute('aria-pressed', 'false');
  const geometry = async () => note.evaluate((element) => {
    return [...element.querySelectorAll('.cm-line')].filter((line) => /^[ \t]*- /.test(line.textContent ?? '')).map((line) => {
      const text = line.textContent!;
      const prefix = text.match(/^[ \t]*- /)![0].length;
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) nodes.push(walker.currentNode as Text);
      const character = (position: number) => {
        for (const node of nodes) {
          if (position < node.length) {
            const range = document.createRange(); range.setStart(node, position); range.setEnd(node, position + 1);
            return range.getBoundingClientRect();
          }
          position -= node.length;
        }
        throw new Error('Character not rendered');
      };
      const first = character(prefix);
      for (let offset = prefix + 1; offset < text.length; offset++) {
        const next = character(offset);
        if (next.top > first.top + 5 && next.width > 0) return { first: first.left, wrapped: next.left, wrappedY: next.top, firstY: first.top };
      }
      throw new Error('Expected a wrapped logical bullet');
    });
  });
  const verify = async () => {
    const positions = await geometry();
    expect(positions).toHaveLength(3);
    for (const position of positions) expect(Math.abs(position.first - position.wrapped)).toBeLessThan(1);
    expect(positions[1]!.first).toBeGreaterThan(positions[0]!.first + 10);
    expect(positions[2]!.first).toBeGreaterThan(positions[1]!.first + 10);
  };
  await verify();
  await page.screenshot({ path: 'test-results/hanging-indent.png' });
  await page.setViewportSize({ width: 1000, height: 800 });
  await expect.poll(async () => (await geometry())[0]!.wrappedY).not.toBe((await geometry())[0]!.firstY);
  await verify();
  await expectEditorText(note, text);
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe(text);
  await page.reload();
  await expectEditorText(note, text);
  await verify();
  // Contenteditable paste must retain plain text instead of introducing rich HTML.
  await note.focus();
  await page.keyboard.press('Control+End');
  await note.evaluate((element) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData('text/plain', '\n- Eingefügter Klartext');
    clipboardData.setData('text/html', '<h1>Anderer HTML-Inhalt</h1>');
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
  });
  await expectEditorText(note, `${text}\n- Eingefügter Klartext`);
  await page.keyboard.press('Control+z');
  await expectEditorText(note, text);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await expectEditorText(note, '');
  await page.keyboard.press('Control+z');
  await expectEditorText(note, text);
});

test('Stichpunkte: Auswahl, Listenebenen, leere Punkte, Rücktaste, Undo und Speichern', async ({ page }) => {
  const path = await openNotesLecture(page, 'Stichpunkte');
  const note = page.getByLabel('Notiz zu Folie 1', { exact: true });
  const toggle = page.getByRole('button', { name: 'Stichpunkte: Notiz zu Folie 1', exact: true });
  await note.fill('Alpha Beta');
  await setEditorSelection(note, 6, 10);
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expectEditorText(note, '- Alpha Beta');
  expect((await editorSelection(note)).text).toBe('Beta');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await expectEditorText(note, '- Alpha Beta\n- \n- ');
  await page.keyboard.press('Tab');
  await expectEditorText(note, '- Alpha Beta\n- \n    - ');
  await page.keyboard.type('Unterpunkt');
  await page.keyboard.press('Enter');
  await expectEditorText(note, '- Alpha Beta\n- \n    - Unterpunkt\n    - ');
  await page.keyboard.press('Backspace');
  await expectEditorText(note, '- Alpha Beta\n- \n    - Unterpunkt\n- ');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Backspace');
  const topLevel = '- Alpha Beta\n- \n    - Unterpunkt\n- ';
  await expectEditorText(note, topLevel);
  expect(await editorSelection(note).then(({ start, end }) => [start, end])).toEqual([topLevel.length, topLevel.length]);
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Prosa');
  await expectEditorText(note, `${topLevel}\n- Prosa`);
  await page.keyboard.press('Shift+Enter');
  await page.keyboard.type('Fortsetzung');
  await page.keyboard.press('Enter');
  await expectEditorText(note, `${topLevel}\n- Prosa\n  Fortsetzung\n- `);
  await page.screenshot({ path: 'test-results/bullet-mode.png' });

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await note.fill('Prosa');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expectEditorText(note, 'Prosa\n');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expectEditorText(note, 'Prosa\n- ');

  await note.fill('- ');
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expectEditorText(note, '- \n- ');
  await page.keyboard.press('Control+z');
  await expectEditorText(note, '- ');
  await page.keyboard.press('Control+Shift+z');
  await expectEditorText(note, '- \n- ');
  await page.keyboard.press('Tab');
  await expectEditorText(note, '- \n    - ');
  await page.keyboard.press('Backspace');
  await expectEditorText(note, '- \n- ');
  await page.keyboard.press('Control+z');
  await expectEditorText(note, '- \n    - ');
  await page.keyboard.press('Control+Shift+z');
  await expectEditorText(note, '- \n- ');
  await page.keyboard.press('Backspace');
  await expectEditorText(note, '- \n- ');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+z');
  await expectEditorText(note, '- \n    - ');
  await page.keyboard.press('Control+Shift+z');
  await expectEditorText(note, '- \n- ');
  await setEditorSelection(note, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  await page.keyboard.type('Text');
  await page.keyboard.press('Backspace');
  await expectEditorText(note, '- \n- Tex');

  // One native transaction for a multi-line indent; undo restores content and autosave state.
  const original = '- Alpha\n- Beta\nProsa';
  await note.fill(original);
  await setEditorSelection(note, 0, 15);
  await page.keyboard.press('Tab');
  await expectEditorText(note, '    - Alpha\n    - Beta\nProsa');
  expect(await editorSelection(note).then(({ start, end }) => [start, end])).toEqual([4, 23]);
  await page.keyboard.press('Control+z');
  await expectEditorText(note, original);
  await setEditorSelection(note, 0, 15);
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expectEditorText(note, original);
  expect(await editorSelection(note).then(({ start, end }) => [start, end])).toEqual([0, 15]);
  expect(await note.evaluate((element) => {
    const composing = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
    element.dispatchEvent(composing);
    const modified = new KeyboardEvent('keydown', { key: 'Tab', ctrlKey: true, bubbles: true, cancelable: true });
    element.dispatchEvent(modified);
    return [composing.defaultPrevented, modified.defaultPrevented];
  })).toEqual([false, false]);
  await toggle.click();
  await expectEditorText(note, original);
  await setEditorSelection(note, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER);
  await page.keyboard.press('Enter');
  await expectEditorText(note, `${original}\n`);
  await page.keyboard.press('Tab');
  await expect(note).not.toBeFocused();
  await note.focus();
  await page.keyboard.press('Control+s');
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe(`${original}\n`);
  await page.reload();
  await expectEditorText(note, `${original}\n`);
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('Zoom neben Notizen: stabile Zeile, scharfer Ausschnitt, unabhängige Folien und Lazy-Rendering', async ({ page }) => {
  await openLecture(page);
  const row = page.locator('[data-page="1"]');
  const note = page.getByLabel('Notiz zu Folie 1', { exact: true });
  await note.fill('Notiz neben dem vergrößerten Ausschnitt');
  const viewport = row.getByRole('region', { name: 'Folienausschnitt 1', exact: true });
  const initialRow = await row.boundingBox();
  const initialCanvas = await row.locator('canvas[data-rendered=true]').boundingBox();
  await page.screenshot({ path: 'test-results/inline-zoom-fit.png' });
  for (let i = 0; i < 4; i++) await row.getByRole('button', { name: 'Folie 1 hineinzoomen', exact: true }).click();
  await expect(row.getByLabel('Vergrößerung Folie 1', { exact: true })).toHaveText('200 %');
  await expect.poll(async () => (await row.locator('canvas[data-rendered=true]').boundingBox())!.width).toBeGreaterThan(initialCanvas!.width * 1.9);
  const bitmap = await row.locator('canvas[data-rendered=true]').evaluate((element) => ({ pixels: (element as HTMLCanvasElement).width, css: element.getBoundingClientRect().width }));
  expect(Math.abs(bitmap.pixels - bitmap.css)).toBeLessThanOrEqual(2);
  expect((await row.boundingBox())!.height).toBe(initialRow!.height);
  const region = (await viewport.boundingBox())!;
  const initialPan = await viewport.evaluate((element) => ({ x: element.scrollLeft, y: element.scrollTop }));
  await page.mouse.move(region.x + region.width / 2, region.y + region.height / 2);
  await page.mouse.down();
  await page.mouse.move(region.x + region.width / 2 - 70, region.y + region.height / 2 - 50, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(initialPan.x + 50);
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(initialPan.y + 30);
  await page.screenshot({ path: 'test-results/inline-zoom-detail.png' });
  await note.focus();
  await page.keyboard.press('Control+s');
  await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByLabel('Notiz zu Folie 2', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Vergrößerung Folie 2', { exact: true })).toHaveText('100 %');
  await jump(page, 20);
  await expect(row.locator('canvas')).toHaveCount(0);
  await jump(page, 1);
  await expect(row.getByLabel('Vergrößerung Folie 1', { exact: true })).toHaveText('200 %');
  await expectEditorText(note, 'Notiz neben dem vergrößerten Ausschnitt');
  await row.getByRole('button', { name: 'Folie 1 vergrößern', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Folie 1 · Detailansicht' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(row.getByLabel('Vergrößerung Folie 1', { exact: true })).toHaveText('200 %');
  await row.getByRole('button', { name: 'Folie 1 einpassen', exact: true }).click();
  await expect(row.getByLabel('Vergrößerung Folie 1', { exact: true })).toHaveText('100 %');
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop + element.scrollLeft)).toBe(0);
  expect((await row.boundingBox())!.height).toBe(initialRow!.height);
  const beforeWheel = await page.locator('.lecture-scroll').evaluate((element) => element.scrollTop);
  await page.mouse.move(region.x + region.width / 2, region.y + region.height / 2);
  await page.mouse.wheel(0, 250);
  await expect.poll(() => page.locator('.lecture-scroll').evaluate((element) => element.scrollTop)).toBeGreaterThan(beforeWheel + 100);
});

test('Folien-Detailansicht: scharfer Zoom, Verschieben, Einpassen und Rückkehr ohne Positionsverlust', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openLecture(page);
  await jump(page, 10); // Hochformat prüft das Einpassen auch in der Höhe.
  const note = page.getByLabel('Notiz zu Folie 10', { exact: true });
  await note.fill('Notiz bleibt beim Zoomen erhalten');
  const opener = page.getByRole('button', { name: 'Folie 10 vergrößern', exact: true });
  await opener.click();
  const before = await page.locator('.lecture-scroll').evaluate((element) => element.scrollTop);
  const dialog = page.getByRole('dialog', { name: 'Folie 10 · Detailansicht' });
  await expect(dialog).toBeVisible();
  const canvas = dialog.locator('canvas[data-rendered=true]');
  await expect(canvas).toHaveAttribute('aria-label', 'PDF-Seite 10');
  const viewport = dialog.getByRole('region', { name: 'Vergrößerte Folie' });
  const fit = await canvas.boundingBox();
  const region = await viewport.boundingBox();
  expect(fit!.height).toBeLessThanOrEqual(region!.height + 1);
  expect(fit!.width).toBeLessThanOrEqual(region!.width + 1);
  await page.screenshot({ path: 'test-results/slide-zoom-fit.png' });
  for (let i = 0; i < 4; i++) await dialog.getByRole('button', { name: 'Vergrößern', exact: true }).click();
  await expect(dialog.getByLabel('Vergrößerung')).toHaveText('200 %');
  await expect.poll(async () => (await canvas.boundingBox())!.width).toBeCloseTo(fit!.width * 2, 0);
  const bitmap = await canvas.evaluate((element) => ({ pixels: (element as HTMLCanvasElement).width, css: element.getBoundingClientRect().width }));
  expect(Math.abs(bitmap.pixels - bitmap.css)).toBeLessThanOrEqual(2);
  const initialPan = await viewport.evaluate((element) => ({ x: element.scrollLeft, y: element.scrollTop }));
  await page.mouse.move(region!.x + region!.width / 2, region!.y + region!.height / 2);
  await page.mouse.down();
  await page.mouse.move(region!.x + region!.width / 2 - 80, region!.y + region!.height / 2 - 70, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(initialPan.y + 50);
  await page.screenshot({ path: 'test-results/slide-zoom-detail.png' });
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Control+g');
  await expect(page.getByLabel('Gehe zu Folie')).toHaveCount(0);
  await page.keyboard.press('Control+s');
  await expect(page.locator('.lecture-toolbar [role=status]')).toHaveText('Gespeichert');
  await page.setViewportSize({ width: 1100, height: 750 });
  await dialog.getByRole('button', { name: 'Einpassen' }).click();
  await expect(dialog.getByLabel('Vergrößerung')).toHaveText('100 %');
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBe(0);
  const resized = await canvas.boundingBox();
  expect(resized!.height).toBeLessThan(fit!.height);
  // Restore the outer size before comparing its reading position.
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  expect(await page.locator('.lecture-scroll').evaluate((element) => element.scrollTop)).toBe(before);
  await expectEditorText(note, 'Notiz bleibt beim Zoomen erhalten');
  await note.focus();
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByLabel('Notiz zu Folie 11', { exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Folie 11 vergrößern', exact: true }).click();
  const landscape = page.getByRole('dialog', { name: 'Folie 11 · Detailansicht' });
  await expect(landscape.locator('canvas[data-rendered=true]')).toBeVisible();
  await landscape.getByRole('button', { name: 'Vergrößern', exact: true }).click();
  const centre = await landscape.getByRole('region').evaluate((element) => ({
    x: (element.scrollLeft + element.clientWidth / 2) / element.scrollWidth,
    y: (element.scrollTop + element.clientHeight / 2) / element.scrollHeight,
  }));
  expect(centre.x).toBeCloseTo(0.5, 2);
  expect(centre.y).toBeCloseTo(0.5, 2);
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(errors).toEqual([]);
});

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

test('132 Folien: Zeilenzuordnung, Tastatur, Trenner und dauerhafte Notizfelder', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const external: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith(baseURL) && /^https?:/.test(request.url())) external.push(request.url()); });
  await openLecture(page);
  await expect(page.locator('.note-editor .cm-content')).toHaveCount(132);
  await page.getByLabel('Notiz zu Folie 1', { exact: true }).fill('Lokaler Entwurf bleibt beim Scrollen erhalten.');
  for (let i = 0; i < 5; i++) await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByLabel('Notiz zu Folie 6', { exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.lecture-scroll')).toBeFocused();
  await jump(page, 132);
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page.getByLabel('Notiz zu Folie 132', { exact: true })).toBeFocused();
  await jump(page, 1);
  await expectEditorText(page.getByLabel('Notiz zu Folie 1', { exact: true }), 'Lokaler Entwurf bleibt beim Scrollen erhalten.');
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
      await expect(page.locator('.note-editor .cm-content')).toHaveCount(132);
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
  await expectEditorText(page.getByLabel('Notiz zu Folie 3', { exact: true }), text);
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
    await expectEditorText(page.getByLabel('Dateifassung Folie 1', { exact: true }), 'Dateifassung aus dem Editor');
    await expectEditorText(page.getByLabel('Notiz zu Folie 1', { exact: true }), 'Meine Fassung aus der App');
    if (choice === 'Beide zusammenfügen') await page.screenshot({ path: 'test-results/phase3-conflict.png', fullPage: true });
    expect(parseNotes(await readFile(path, 'utf8')).notes[1]).toBe('Dateifassung aus dem Editor');
    // Auch Browsernavigation innerhalb der SPA darf einen ungelösten Entwurf nicht verwerfen.
    await page.getByRole('link', { name: '← Übersicht' }).click();
    await expect(conflict).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`#vorlesung/${lectureId(`module/ids/${title}.pdf`)}$`));
    await conflict.getByRole('button', { name: choice, exact: true }).click();
    await expect(savedStatus(page)).toHaveText('Gespeichert');
    const expected = choice === 'Datei übernehmen' ? 'Dateifassung aus dem Editor' : choice === 'Eigene behalten' ? 'Meine Fassung aus der App' : 'Dateifassung aus dem Editor\n\nMeine Fassung aus der App';
    await expectEditorText(page.getByLabel('Notiz zu Folie 1', { exact: true }), expected);
    if (choice === 'Datei übernehmen') {
      await page.getByLabel('Notiz zu Folie 1', { exact: true }).focus();
      await page.keyboard.press('Control+z');
      await expectEditorText(page.getByLabel('Notiz zu Folie 1', { exact: true }), expected);
    }
    await page.reload();
    await expectEditorText(page.getByLabel('Notiz zu Folie 1', { exact: true }), expected);
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
  await expectEditorText(note, 'Text bleibt im Browser');
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
  await expect(page.getByLabel('Notiz zu Folie 1', { exact: true })).toHaveAttribute('aria-readonly', 'true');
  await expect(page.getByRole('button', { name: 'Stichpunkte: Notiz zu Folie 1', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Nicht relevant: Notiz zu Folie 1', exact: true })).toBeDisabled();
  expect(await readFile(path, 'utf8')).toBe(broken);
  await writeFile(path, serializeNotes(newNotes(`module/ids/${title}.pdf`, title, 4)));
  await page.getByRole('button', { name: 'Datei erneut prüfen' }).click();
  await expect(savedStatus(page)).toHaveText('Gespeichert');
  await expectEditorText(page.getByLabel('Notiz zu Folie 1', { exact: true }), 'Entwurf wird behalten');
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
