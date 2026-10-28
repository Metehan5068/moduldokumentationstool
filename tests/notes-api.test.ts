import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './helpers/app';
import { loadConfig } from '../src/server/config';
import { lectureId } from '../src/server/registry';
import { noteHash } from '../src/server/notes-store';
import { newNotes, parseNotes, serializeNotes } from '../src/shared/notes';
import { testPdf } from './fixtures/pdf';

let root: string;
let app: FastifyInstance;
const source = 'module/ids/Test.pdf';
const id = lectureId(source);
const url = (page: string | number) => `/api/lectures/${id}/notes/${page}`;
const emptyHash = noteHash('');
afterEach(async () => { await app?.close(); if (root) await rm(root, { recursive: true, force: true }); });
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'mdt-notes-'));
  await mkdir(join(root, 'module', 'ids'), { recursive: true });
  await writeFile(join(root, 'module', 'ids', 'Test.pdf'), testPdf(20));
  app = await buildApp(loadConfig({ DATA_ROOT: root }));
  await app.inject('/api/overview');
  return join(root, 'notes', 'ids', 'Test', 'notes.md');
}
const put = (page: number | string, text: string, baseHash = emptyHash) => app.inject({ method: 'PUT', url: url(page), payload: { text, baseHash } });

it('serialisiert 20 parallele PUTs auf verschiedene Seiten ohne Notizverlust', async () => {
  const path = await setup();
  const replies = await Promise.all(Array.from({ length: 20 }, (_, index) => put(index + 1, `Notiz ${index + 1}`)));
  expect(replies.every((reply) => reply.statusCode === 200)).toBe(true);
  const document = parseNotes(await readFile(path, 'utf8'));
  expect(Object.keys(document.notes)).toHaveLength(20);
  for (let page = 1; page <= 20; page++) expect(document.notes[page]).toBe(`Notiz ${page}`);
  const loaded = (await app.inject(`/api/lectures/${id}`)).json();
  expect(loaded.notes['3']).toEqual({ text: 'Notiz 3', hash: noteHash('Notiz 3') });
});

it('antwortet bei externer Änderung derselben Seite mit 409 und überschreibt nichts', async () => {
  const path = await setup();
  const saved = await put(3, 'Anfang');
  const document = parseNotes(await readFile(path, 'utf8'));
  document.notes[3] = 'Extern durch Editor geändert';
  await writeFile(path, serializeNotes(document));
  const before = await readFile(path, 'utf8');
  const conflict = await put(3, 'Meine Fassung', saved.json().hash);
  expect(conflict.statusCode).toBe(409);
  expect(conflict.json()).toEqual({ currentText: document.notes[3], currentHash: noteHash(document.notes[3]!) });
  expect(await readFile(path, 'utf8')).toBe(before);
  expect((await put(3, 'Meine Fassung', conflict.json().currentHash)).statusCode).toBe(200);
});

it('erhält externe Änderungen an einer anderen Seite, Vorspann und Notizen ohne Folie', async () => {
  const path = await setup();
  const saved = await put(1, 'Anfang');
  const document = parseNotes(await readFile(path, 'utf8'));
  document.notes[2] = 'Externe Ergänzung'; document.notes[30] = 'Nicht mehr vorhandene Folie';
  document.preamble += '\nEigene Einleitung\n';
  await writeFile(path, serializeNotes(document));
  expect((await put(1, 'In der App weitergeschrieben', saved.json().hash)).statusCode).toBe(200);
  const updated = parseNotes(await readFile(path, 'utf8'));
  expect(updated.notes).toEqual({ 1: 'In der App weitergeschrieben', 2: 'Externe Ergänzung', 30: 'Nicht mehr vorhandene Folie' });
  expect(updated.preamble).toContain('Eigene Einleitung');
});

it('lässt kaputte notes.md unangetastet, liefert Zeilenfehler und funktioniert nach Reparatur wieder', async () => {
  const path = await setup();
  const broken = '<!-- lecture-note:page=1 -->\n## Folie 1\n\nEndmarker fehlt';
  await writeFile(path, broken);
  const detail = (await app.inject(`/api/lectures/${id}`)).json();
  expect(detail.readOnlyError).toMatchObject({ line: 1, message: expect.stringContaining('Endmarker fehlt') });
  const blocked = await put(1, 'Darf nichts überschreiben');
  expect(blocked.statusCode).toBe(422);
  expect(blocked.json().line).toBe(1);
  expect(await readFile(path, 'utf8')).toBe(broken);
  await writeFile(path, serializeNotes(newNotes(source, 'Test', 20)));
  expect((await put(1, 'Nach Reparatur')).statusCode).toBe(200);
});

it('validiert Seite, JSON und baseHash und löscht nur die ausdrücklich geleerte Notiz', async () => {
  const path = await setup();
  for (const page of ['0', '-1', '1.5', '21', '1e1', '01', 'x']) expect((await put(page, 'Fehler')).statusCode).toBe(400);
  expect((await app.inject({ method: 'PUT', url: url(1), payload: { text: 'Fehler', baseHash: 'falsch' } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'PUT', url: url(1), payload: { text: 42, baseHash: emptyHash } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'PUT', url: url(1), payload: { text: 'Fehler', baseHash: emptyHash, path: '../fremd' } })).statusCode).toBe(400);
  expect((await app.inject({ method: 'PUT', url: url(1), payload: 'text=Angriff', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(415);
  const saved = await put(1, 'Wird geleert');
  await put(2, 'Bleibt');
  expect((await put(1, '', saved.json().hash)).statusCode).toBe(200);
  expect(parseNotes(await readFile(path, 'utf8')).notes).toEqual({ 2: 'Bleibt' });
});

it('verhindert Schreiben durch nachträglich gesetzte Junctions außerhalb von notes', async () => {
  await setup();
  const directory = join(root, 'notes', 'ids', 'Test');
  const outside = join(root, 'outside');
  await vi.waitFor(async () => expect(JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8')).sourceTextVersion).toBeDefined(), { timeout: 5000 });
  await mkdir(outside);
  await writeFile(join(outside, 'notes.md'), 'Fremde Datei');
  await rm(directory, { recursive: true, force: true });
  await symlink(outside, directory, 'junction');
  expect((await put(1, 'Darf nicht geschrieben werden')).statusCode).toBe(500);
  expect(await readFile(join(outside, 'notes.md'), 'utf8')).toBe('Fremde Datei');
});
