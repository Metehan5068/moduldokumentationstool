import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { writeAtomic } from '../src/server/files';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
let root: string;
afterEach(async () => { vi.mocked(rename).mockReset().mockImplementation(actual.rename); if (root) await rm(root, { recursive: true, force: true }); });

it('schreibt atomar und wiederholt rename nach simuliertem EPERM', async () => {
  root = await mkdtemp(join(tmpdir(), 'mdt-atomic-'));
  const target = join(root, 'notes.md');
  await writeFile(target, 'Vorher');
  vi.mocked(rename).mockImplementationOnce(async () => {
    expect(await readFile(target, 'utf8')).toBe('Vorher');
    throw Object.assign(new Error('Virenscanner hält Datei geöffnet'), { code: 'EPERM' });
  });
  await writeAtomic(root, target, 'Nachher\n');
  expect(rename).toHaveBeenCalledTimes(2);
  expect(await readFile(target, 'utf8')).toBe('Nachher\n');
  expect(await readdir(root)).toEqual(['notes.md']);
});

it('bricht nach fünf Versuchen ab, erhält die alte Datei und entfernt die temporäre Datei', async () => {
  root = await mkdtemp(join(tmpdir(), 'mdt-atomic-'));
  const target = join(root, 'notes.md');
  await writeFile(target, 'Unverändert');
  vi.mocked(rename).mockRejectedValue(Object.assign(new Error('Datei gesperrt'), { code: 'EBUSY' }));
  await expect(writeAtomic(root, target, 'Darf nicht erscheinen')).rejects.toMatchObject({ code: 'EBUSY' });
  expect(rename).toHaveBeenCalledTimes(5);
  expect(await readFile(target, 'utf8')).toBe('Unverändert');
  expect(await readdir(root)).toEqual(['notes.md']);
});
