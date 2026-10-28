import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { buildApp } from '../src/server/app';
import { loadConfig } from '../src/server/config';
it('erlaubt ausschließlich lokale Hosts und JSON-Schreibzugriffe vom lokalen Ursprung am richtigen Port', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mdt-security-'));
  const app = await buildApp(loadConfig({ DATA_ROOT: root }));
  try {
    for (const host of ['127.0.0.1:3000', 'localhost:3000']) {
      expect((await app.inject({ url: '/api/health', headers: { host } })).statusCode).toBe(200);
      expect((await app.inject({ method: 'POST', url: '/api/rescan', headers: { host, origin: 'http://localhost:3000' }, payload: {} })).statusCode).toBe(200);
    }
    for (const host of ['evil.test:3000', '127.0.0.1.evil.test:3000', '127.0.0.1:3001', 'localhost', 'localhost:3000@evil.test', '[::1]:3000']) {
      expect((await app.inject({ url: '/api/health', headers: { host, 'x-forwarded-host': '127.0.0.1:3000' } })).statusCode).toBe(403);
    }
    for (const origin of [undefined, 'null', 'https://evil.test', 'http://localhost:3001', 'https://127.0.0.1:3000', 'http://127.0.0.1:3000.evil.test', 'http://127.0.0.1:3000/path']) {
      const headers: Record<string, string> = { host: '127.0.0.1:3000' }; if (origin) headers.origin = origin;
      expect((await app.inject({ method: 'POST', url: '/api/rescan', headers, payload: {} })).statusCode).toBe(403);
    }
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'application/jsonp']) {
      expect((await app.inject({ method: 'POST', url: '/api/rescan', headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'content-type': type }, payload: '{}' })).statusCode).toBe(415);
    }
  } finally { await app.close(); await rm(root, { recursive: true, force: true }); }
});
