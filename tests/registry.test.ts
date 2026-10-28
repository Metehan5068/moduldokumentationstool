import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from './helpers/app';
import { loadConfig } from '../src/server/config';
import { containedPath } from '../src/server/files';
import { Registry, lectureId, naturalCompare } from '../src/server/registry';
import * as files from '../src/server/files';
import type { OverviewResponse } from '../src/shared/api';
import { testPdf } from './fixtures/pdf';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mdt-scan-'));
  roots.push(root);
  await mkdir(join(root, 'module', 'ids'), { recursive: true });
  return root;
}

describe('Registry-Grundlagen', () => {
  it('erzeugt stabile IDs mit NFC und einheitlichen Trennern', () => {
    const path = 'module/Ä/Übung 2.pdf';
    expect(lectureId(path)).toBe(createHash('sha256').update(path).digest('hex').slice(0, 16));
    expect(lectureId(path.normalize('NFD').replaceAll('/', '\\'))).toBe(lectureId(path));
    expect(lectureId('module/anderes/Übung 2.pdf')).not.toBe(lectureId(path));
  });
  it('sortiert natürlich und begrenzt Pfade', () => {
    expect(['IDS-10', 'IDS-2', 'IDS-9'].sort(naturalCompare)).toEqual(['IDS-2', 'IDS-9', 'IDS-10']);
    expect(() => containedPath(join(tmpdir(), 'data'), '..', 'data-nebenan')).toThrow();
    expect(containedPath(join(tmpdir(), 'data'), 'ids')).toBe(join(tmpdir(), 'data', 'ids'));
  });
});

it('scannt nur direkte PDFs, sortiert natürlich und findet neue PDFs ohne Neustart', async () => {
  const root = await fixture();
  const module = join(root, 'module', 'ids');
  const names = ['IDS-10.pdf', 'IDS-9.PDF', 'IDS-2-Data exploration, preprocessing, visualization-1.pdf'];
  for (const name of names) await writeFile(join(module, name), testPdf(3));
  await writeFile(join(module, 'ignorieren.txt'), 'kein PDF');
  await writeFile(join(root, 'module', 'ignorieren.pdf'), testPdf(1));
  await mkdir(join(module, 'tiefer'));
  await writeFile(join(module, 'tiefer', 'ignorieren.pdf'), testPdf(1));
  await mkdir(join(root, 'module', 'Modul10'));
  await mkdir(join(root, 'module', 'Modul2'));
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    const response = await app.inject('/api/overview');
    expect(response.statusCode).toBe(200);
    const overview = response.json<OverviewResponse>();
    expect(overview.modules.map((m) => m.name)).toEqual(['ids', 'Modul2', 'Modul10']);
    expect(overview.modules[0]?.lectures.map((l) => l.title)).toEqual([names[2]?.slice(0, -4), 'IDS-9', 'IDS-10']);
    expect(overview.modules[0]?.lectures.every((l) => l.pageCount === 3 && !l.error)).toBe(true);
    expect(response.body).not.toContain('sourcePdf');
    expect(response.body).not.toContain(root.replaceAll('\\', '\\\\'));
    await writeFile(join(module, 'IDS-1.pdf'), testPdf(1));
    const rescanned = await app.inject({ method: 'POST', url: '/api/rescan', payload: {} });
    expect(rescanned.statusCode).toBe(200);
    expect(rescanned.json<OverviewResponse>().modules[0]?.lectures[0]?.title).toBe('IDS-1');
    await rm(join(module, 'IDS-1.pdf'));
    expect((await app.inject('/api/overview')).json<OverviewResponse>().modules[0]?.lectures).toHaveLength(3);
  } finally { await app.close(); }
});

it('persistiert Hash und Seitenzahl, nutzt den Cache nach Neustart und erhält Notizen', async () => {
  const root = await fixture();
  const path = join(root, 'module', 'ids', 'Vorlesung.pdf');
  const metaPath = join(root, 'notes', 'ids', 'Vorlesung', 'meta.json');
  await writeFile(path, testPdf(2));
  const config = loadConfig({ DATA_ROOT: root });
  const app = await buildApp(config);
  await app.inject('/api/overview');
  await app.close();
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  expect(meta).toMatchObject({ schemaVersion: 1, pageCount: 2, sourcePdf: 'module/ids/Vorlesung.pdf', sourceSha256: createHash('sha256').update(testPdf(2)).digest('hex') });
  expect(meta.acceptedSha256).toBe(meta.sourceSha256);
  const before = await stat(metaPath);
  const notesPath = join(root, 'notes', 'ids', 'Vorlesung', 'notes.md');
  await writeFile(notesPath, 'Eigene Notizen\n');
  const restarted = await buildApp(config);
  try {
    await Promise.all([restarted.inject('/api/overview'), restarted.inject({ method: 'POST', url: '/api/rescan', payload: {} })]);
    expect((await stat(metaPath)).mtimeMs).toBe(before.mtimeMs);
    await writeFile(path, testPdf(4));
    const changed = (await restarted.inject('/api/overview')).json<OverviewResponse>();
    expect(changed.modules[0]?.lectures[0]?.pageCount).toBe(4);
    const updated = JSON.parse(await readFile(metaPath, 'utf8'));
    expect(updated.acceptedSha256).toBe(meta.acceptedSha256);
    expect(updated.sourceSha256).not.toBe(meta.sourceSha256);
    expect(await readFile(notesPath, 'utf8')).toBe('Eigene Notizen\n');
    expect(await readFile(path)).toEqual(testPdf(4));
    // Auch bei gleicher Dateigröße muss eine geänderte mtime den Cache invalidieren.
    const replacement = Buffer.from(testPdf(4).toString().replaceAll('200 200', '300 300'));
    expect(replacement.length).toBe(testPdf(4).length);
    await writeFile(path, replacement);
    const later = new Date(Date.now() + 2000);
    await utimes(path, later, later);
    await restarted.inject('/api/overview');
    expect(JSON.parse(await readFile(metaPath, 'utf8')).sourceSha256).toBe(createHash('sha256').update(replacement).digest('hex'));
  } finally { await restarted.close(); }
});

it('zeigt defekte PDFs als Fehler und scannt gültige Dateien weiter', async () => {
  const root = await fixture();
  await writeFile(join(root, 'module', 'ids', 'Defekt.pdf'), 'kein PDF');
  await writeFile(join(root, 'module', 'ids', 'Gut.pdf'), testPdf(1));
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    const lectures = (await app.inject('/api/overview')).json<OverviewResponse>().modules[0]?.lectures;
    expect(lectures?.[0]).toMatchObject({ pageCount: null, error: expect.any(String) });
    expect(lectures?.[1]).toMatchObject({ pageCount: 1 });
  } finally { await app.close(); }
});

it('liefert bei fehlendem Datenordner eine leere Übersicht', async () => {
  const root = await fixture();
  const app = await buildApp(loadConfig({ DATA_ROOT: join(root, 'fehlt') }));
  try { expect((await app.inject('/api/overview')).json()).toEqual({ modules: [] }); }
  finally { await app.close(); }
});

it('verhindert Metadaten-Schreibzugriffe durch Junctions außerhalb von notes', async () => {
  const root = await fixture();
  const outside = await fixture();
  await mkdir(join(root, 'notes', 'ids'), { recursive: true });
  await symlink(outside, join(root, 'notes', 'ids', 'Vorlesung'), 'junction');
  await writeFile(join(root, 'module', 'ids', 'Vorlesung.pdf'), testPdf(1));
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    const lecture = (await app.inject('/api/overview')).json<OverviewResponse>().modules[0]?.lectures[0];
    expect(lecture?.error).toBeDefined();
    await expect(readFile(join(outside, 'meta.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  } finally { await app.close(); }
});

it('protokolliert Lesefehler mit Ursache und Vorlesung', async () => {
  const root = await fixture();
  await writeFile(join(root, 'module', 'ids', 'Defekt.pdf'), 'kein PDF');
  const logger = { error: vi.fn() };
  await new Registry(loadConfig({ DATA_ROOT: root }), logger).scan();
  expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({
    err: expect.objectContaining({ name: 'InvalidPDFException' }),
    sourcePdf: 'module/ids/Defekt.pdf', lectureId: expect.any(String),
  }), 'PDF konnte nicht eingelesen werden');
});

it('behält die Seitenzahl bei fehlgeschlagenem Metadaten-Schreiben und loggt die Ursache', async () => {
  const root = await fixture();
  await writeFile(join(root, 'module', 'ids', 'Gut.pdf'), testPdf(7));
  const cause = Object.assign(new Error('Schreibschutz'), { code: 'EACCES' });
  const write = vi.spyOn(files, 'writeJson').mockRejectedValue(cause);
  const logger = { error: vi.fn() };
  try {
    const overview = await new Registry(loadConfig({ DATA_ROOT: root }), logger).scan();
    expect(overview.modules[0]?.lectures[0]).toMatchObject({ pageCount: 7, error: expect.stringContaining('Metadaten') });
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ err: cause, sourcePdf: 'module/ids/Gut.pdf' }), 'Metadaten konnten nicht gespeichert werden');
  } finally { write.mockRestore(); }
});
