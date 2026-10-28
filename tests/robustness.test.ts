import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from './helpers/app';
import { loadConfig } from '../src/server/config';
import { lectureId } from '../src/server/registry';
import { noteHash } from '../src/server/notes-store';
import { parseNotes, serializeNotes } from '../src/shared/notes';
import { textPdf, passwordPdf } from './fixtures/pdf';
import * as files from '../src/server/files';
let root: string; let app: FastifyInstance;
const id = lectureId('module/ids/Alt.pdf'); const url = `/api/lectures/${id}`;
const directory = () => join(root, 'notes', 'ids', 'Alt');
const read = (path: string) => readFile(path, 'utf8');
afterEach(async () => { await app?.close(); vi.restoreAllMocks(); if (root) await rm(root, { recursive: true, force: true }); });
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'mdt-robust-')); await mkdir(join(root, 'module', 'ids'), { recursive: true });
  await writeFile(join(root, 'module', 'ids', 'Alt.pdf'), textPdf([['Eins'], ['Zwei'], ['Drei']]));
  app = await buildApp(loadConfig({ DATA_ROOT: root })); await app.inject('/api/overview');
  await app.inject({ method: 'PUT', url: `${url}/notes/3`, payload: { text: 'Unveränderte Frage zu Folie 3', baseHash: noteHash('') } });
  await vi.waitFor(async () => expect(JSON.parse(await read(join(directory(), 'meta.json'))).sourceTextVersion).toBeDefined(), { timeout: 5000 });
}
it('zeigt Quelländerung mit alter Seitenzahl, erhält Notizen und bestätigt nur den geprüften Hash', async () => {
  await setup();
  await writeFile(join(root, 'module', 'ids', 'Alt.pdf'), textPdf([['Neu']]));
  const changed = (await app.inject(url)).json(); expect(changed).toMatchObject({ pageCount: 1, sourceChanged: true, previousPageCount: 3 });
  expect(changed.notes['3'].text).toBe('Unveränderte Frage zu Folie 3');
  expect((await app.inject({ method: 'POST', url: `${url}/accept-source`, payload: { sourceSha256: 'a'.repeat(64) } })).statusCode).toBe(409);
  expect((await app.inject({ method: 'POST', url: `${url}/accept-source`, payload: { sourceSha256: changed.sourceSha256 } })).statusCode).toBe(200);
  expect((await app.inject(url)).json().sourceChanged).toBe(false);
  await writeFile(join(root, 'module', 'ids', 'Alt.pdf'), textPdf([['Erneut neu'], ['Zweite Seite']]));
  expect((await app.inject({ method: 'POST', url: `${url}/accept-source`, payload: { sourceSha256: changed.sourceSha256 } })).statusCode).toBe(409);
  expect(parseNotes(await read(join(directory(), 'notes.md'))).notes[3]).toBe('Unveränderte Frage zu Folie 3');
});
it('lässt vorhandene Notizen ohne Folie editieren, erkennt Konflikte und verhindert erfundene Seiten', async () => {
  await setup(); await writeFile(join(root, 'module', 'ids', 'Alt.pdf'), textPdf([['Neu']]));
  const detail = (await app.inject(url)).json();
  const endpoint = `${url}/detached-notes/3`;
  const saved = await app.inject({ method: 'PUT', url: endpoint, payload: { text: 'Weiterbearbeitet ohne Folie', baseHash: detail.notes['3'].hash } });
  expect(saved.statusCode).toBe(200);
  expect((await app.inject({ method: 'PUT', url: endpoint, payload: { text: 'Konflikt', baseHash: detail.notes['3'].hash } })).statusCode).toBe(409);
  expect((await app.inject({ method: 'PUT', url: `${url}/detached-notes/999`, payload: { text: 'Nicht anlegen', baseHash: noteHash('') } })).statusCode).toBe(404);
  expect(parseNotes(await read(join(directory(), 'notes.md'))).notes[3]).toBe('Weiterbearbeitet ohne Folie');
});
it('erkennt Umbenennung per Hash und verknüpft nach Bestätigung ohne Verlust von Notizen, State, Erledigt und eigenen Dateien', async () => {
  await setup();
  await writeFile(join(directory(), 'eigen.txt'), 'Eigene Begleitdatei');
  await app.inject({ method: 'PUT', url: `${url}/completed`, payload: { completed: true } });
  await rename(join(root, 'module', 'ids', 'Alt.pdf'), join(root, 'module', 'ids', 'Neu.pdf'));
  const nextId = lectureId('module/ids/Neu.pdf'); const overview = (await app.inject('/api/overview')).json();
  const orphan = overview.orphans.find((entry: { title: string }) => entry.title === 'Alt');
  expect(orphan.candidates).toContainEqual({ id: nextId, module: 'ids', title: 'Neu' });
  expect((await app.inject({ method: 'POST', url: `/api/orphans/${orphan.id}/relink`, payload: { lectureId: nextId } })).statusCode).toBe(200);
  const relinked = (await app.inject(`/api/lectures/${nextId}`)).json();
  expect(relinked.notes['3'].text).toBe('Unveränderte Frage zu Folie 3'); expect(relinked.completed).toBe(true); expect(relinked.sourceChanged).toBe(false);
  expect(relinked.state.maxPageVisited).toBe(3);
  expect(await read(join(root, 'notes', 'ids', 'Neu', 'eigen.txt'))).toBe('Eigene Begleitdatei');
  expect(await read(join(root, 'notes', 'ids', 'Neu', 'notes.md'))).toContain('quelle: "module/ids/Neu.pdf"');
  expect((await app.inject('/api/overview')).json().orphans).toBeUndefined();
  const backups = await readdir(join(root, 'notes', '.relink-backups')); expect(backups.length).toBe(1);
  expect(await read(join(root, 'notes', '.relink-backups', backups[0]!, 'original', 'eigen.txt'))).toBe('Eigene Begleitdatei');
});
it('zeigt gelöschte PDFs als verwaist und überschreibt keine Notizen einer Zielvorlesung', async () => {
  await setup();
  await writeFile(join(root, 'module', 'ids', 'Ziel.pdf'), textPdf([['Ziel']]));
  const target = lectureId('module/ids/Ziel.pdf'); await app.inject('/api/overview');
  await app.inject({ method: 'PUT', url: `/api/lectures/${target}/notes/1`, payload: { text: 'Eigene Zielnotiz', baseHash: noteHash('') } });
  await rm(join(root, 'module', 'ids', 'Alt.pdf'));
  const orphan = (await app.inject('/api/overview')).json().orphans[0];
  expect(orphan.noteCount).toBe(1); expect(orphan.candidates).toEqual([]);
  expect((await app.inject({ method: 'POST', url: `/api/orphans/${orphan.id}/relink`, payload: { lectureId: target } })).statusCode).toBe(409);
  expect((await app.inject(`/api/lectures/${target}`)).json().notes['1'].text).toBe('Eigene Zielnotiz');
  expect(parseNotes(await read(join(directory(), 'notes.md'))).notes[3]).toBe('Unveränderte Frage zu Folie 3');
});
it('setzt fehlgeschlagene Verknüpfung zurück und erhält Originaldateien', async () => {
  await setup(); await rename(join(root, 'module', 'ids', 'Alt.pdf'), join(root, 'module', 'ids', 'Neu.pdf'));
  const overview = (await app.inject('/api/overview')).json(); const orphan = overview.orphans[0]; const nextId = lectureId('module/ids/Neu.pdf');
  const actual = files.renameWithRetry;
  vi.spyOn(files, 'renameWithRetry').mockImplementation(async (from, to) => {
    if (from.includes('.relink-staging') && to.endsWith('Neu')) throw Object.assign(new Error('Simulierter Rename-Fehler'), { code: 'EPERM' });
    return actual(from, to);
  });
  expect((await app.inject({ method: 'POST', url: `/api/orphans/${orphan.id}/relink`, payload: { lectureId: nextId } })).statusCode).toBe(500);
  expect(parseNotes(await read(join(directory(), 'notes.md'))).notes[3]).toBe('Unveränderte Frage zu Folie 3');
  expect(JSON.parse(await read(join(root, 'notes', 'ids', 'Neu', 'meta.json'))).lecture).toBe('Neu');
});
it('verhindert Path-Traversal und folgt keinen externen Orphan-Junctions', async () => {
  await setup(); await mkdir(join(root, 'outside')); await symlink(join(root, 'outside'), join(root, 'notes', 'ids', 'Fremd'), 'junction');
  const overview = (await app.inject('/api/overview')).json(); expect(overview.orphans).toBeUndefined();
  expect((await app.inject({ method: 'POST', url: '/api/orphans/..%2Ffremd/relink', payload: { lectureId: id } })).statusCode).toBe(404);
});

it('führt manuelles Relink bei anderer Quelle mit Warnung aus', async () => {
  await setup(); await writeFile(join(root, 'module', 'ids', 'Anders.pdf'), textPdf([['Andere Quelle']]));
  await rm(join(root, 'module', 'ids', 'Alt.pdf'));
  const orphan = (await app.inject('/api/overview')).json().orphans[0]; const target = lectureId('module/ids/Anders.pdf');
  expect((await app.inject({ method: 'POST', url: `/api/orphans/${orphan.id}/relink`, payload: { lectureId: target } })).statusCode).toBe(200);
  const detail = (await app.inject(`/api/lectures/${target}`)).json();
  expect(detail.sourceChanged).toBe(true); expect(detail.previousPageCount).toBe(3);
  expect(detail.notes['3'].text).toBe('Unveränderte Frage zu Folie 3');
});

it('behandelt eine echte passwortgeschützte und eine defekte PDF als Fehler, während gültige PDFs weiter funktionieren', async () => {
  await setup();
  const protectedData = passwordPdf();
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const opened = getDocument({ data: new Uint8Array(protectedData), password: 'geheim' });
  try { expect((await opened.promise).numPages).toBe(1); } finally { await opened.destroy(); }
  await writeFile(join(root, 'module', 'ids', 'Geschützt.pdf'), protectedData);
  await writeFile(join(root, 'module', 'ids', 'Defekt.pdf'), 'kein PDF');
  const overview = (await app.inject('/api/overview')).json();
  for (const name of ['Geschützt', 'Defekt']) expect(overview.modules[0].lectures.find((entry: { title: string }) => entry.title === name)).toMatchObject({ pageCount: null, error: expect.any(String) });
  expect((await app.inject(url)).json().pageCount).toBe(3);
});

it('bricht Relink bei einer externen Änderung während der Vorbereitung ohne Datenverlust ab', async () => {
  await setup(); await rename(join(root, 'module', 'ids', 'Alt.pdf'), join(root, 'module', 'ids', 'Neu.pdf'));
  const orphan = (await app.inject('/api/overview')).json().orphans[0]; const nextId = lectureId('module/ids/Neu.pdf');
  const actual = files.writeJson; let changed = false;
  vi.spyOn(files, 'writeJson').mockImplementation(async (rootPath, target, value) => {
    if (target.includes('.relink-staging') && target.endsWith('meta.json') && !changed) {
      changed = true; const path = join(directory(), 'notes.md'); const document = parseNotes(await read(path));
      document.notes[3] = 'Extern während der Verknüpfung geändert'; await writeFile(path, serializeNotes(document));
    }
    return actual(rootPath, target, value);
  });
  expect((await app.inject({ method: 'POST', url: `/api/orphans/${orphan.id}/relink`, payload: { lectureId: nextId } })).statusCode).toBe(409);
  expect(parseNotes(await read(join(directory(), 'notes.md'))).notes[3]).toBe('Extern während der Verknüpfung geändert');
});
