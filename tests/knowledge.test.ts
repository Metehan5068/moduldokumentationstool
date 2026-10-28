import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from './helpers/app';
import { loadConfig } from '../src/server/config';
import { lectureId } from '../src/server/registry';
import { noteHash } from '../src/server/notes-store';
import { newNotes, parseNotes, serializeNotes } from '../src/shared/notes';
import * as text from '../src/server/pdf-text';
import { textPdf, boilerplatePdf, fixtureFooter } from './fixtures/pdf';
let root: string;
let app: FastifyInstance;
let externalRoot: string | undefined;
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
afterEach(async () => {
  await app?.close(); vi.restoreAllMocks();
  if (root) await rm(root, { recursive: true, force: true });
  if (externalRoot) { await rm(externalRoot, { recursive: true, force: true }); externalRoot = undefined; }
});
async function setup(files: Record<string, string[][]>) {
  root = await mkdtemp(join(tmpdir(), 'mdt-knowledge-')); await mkdir(join(root, 'module', 'ids'), { recursive: true });
  for (const [name, pages] of Object.entries(files)) await writeFile(join(root, 'module', 'ids', name), textPdf(pages));
  app = await buildApp(loadConfig({ DATA_ROOT: root }));
}
const dir = (title: string) => join(root, 'notes', 'ids', title);
const read = (path: string) => readFile(path, 'utf8');

it('macht alle PDFs ohne Öffnen KI-lesbar, ergänzt vorhandene Folientitel und erhält Nutzertext samt eigener CLAUDE.md', async () => {
  const name = 'IDS-2-Data exploration, preprocessing.PDF'; const title = name.slice(0, -4);
  await setup({ [name]: [['Entropy and information gain', 'Entropy measures uncertainty.'], [], ['Pruning', 'Reduce overfitting.']], 'IDS-10.pdf': [['Regression']] });
  await mkdir(dir(title), { recursive: true });
  const notes = newNotes(`module/ids/${name}`, title, 3);
  notes.notes[1] = 'Offene Frage: Warum log2?\n\n'; notes.notes[99] = 'Alte Notiz bleibt'; notes.titles[99] = 'Alter Titel';
  await writeFile(join(dir(title), 'notes.md'), serializeNotes(notes));
  await writeFile(join(root, 'CLAUDE.md'), 'Meine eigenen Regeln dürfen niemals überschrieben werden.\n');
  const response = await app.inject('/api/overview'); expect(response.statusCode).toBe(200);
  await app.close(); // Hintergrundjobs und abschließender Index sind danach vollständig geschrieben.
  const source = await read(join(dir(title), 'source.md'));
  expect(source).toContain('## Seite 1\nEntropy and information gain\nEntropy measures uncertainty.');
  expect(source).toContain('## Seite 2\n_[Kein extrahierbarer Text auf dieser Seite]_');
  expect(source).toContain('## Seite 3\nPruning');
  const meta = JSON.parse(await read(join(dir(title), 'meta.json')));
  expect(meta).toMatchObject({ sourceTextSha256: meta.sourceSha256, pagesWithoutText: [2], sourcePageTitles: { 1: 'Entropy and information gain', 3: 'Pruning' } });
  const updatedNotes = await read(join(dir(title), 'notes.md'));
  expect(parseNotes(updatedNotes).notes).toEqual(notes.notes);
  expect(updatedNotes).toContain('## Folie 1 · Entropy and information gain');
  expect(updatedNotes).toContain('## Folie 99 · Alter Titel');
  expect(await read(join(root, 'CLAUDE.md'))).toBe('Meine eigenen Regeln dürfen niemals überschrieben werden.\n');
  const index = await read(join(root, 'INDEX.md'));
  expect(index).toContain('| Vorlesung | Seiten | Notizen | Fortschritt |');
  expect(index.indexOf(title)).toBeLessThan(index.indexOf('IDS-10'));
  expect(index).toContain('IDS-2-Data%20exploration%2C%20preprocessing.PDF');
  expect(await read(join(dir('IDS-10'), 'source.md'))).toContain('Regression');
  expect(await readFile(join(root, 'module', 'ids', name))).toEqual(textPdf([['Entropy and information gain', 'Entropy measures uncertainty.'], [], ['Pruning', 'Reduce overfitting.']]));
});

it('kehrt aus dem Scan zurück, während die Extraktion noch läuft, und extrahiert genau eine PDF gleichzeitig', async () => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const actual = text.extractPdf; let active = 0; let maximum = 0;
  const extract = vi.spyOn(text, 'extractPdf').mockImplementation(async (data) => {
    active++; maximum = Math.max(maximum, active);
    try { await gate; return await actual(data); } finally { active--; }
  });
  await setup({ 'Eins.pdf': [['Eins']], 'Zwei.pdf': [['Zwei']] });
  try {
    expect((await app.inject('/api/overview')).statusCode).toBe(200);
    await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    expect((await app.inject('/api/health')).statusCode).toBe(200);
    await expect(read(join(dir('Eins'), 'source.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { release(); await app.close(); }
  expect(maximum).toBe(1); expect(extract).toHaveBeenCalledTimes(2);
  expect(await read(join(root, 'CLAUDE.md'))).toContain('Nur auf ausdrückliche Bitte ändern');
  expect(await read(join(root, 'CLAUDE.md'))).toContain('Seite N in source.md, Folie N in notes.md und PDF-Seite N');
});

it('überspringt unveränderten SHA auch nach Neustart oder mtime-Änderung und erneuert nur geänderte Quellen', async () => {
  const extract = vi.spyOn(text, 'extractPdf');
  await setup({ 'Test.pdf': [['Alter Titel'], []] }); await app.inject('/api/overview'); await app.close();
  expect(extract).toHaveBeenCalledTimes(1);
  const sourcePath = join(dir('Test'), 'source.md'); const before = await stat(sourcePath);
  const ownGuide = await read(join(root, 'CLAUDE.md'));
  await writeFile(join(root, 'CLAUDE.md'), `${ownGuide}\nEigene Ergänzung\n`);
  const later = new Date(Date.now() + 5000); await utimes(join(root, 'module', 'ids', 'Test.pdf'), later, later);
  app = await buildApp(loadConfig({ DATA_ROOT: root })); await app.inject('/api/overview'); await app.close();
  expect(extract).toHaveBeenCalledTimes(1); expect((await stat(sourcePath)).mtimeMs).toBe(before.mtimeMs);
  expect(JSON.parse(await read(join(dir('Test'), 'meta.json'))).pagesWithoutText).toEqual([2]);
  await writeFile(join(root, 'module', 'ids', 'Test.pdf'), textPdf([['Neuer Titel', 'Neuer Folientext']]));
  app = await buildApp(loadConfig({ DATA_ROOT: root })); await app.inject('/api/overview'); await app.close();
  expect(extract).toHaveBeenCalledTimes(2); expect(await read(sourcePath)).toContain('Neuer Folientext');
  expect(await read(join(root, 'CLAUDE.md'))).toBe(`${ownGuide}\nEigene Ergänzung\n`);
});

it('verwirft veraltete Extraktion und erhält Notizen und erledigt bei paralleler Quellenänderung', async () => {
  let release!: () => void; const gate = new Promise<void>((resolve) => { release = resolve; });
  const actual = text.extractPdf;
  const extract = vi.spyOn(text, 'extractPdf').mockImplementationOnce(async (data) => { await gate; return actual(data); });
  await setup({ 'Test.pdf': [['Alt']] });
  const id = lectureId('module/ids/Test.pdf');
  try {
    await app.inject('/api/overview'); await vi.waitFor(() => expect(extract).toHaveBeenCalledTimes(1));
    await app.inject({ method: 'PUT', url: `/api/lectures/${id}/notes/1`, payload: { text: 'Offene Frage bleibt erhalten', baseHash: noteHash('') } });
    await app.inject({ method: 'PUT', url: `/api/lectures/${id}/completed`, payload: { completed: true } });
    await writeFile(join(root, 'module', 'ids', 'Test.pdf'), textPdf([['Aktueller Titel', 'Aktuelle Quelle']]));
    await app.inject({ method: 'POST', url: '/api/rescan', payload: {} });
  } finally { release(); await app.close(); }
  const meta = JSON.parse(await read(join(dir('Test'), 'meta.json')));
  expect(meta.completed).toBe(true); expect(meta.sourceTextSha256).toBe(meta.sourceSha256);
  const source = await read(join(dir('Test'), 'source.md'));
  expect(source).toContain('Aktuelle Quelle'); expect(source).not.toContain('## Seite 1\nAlt');
  expect(meta.sourceSha256).toBe(sha(textPdf([['Aktueller Titel', 'Aktuelle Quelle']])));
  const notes = await read(join(dir('Test'), 'notes.md'));
  expect(parseNotes(notes).notes[1]).toBe('Offene Frage bleibt erhalten'); expect(notes).toContain('## Folie 1 · Aktueller Titel');
});

it('aktualisiert neue Notizen mit Folientitel und den Index nach Speichern, State und erledigt', async () => {
  await setup({ 'Test.pdf': [['Entropy', 'Entropy measures uncertainty.']] }); await app.inject('/api/overview'); await app.close();
  app = await buildApp(loadConfig({ DATA_ROOT: root }));
  const id = lectureId('module/ids/Test.pdf'); await app.inject('/api/overview');
  await app.inject({ method: 'PUT', url: `/api/lectures/${id}/notes/1`, payload: { text: 'Warum log2?', baseHash: noteHash('') } });
  await app.inject({ method: 'PUT', url: `/api/lectures/${id}/completed`, payload: { completed: true } });
  await vi.waitFor(async () => expect(await read(join(root, 'INDEX.md'))).toContain('| 1 | 1 | ✓ erledigt |'), { timeout: 5000 });
  expect(await read(join(dir('Test'), 'notes.md'))).toContain('## Folie 1 · Entropy');
});

it('lässt kaputte notes.md unverändert und fährt nach Extraktionsfehlern mit der nächsten PDF fort', async () => {
  const actual = text.extractPdf;
  vi.spyOn(text, 'extractPdf').mockImplementation(async (data) => {
    if (sha(Buffer.from(data)) === sha(textPdf([['A']]))) throw new Error('Simulierter Extraktionsfehler');
    return actual(data);
  });
  await setup({ 'A.pdf': [['A']], 'B.pdf': [['B']], 'C.pdf': [['C']] });
  await mkdir(dir('B'), { recursive: true });
  const broken = '<!-- lecture-note:page=1 -->\n## Folie 1\n\nEndmarker fehlt';
  await writeFile(join(dir('B'), 'notes.md'), broken);
  await app.inject('/api/overview'); await app.close();
  await expect(read(join(dir('A'), 'source.md'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(await read(join(dir('B'), 'notes.md'))).toBe(broken);
  expect(await read(join(dir('C'), 'source.md'))).toContain('## Seite 1\nC');
  expect(await read(join(root, 'INDEX.md'))).toContain('Notizdatei prüfen');
});

it('migriert einen alten Extraktor-Cache allein beim Serverstart und entfernt falsche Titel ohne Textverlust', async () => {
  await setup({ 'Test.pdf': [['Platzhalter']] });
  await writeFile(join(root, 'module', 'ids', 'Test.pdf'), boilerplatePdf());
  await app.ready(); await app.close();
  const metaPath = join(dir('Test'), 'meta.json');
  const meta = JSON.parse(await read(metaPath));
  await writeFile(metaPath, JSON.stringify({ ...meta, sourceTextVersion: 1, sourcePageTitles: { 1: fixtureFooter, 10: fixtureFooter } }));
  await writeFile(join(dir('Test'), 'source.md'), `---\nsha256: ${meta.sourceSha256}\n---\n${fixtureFooter}\n${fixtureFooter}\n`);
  const notes = newNotes('module/ids/Test.pdf', 'Test', 10);
  notes.notes[1] = `Meine Frage\n${fixtureFooter}`; notes.notes[10] = 'Keine Titelzeile vorhanden';
  notes.titles[1] = fixtureFooter; notes.titles[10] = fixtureFooter;
  await writeFile(join(dir('Test'), 'notes.md'), serializeNotes(notes));
  app = await buildApp(loadConfig({ DATA_ROOT: root })); await app.ready(); await app.close();
  const updated = JSON.parse(await read(metaPath)); expect(updated.sourceTextVersion).toBe(text.SOURCE_TEXT_VERSION);
  expect(updated.sourceSha256).toBe(meta.sourceSha256);
  const source = await read(join(dir('Test'), 'source.md')); expect(source.split(fixtureFooter)).toHaveLength(2);
  const result = parseNotes(await read(join(dir('Test'), 'notes.md')));
  expect(result.notes).toEqual(notes.notes); expect(result.titles[1]).toBe('Thema 1'); expect(result.titles[10]).toBe('');
});

it('folgt keinen Junctions außerhalb von notes und überschreibt keine externe INDEX-Datei', async () => {
  await setup({ 'Test.pdf': [['Titel']] });
  const outside = await mkdtemp(join(tmpdir(), 'mdt-external-')); externalRoot = outside;
  await writeFile(join(outside, 'INDEX.md'), 'Nicht überschreiben');
  await symlink(outside, join(root, 'INDEX.md'), 'junction');
  await mkdir(join(root, 'notes', 'ids'), { recursive: true }); await symlink(outside, dir('Test'), 'junction');
  await app.inject('/api/overview'); await app.close();
  expect(await read(join(outside, 'INDEX.md'))).toBe('Nicht überschreiben');
  await expect(read(join(outside, 'source.md'))).rejects.toMatchObject({ code: 'ENOENT' });
});
