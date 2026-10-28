import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from './helpers/app';
import { loadConfig } from '../src/server/config';

const tmp = mkdtempSync(join(tmpdir(), 'mdt-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('config', () => {
  it('nutzt ohne DATA_ROOT die Repo-Wurzel', () => {
    const cfg = loadConfig({});
    expect(cfg.dataRoot).toBe(cfg.appRoot);
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.port).toBe(3000);
  });

  it('löst relatives DATA_ROOT ab der Repo-Wurzel auf', () => {
    const cfg = loadConfig({ DATA_ROOT: '../daten' });
    expect(cfg.dataRoot).toBe(join(cfg.appRoot, '..', 'daten'));
    expect(cfg.moduleRoot).toBe(join(cfg.dataRoot, 'module'));
  });

  it('lehnt ungültigen PORT ab', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });
});

describe('GET /api/health', () => {
  it('liefert status ok und Ordnerstatus', async () => {
    mkdirSync(join(tmp, 'module'));
    const app = await buildApp(loadConfig({ DATA_ROOT: tmp }));
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      dataRoot: tmp,
      moduleDirExists: true,
      notesDirExists: false,
    });
    await app.close();
  });

  it('liefert JSON-404 für unbekannte API-Routen', async () => {
    const app = await buildApp(loadConfig({ DATA_ROOT: tmp }));
    const res = await app.inject({ method: 'GET', url: '/api/gibts-nicht' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
    await app.close();
  });
});
