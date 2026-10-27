import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { lectureId } from '../src/server/registry';
import { noteHash } from '../src/server/notes-store';
import { INITIAL_STATE, normalizeState, type LectureState } from '../src/shared/state';
import type { OverviewResponse } from '../src/shared/api';
import { testPdf } from './fixtures/pdf';

let root: string;
let app: FastifyInstance;
const id = lectureId('module/ids/Test.pdf');
const url = `/api/lectures/${id}`;
const state = (overrides: Partial<LectureState> = {}): LectureState => ({ ...INITIAL_STATE, lastPage: 13, activeNotePage: 13, pageOffsetRatio: 0.5, maxPageVisited: 13, selection: { start: 84, end: 90 }, updatedAt: '2026-10-28T01:00:00.000Z', ...overrides });
afterEach(async () => { await app?.close(); if (root) await rm(root, { recursive: true, force: true }); });
async function setup() {
  root = await mkdtemp(join(tmpdir(), 'mdt-state-'));
  await mkdir(join(root, 'module', 'ids'), { recursive: true });
  await writeFile(join(root, 'module', 'ids', 'Test.pdf'), testPdf(20));
  app = await buildApp(loadConfig({ DATA_ROOT: root }));
  await app.inject('/api/overview');
  return join(root, 'notes', 'ids', 'Test');
}
const put = (body: LectureState) => app.inject({ method: 'PUT', url: `${url}/state`, payload: body });

describe('state.json-Validierung', () => {
  it('begrenzt Seiten und relativen Versatz und verhindert ungültige Cursorbereiche', () => {
    expect(normalizeState(state({ lastPage: 100, activeNotePage: -3, pageOffsetRatio: 4, maxPageVisited: 100, selection: { start: -4, end: -8 } }), 20))
      .toMatchObject({ lastPage: 20, activeNotePage: 1, pageOffsetRatio: 1, maxPageVisited: 20, selection: { start: 0, end: 0 } });
    expect(normalizeState(state({ selection: { start: 40, end: 20 } }), 20).selection).toEqual({ start: 40, end: 40 });
  });
  it('validiert den API-Vertrag und klemmt Seiten außerhalb des gültigen Bereichs', async () => {
    await setup();
    for (const body of [{ ...state(), schemaVersion: 2 }, { ...state(), lastPage: '13' }, { ...state(), lastPage: 1.5 }, { ...state(), updatedAt: 'kaputt' }, { ...state(), selection: null }, { ...state(), path: '../fremd' }]) {
      expect((await app.inject({ method: 'PUT', url: `${url}/state`, payload: body })).statusCode).toBe(400);
    }
    const reply = await put(state({ lastPage: 500, activeNotePage: -2 }));
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toMatchObject({ lastPage: 20, activeNotePage: 1, maxPageVisited: 20 });
    expect((await app.inject({ method: 'PUT', url: `${url}/completed`, payload: { completed: 'true' } })).statusCode).toBe(400);
  });
});

it('persistiert Position und Auswahl atomar als UTF-8/LF und lädt sie nach Server-Neustart', async () => {
  const directory = await setup();
  expect((await app.inject(url)).json().state).toEqual(INITIAL_STATE);
  expect((await put(state())).statusCode).toBe(200);
  const raw = await readFile(join(directory, 'state.json'), 'utf8');
  expect(raw).not.toContain('\r'); expect(raw.charCodeAt(0)).not.toBe(0xfeff);
  expect(JSON.parse(raw)).toEqual(state());
  expect((await readdir(directory)).some((name) => name.endsWith('.tmp'))).toBe(false);
  await app.close(); app = await buildApp(loadConfig({ DATA_ROOT: root }));
  expect((await app.inject(url)).json().state).toEqual(state());
});

it('erhält maxPageVisited beim Zurückscrollen und ignoriert verspätete ältere Positionen', async () => {
  await setup();
  await put(state({ lastPage: 20, maxPageVisited: 20, updatedAt: '2026-10-28T01:00:01.000Z' }));
  await put(state({ lastPage: 3, activeNotePage: 3, maxPageVisited: 3, updatedAt: '2026-10-28T01:00:03.000Z' }));
  await put(state({ lastPage: 15, activeNotePage: 15, maxPageVisited: 15, updatedAt: '2026-10-28T01:00:02.000Z' }));
  expect((await app.inject(url)).json().state).toMatchObject({ lastPage: 3, activeNotePage: 3, maxPageVisited: 20 });
});

it('erhält erledigt bei Rescan und PDF-Änderung sowie Hash und Notizen beim Umschalten', async () => {
  const directory = await setup();
  const metaPath = join(directory, 'meta.json');
  const before = JSON.parse(await readFile(metaPath, 'utf8'));
  await app.inject({ method: 'PUT', url: `${url}/notes/1`, payload: { text: 'Bleibt erhalten', baseHash: noteHash('') } });
  const notes = await readFile(join(directory, 'notes.md'), 'utf8');
  expect((await app.inject({ method: 'PUT', url: `${url}/completed`, payload: { completed: true } })).statusCode).toBe(200);
  expect(JSON.parse(await readFile(metaPath, 'utf8'))).toEqual({ ...before, completed: true });
  await writeFile(join(root, 'module', 'ids', 'Test.pdf'), testPdf(21));
  await Promise.all([app.inject('/api/overview'), app.inject({ method: 'PUT', url: `${url}/completed`, payload: { completed: true } }), put(state())]);
  expect((await app.inject(url)).json().completed).toBe(true);
  const after = JSON.parse(await readFile(metaPath, 'utf8'));
  expect(after).toMatchObject({ completed: true, pageCount: 21, acceptedSha256: before.acceptedSha256 });
  expect(after.sourceSha256).not.toBe(before.sourceSha256);
  expect(await readFile(join(directory, 'notes.md'), 'utf8')).toBe(notes);
  await app.close(); app = await buildApp(loadConfig({ DATA_ROOT: root }));
  expect((await app.inject(url)).json().completed).toBe(true);
  await app.inject({ method: 'PUT', url: `${url}/completed`, payload: { completed: false } });
  expect((await app.inject(url)).json().completed).toBe(false);
});

it('zeigt besuchte Seiten getrennt von Notizanzahl und wählt Weiter mit nach letzter Aktivität', async () => {
  await setup();
  const initial = (await app.inject('/api/overview')).json<OverviewResponse>();
  expect(initial.resume).toBeUndefined();
  expect(initial.modules[0]?.lectures[0]?.progress).toMatchObject({ maxPageVisited: 0, noteCount: 0, completed: false });
  await put(state());
  await app.inject({ method: 'PUT', url: `${url}/notes/3`, payload: { text: 'Nur eine Notiz', baseHash: noteHash('') } });
  const overview = (await app.inject('/api/overview')).json<OverviewResponse>();
  expect(overview.resume).toMatchObject({ id, lastPage: 13, pageCount: 20 });
  expect(overview.modules[0]?.lectures[0]?.progress).toMatchObject({ maxPageVisited: 13, noteCount: 1 });
  await writeFile(join(root, 'module', 'ids', 'Neu.pdf'), testPdf(4));
  const nextId = lectureId('module/ids/Neu.pdf');
  await app.inject('/api/overview');
  await app.inject({ method: 'PUT', url: `/api/lectures/${nextId}/state`, payload: state({ lastPage: 2, activeNotePage: 2, maxPageVisited: 2, updatedAt: '2026-10-28T01:00:05.000Z' }) });
  expect((await app.inject('/api/overview')).json<OverviewResponse>().resume?.id).toBe(nextId);
});

it('behandelt kaputtes state.json als flüchtige Daten und lässt Notizen weiter speichern', async () => {
  const directory = await setup();
  await writeFile(join(directory, 'state.json'), '{kaputt');
  expect((await app.inject(url)).json()).toMatchObject({ state: INITIAL_STATE, stateError: expect.any(String) });
  expect((await app.inject({ method: 'PUT', url: `${url}/notes/1`, payload: { text: 'Nicht gesperrt', baseHash: noteHash('') } })).statusCode).toBe(200);
  expect((await put(state())).statusCode).toBe(200);
  expect((await app.inject(url)).json().state).toEqual(state());
});

it('blockiert State- und Metadaten-Schreiben durch Junctions außerhalb von notes', async () => {
  const directory = await setup();
  const outside = join(root, 'outside'); await mkdir(outside);
  await writeFile(join(outside, 'state.json'), 'Fremde Datei');
  await rm(directory, { recursive: true, force: true }); await symlink(outside, directory, 'junction');
  expect((await put(state())).statusCode).toBe(500);
  expect((await app.inject({ method: 'PUT', url: `${url}/completed`, payload: { completed: true } })).statusCode).toBe(500);
  expect(await readFile(join(outside, 'state.json'), 'utf8')).toBe('Fremde Datei');
});
