import type { FastifyInstance } from 'fastify';
import { buildApp as productionApp } from '../../src/server/app';
import type { AppConfig } from '../../src/server/config';
/** Normaler Test-Client wie der Browser: lokale Host-/Origin-Header, explizite Overrides bleiben erhalten. */
export async function buildApp(config: AppConfig, options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = await productionApp(config, options);
  const inject = app.inject.bind(app);
  app.inject = ((input: string | { headers?: Record<string, string>; [key: string]: unknown }) => {
    const options = typeof input === 'string' ? { url: input } : input;
    const address = app.server.address(); const port = address && typeof address === 'object' ? address.port : config.port;
    return inject({ ...options, headers: { host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, ...options.headers } });
  }) as FastifyInstance['inject'];
  return app;
}
