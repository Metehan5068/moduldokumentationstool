import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
import { lectureId } from '../src/server/registry';
import { testPdf } from './fixtures/pdf';

it('liefert Vorlesungsdetails sowie vollständige, partielle und HEAD-PDF-Antworten per ID', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdt-pdf-'));
  await mkdir(join(root, 'module', 'ids'), { recursive: true });
  const filename = 'Ä-2-Data exploration, preprocessing.pdf';
  const path = join(root, 'module', 'ids', filename);
  const data = testPdf(132);
  await writeFile(path, data);
  const id = lectureId(`module/ids/${filename}`);
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    // Direkter Einstieg funktioniert auch vor dem ersten Übersichtsscan.
    const detail = await app.inject(`/api/lectures/${id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id, title: filename.slice(0, -4), module: 'ids', pageCount: 132 });
    expect(detail.body).not.toContain('sourcePdf');
    const url = `/api/lectures/${id}/pdf`;
    const full = await app.inject(url);
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload).toEqual(data);
    expect(full.headers['content-type']).toBe('application/pdf');
    expect(full.headers['accept-ranges']).toBe('bytes');
    const partial = await app.inject({ url, headers: { range: 'bytes=10-29' } });
    expect(partial.statusCode).toBe(206);
    expect(partial.headers['content-range']).toBe(`bytes 10-29/${data.length}`);
    expect(partial.rawPayload).toEqual(data.subarray(10, 30));
    const suffix = await app.inject({ url, headers: { range: 'bytes=-12' } });
    expect(suffix.statusCode).toBe(206);
    expect(suffix.rawPayload).toEqual(data.subarray(-12));
    const openRange = await app.inject({ url, headers: { range: `bytes=${data.length - 8}-` } });
    expect(openRange.rawPayload).toEqual(data.subarray(-8));
    const invalid = await app.inject({ url, headers: { range: `bytes=${data.length + 5}-` } });
    expect(invalid.statusCode).toBe(416);
    expect(invalid.headers['content-range']).toBe(`bytes */${data.length}`);
    const head = await app.inject({ method: 'HEAD', url });
    expect(head.statusCode).toBe(200);
    expect(head.body).toBe('');
    expect(Number(head.headers['content-length'])).toBe(data.length);
    expect((await app.inject('/api/lectures/0000000000000000/pdf')).statusCode).toBe(404);
    expect((await app.inject('/api/lectures/invalid/pdf')).statusCode).toBe(404);
    expect((await app.inject('/module/ids/test.pdf')).headers['content-type']).not.toBe('application/pdf');
    expect(await readFile(path)).toEqual(data);
    await rm(path);
    expect((await app.inject(url)).statusCode).toBe(404);
    // Nach einem Scan darf ein später gesetzter Junction nicht aus module/ führen.
    await rm(join(root, 'module', 'ids'), { recursive: true });
    await mkdir(join(root, 'outside'));
    await writeFile(join(root, 'outside', filename), data);
    await symlink(join(root, 'outside'), join(root, 'module', 'ids'), 'junction');
    expect((await app.inject(url)).statusCode).toBe(404);
  } finally {
    await app.close();
    // root ist ausschließlich der oben angelegte temporäre Testordner.
    await rm(root, { recursive: true, force: true });
  }
});
