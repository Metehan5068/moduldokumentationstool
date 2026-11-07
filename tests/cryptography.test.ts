import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from './helpers/app';
import { loadConfig } from '../src/server/config';
import { lectureId } from '../src/server/registry';
import type { LectureResponse, OverviewResponse } from '../src/shared/api';
import { citationReferences, readerMarkdown } from '../src/shared/citations';
import { INITIAL_STATE, isLectureState, normalizeState } from '../src/shared/state';
import { testPdf } from './fixtures/pdf';
import * as files from '../src/server/files';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(folder = 'whiteboard') {
  const root = await mkdtemp(join(tmpdir(), 'mdt-crypto-')); roots.push(root);
  const module = join(root, 'module', 'Cryptography');
  await mkdir(join(module, folder), { recursive: true }); await mkdir(join(module, 'mds'));
  await writeFile(join(module, 'mini-script.pdf'), testPdf(4));
  await writeFile(join(module, folder, 'Lecture 1 - Example.pdf'), testPdf(7));
  await writeFile(join(module, folder, 'Lecture 10 - More.pdf'), testPdf(2));
  await writeFile(join(module, folder, 'Lecture 2 - Second.pdf'), testPdf(2));
  const markdown = '# Lecture 1\n\nQuelle [3][src-3], Skript [8][src-8], Andere [9][src-9].\n\n'
    + '[src-3]: <Lecture 1 - Example - Summary.pdf#page=3>\n[src-8]: <mini-script.pdf#page=2>\n'
    + `[src-9]: <../${folder}/Lecture%202%20-%20Second.pdf#page=2>\n`;
  await writeFile(join(module, 'mds', 'Lecture 1.md'), markdown);
  return { root, module, markdown };
}
const id = lectureId('module/Cryptography/lecture/1');

it('wertet Referenzen in Tabellen aus, ignoriert Codebeispiele und erhält die Originaldatei', () => {
  const md = '| Quelle |\n|---|\n| [3][src-3] |\n\n`[77][src-77]`\n\n```markdown\n[9][src-9]\n[src-9]: <Fake.pdf#page=4>\n```\n\n'
    + '[src-3]: <Lecture 1 - Example.pdf#page=3>\n\nFehlt [4][src-4].\n\n\\[ x^2 \\]\n';
  const parsed = citationReferences(md);
  expect([...parsed.used].sort()).toEqual(['src-3', 'src-4']);
  expect([...parsed.definitions]).toEqual([['src-3', 'Lecture%201%20-%20Example.pdf#page=3']]);
  const rendered = readerMarkdown(md);
  expect(rendered).toContain('[src-3]: #citation-src-3');
  expect(rendered).toContain('[src-4]: #citation-src-4');
  expect(rendered).toContain('[src-9]: <Fake.pdf#page=4>');
  expect(rendered).toContain('$$\n x^2 \n$$');
});

it.each(['whiteboard', 'Summary'])('bündelt %s, löst alte Namen/relative Pfade auf und scannt neue Markdown-Dateien', async (folder) => {
  const { root, module, markdown } = await fixture(folder);
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    const overview = (await app.inject('/api/overview')).json<OverviewResponse>();
    expect(overview.modules[0]!.lectures.map((l) => l.title)).toEqual(['Lecture 1', 'Lecture 2', 'Lecture 10']);
    const response = (await app.inject(`/api/lectures/${id}`)).json<LectureResponse>();
    expect(response).toMatchObject({ viewKind: 'cryptography', pageCount: 7, markdownAvailable: true });
    const crypto = response.cryptography!;
    expect(crypto.citations).toEqual(expect.arrayContaining([
      { id: 'src-3', documentId: crypto.whiteboardId, page: 3 }, { id: 'src-8', documentId: crypto.scriptId, page: 2 },
      { id: 'src-9', documentId: expect.any(String), page: 2 },
    ]));
    expect(crypto.documents.filter((d) => d.kind === 'script')).toHaveLength(1);
    expect(JSON.stringify(response)).not.toContain(root.replaceAll('\\', '\\\\'));
    const pdf = await app.inject(`/api/documents/${crypto.scriptId}/pdf`);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((await app.inject({ url: `/api/documents/${crypto.scriptId}/pdf`, headers: { range: 'bytes=0-19' } })).statusCode).toBe(206);
    await writeFile(join(module, 'mds', 'Lecture 2.md'), '# Lecture 2');
    const updated = (await app.inject({ method: 'POST', url: '/api/rescan', payload: {} })).json<OverviewResponse>();
    expect(updated.modules[0]!.lectures[1]!.markdownAvailable).toBe(true);
    expect(await readFile(join(module, 'mds', 'Lecture 1.md'), 'utf8')).toBe(markdown);
    expect((await app.inject({ method: 'PUT', url: `/api/lectures/${id}/notes/1`, payload: { text: 'x', baseHash: 'a'.repeat(64) } })).statusCode).toBe(405);
  } finally { await app.close(); }
  const caches = await readdir(join(root, 'notes', '.documents'));
  expect(caches).toHaveLength(4);
  expect(await readFile(join(root, 'INDEX.md'), 'utf8')).toContain('Lernskript');
  const restarted = await buildApp(loadConfig({ DATA_ROOT: root }));
  try { expect((await restarted.inject('/api/overview')).json<OverviewResponse>().orphans ?? []).toEqual([]); }
  finally { await restarted.close(); }
});

it('meldet fehlende, doppelte, ungültige und aus dem Modul führende Quellen', async () => {
  const { root, module } = await fixture();
  await mkdir(join(module, 'Summary'));
  await writeFile(join(module, 'Summary', 'Lecture 1 - Example.pdf'), testPdf(7));
  await writeFile(join(module, 'mds', 'Lecture 1.md'), '[1][src-1] [2][src-2] [3][src-3] [4][src-4] [5][src-5]\n\n'
    + '[src-1]: <Lecture 1 - Example - Summary.pdf#page=2>\n[src-2]: <mini-script.pdf#page=999>\n'
    + '[src-3]: <../../secret.pdf#page=1>\n[src-4]: <https://example.com/x.pdf#page=1>\n');
  await writeFile(join(module, 'mds', 'Lecture 3.md'), '# Markdown ohne Whiteboard');
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    const lecture = (await app.inject(`/api/lectures/${id}`)).json<LectureResponse>();
    expect(lecture.cryptography!.whiteboardId).toBeUndefined();
    expect(lecture.cryptography!.warnings.join()).toContain('Mehrere Whiteboards');
    expect(lecture.cryptography!.citations.every((c) => c.error)).toBe(true);
    const mdOnly = (await app.inject(`/api/lectures/${lectureId('module/Cryptography/lecture/3')}`)).json<LectureResponse>();
    expect(mdOnly.pageCount).toBe(0); expect(mdOnly.cryptography!.markdown).toContain('ohne Whiteboard');
    expect((await app.inject('/api/documents/0000000000000000/pdf')).statusCode).toBe(404);
  } finally { await app.close(); }
});

it('erhält Lecture-Identität, erledigt und Reader-State bei Umbenennung und Neustart', async () => {
  const { root, module } = await fixture();
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  let state;
  try {
    const lecture = (await app.inject(`/api/lectures/${id}`)).json<LectureResponse>();
    const board = lecture.cryptography!.whiteboardId!;
    const script = lecture.cryptography!.scriptId!;
    state = { ...INITIAL_STATE, lastPage: 3, maxPageVisited: 3, updatedAt: new Date().toISOString(), reader: {
      activeDocumentId: script, positions: { [board]: { page: 3, offsetRatio: 0.25 }, [script]: { page: 2, offsetRatio: 0.5 } }, markdownScrollRatio: 0.4,
    } };
    expect(isLectureState(state)).toBe(true); expect(normalizeState(state, 7).reader).toEqual(state.reader);
    expect((await app.inject({ method: 'PUT', url: `/api/lectures/${id}/state`, payload: state })).statusCode).toBe(200);
    expect((await app.inject({ method: 'PUT', url: `/api/lectures/${id}/completed`, payload: { completed: true } })).statusCode).toBe(200);
    await rename(join(module, 'whiteboard', 'Lecture 1 - Example.pdf'), join(module, 'whiteboard', 'Lecture 1 - Renamed.pdf'));
  } finally { await app.close(); }
  const restarted = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    const lecture = (await restarted.inject(`/api/lectures/${id}`)).json<LectureResponse>();
    expect(lecture.completed).toBe(true); expect(lecture.state.reader).toEqual(state!.reader);
    expect(lecture.state.maxPageVisited).toBe(7);
    const bad = { ...state!, reader: { ...state!.reader, positions: { ['0'.repeat(16)]: { page: 1, offsetRatio: 0 } } } };
    expect((await restarted.inject({ method: 'PUT', url: `/api/lectures/${id}/state`, payload: bad })).statusCode).toBe(400);
  } finally { await restarted.close(); }
});

it('erkennt Änderungen am gemeinsamen Skript und bestätigt nur den angezeigten Hash', async () => {
  const { root, module } = await fixture();
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    const first = (await app.inject(`/api/lectures/${id}`)).json<LectureResponse>().cryptography!;
    const old = first.documents.find((d) => d.id === first.scriptId)!;
    await writeFile(join(module, 'mini-script.pdf'), testPdf(5));
    const second = (await app.inject(`/api/lectures/${id}`)).json<LectureResponse>();
    expect(second.sourceChanged).toBe(true);
    const script = second.cryptography!.documents.find((d) => d.id === old.id)!;
    expect((await app.inject({ method: 'POST', url: `/api/documents/${old.id}/accept-source`, payload: { sourceSha256: old.sourceSha256 } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: `/api/documents/${old.id}/accept-source`, payload: { sourceSha256: script.sourceSha256 } })).statusCode).toBe(200);
    expect((await app.inject(`/api/lectures/${id}`)).json<LectureResponse>().sourceChanged).toBe(false);
  } finally { await app.close(); }
});

it('liefert nachträglich durch Junction ersetzte Quellen nicht aus', async () => {
  const { root, module } = await fixture();
  const outside = await mkdtemp(join(tmpdir(), 'mdt-outside-')); roots.push(outside);
  await writeFile(join(outside, 'Lecture 1 - Example.pdf'), testPdf(1));
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    const lecture = (await app.inject(`/api/lectures/${id}`)).json<LectureResponse>();
    await rename(join(module, 'whiteboard'), join(module, 'original-whiteboard'));
    await symlink(outside, join(module, 'whiteboard'), 'junction');
    expect((await app.inject(`/api/documents/${lecture.cryptography!.whiteboardId}/pdf`)).statusCode).toBe(404);
  } finally { await app.close(); }
});

it('hält PDFs und Markdown bei fehlgeschlagenem Metadaten-Schreiben lesbar', async () => {
  const { root } = await fixture();
  vi.spyOn(files, 'writeJson').mockRejectedValue(Object.assign(new Error('readonly'), { code: 'EACCES' }));
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    expect((await app.inject('/api/overview')).statusCode).toBe(200);
    const lecture = (await app.inject(`/api/lectures/${id}`)).json<LectureResponse>();
    expect(lecture.pageCount).toBe(7); expect(lecture.cryptography!.markdown).toContain('Quelle');
    expect(lecture.cryptography!.warnings.join()).toContain('Metadaten');
    expect((await app.inject(`/api/documents/${lecture.cryptography!.whiteboardId}/pdf`)).statusCode).toBe(200);
  } finally { await app.close(); }
});
