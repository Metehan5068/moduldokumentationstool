import { existsSync } from 'node:fs';
import { relative } from 'node:path';
import { stat } from 'node:fs/promises';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { HealthResponse } from '../shared/api.js';
import type { AppConfig } from './config.js';
import { Registry } from './registry.js';
import { safePath } from './files.js';
import { NoteConflictError, noteHash, NotesParseError, NotesStore } from './notes-store.js';

export async function buildApp(config: AppConfig, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false, ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  const registry = new Registry(config, app.log);
  const notes = new NotesStore(config);

  // Nur explizite ID-Routen dürfen PDFs ausliefern; kein öffentlicher Datenordner.
  await app.register(fastifyStatic, { root: config.moduleRoot, serve: false });

  async function findLecture(id: string) {
    if (!/^[a-f0-9]{16}$/.test(id)) return undefined;
    if (!registry.get(id)) await registry.scan();
    return registry.get(id);
  }

  app.get<{ Params: { id: string } }>('/api/lectures/:id', async (request, reply) => {
    const lecture = await findLecture(request.params.id);
    if (!lecture) return reply.code(404).send({ error: 'not_found' });
    try {
      return { ...lecture.summary, module: lecture.module, notes: await notes.read(lecture) };
    } catch (err) {
      request.log.error({ err, lectureId: request.params.id }, 'Notizen konnten nicht gelesen werden');
      return { ...lecture.summary, module: lecture.module, notes: {}, readOnlyError: {
        message: err instanceof NotesParseError ? err.message : 'Notizen konnten nicht gelesen werden. Zugriffsrechte prüfen.',
        ...(err instanceof NotesParseError ? { line: err.line } : {}),
      } };
    }
  });

  app.put<{ Params: { id: string; page: string }; Body: { text: string; baseHash: string } }>('/api/lectures/:id/notes/:page', {
    schema: { body: {
      type: 'object', required: ['text', 'baseHash'], additionalProperties: false,
      properties: { text: { type: 'string', maxLength: 500000 }, baseHash: { type: 'string', pattern: '^[a-f0-9]{64}$' } },
    } },
  }, async (request, reply) => {
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) return reply.code(415).send({ error: 'json_required' });
    const lecture = await findLecture(request.params.id);
    if (!lecture) return reply.code(404).send({ error: 'not_found' });
    const page = Number(request.params.page);
    if (!/^[1-9]\d*$/.test(request.params.page) || !Number.isSafeInteger(page) || page > (lecture.summary.pageCount ?? 0)) {
      return reply.code(400).send({ error: 'invalid_page' });
    }
    try {
      const saved = await notes.write(lecture, page, request.body.text, request.body.baseHash);
      return { hash: saved.hash };
    } catch (err) {
      if (err instanceof NoteConflictError) return reply.code(409).send({ currentText: err.currentText, currentHash: noteHash(err.currentText) });
      request.log.error({ err, lectureId: request.params.id, page }, 'Notiz konnte nicht gespeichert werden');
      if (err instanceof NotesParseError) return reply.code(422).send({ error: 'notes_invalid', message: err.message, line: err.line });
      return reply.code(500).send({ error: 'save_failed', message: 'Fehler beim Speichern. Bitte erneut versuchen.' });
    }
  });

  app.get<{ Params: { id: string } }>('/api/lectures/:id/pdf', async (request, reply) => {
    const lecture = await findLecture(request.params.id);
    if (!lecture) return reply.code(404).send({ error: 'not_found' });
    try {
      await safePath(config.dataRoot, config.moduleRoot);
      await safePath(config.moduleRoot, lecture.pdfPath);
      if (!(await stat(lecture.pdfPath)).isFile()) return reply.code(404).send({ error: 'not_found' });
    } catch (err) {
      request.log.warn({ err, lectureId: request.params.id }, 'PDF nicht verfügbar');
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.type('application/pdf').header('X-Content-Type-Options', 'nosniff')
      .sendFile(relative(config.moduleRoot, lecture.pdfPath).replaceAll('\\', '/'), config.moduleRoot, { acceptRanges: true, maxAge: 0 });
  });

  app.get('/api/overview', () => registry.scan());
  app.post('/api/rescan', () => registry.scan());

  app.get('/api/health', async (): Promise<HealthResponse> => ({
    status: 'ok',
    dataRoot: config.dataRoot,
    moduleDirExists: existsSync(config.moduleRoot),
    notesDirExists: existsSync(config.notesRoot),
  }));

  const hasBuiltWeb = existsSync(config.webRoot);
  if (hasBuiltWeb) {
    await app.register(fastifyStatic, { root: config.webRoot, wildcard: false, decorateReply: false });
  }

  // Unbekannte /api-Routen → JSON-404, alles andere → SPA (index.html).
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || !hasBuiltWeb || request.method !== 'GET') {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html', config.webRoot);
  });

  return app;
}
