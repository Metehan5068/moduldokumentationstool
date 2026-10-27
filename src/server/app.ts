import { existsSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import type { HealthResponse } from '../shared/api.js';
import type { AppConfig } from './config.js';
import { Registry } from './registry.js';

export async function buildApp(config: AppConfig, opts: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? false });
  const registry = new Registry(config, app.log);

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
    await app.register(fastifyStatic, { root: config.webRoot, wildcard: false });
  }

  // Unbekannte /api-Routen → JSON-404, alles andere → SPA (index.html).
  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith('/api/') || !hasBuiltWeb || request.method !== 'GET') {
      return reply.code(404).send({ error: 'not_found' });
    }
    return reply.sendFile('index.html');
  });

  return app;
}
