import type { FastifyInstance } from 'fastify';
import type { AppConfig } from './config.js';
export function localRequestGuard(app: FastifyInstance, config: AppConfig) {
  app.addHook('onRequest', async (request, reply) => {
    const address = app.server.address();
    const port = address && typeof address === 'object' ? address.port : config.port;
    const host = request.headers.host ?? '';
    const match = /^(?:127\.0\.0\.1|localhost)(?::([0-9]+))?$/i.exec(host);
    if (!match || Number(match[1] ?? 80) !== port) return reply.code(403).send({ error: 'invalid_host', message: 'Host ist nicht lokal oder verwendet den falschen Port.' });
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return;
    const allowed = ['127.0.0.1', 'localhost'].map((name) => new URL(`http://${name}:${port}`).origin);
    if (!request.headers.origin || !allowed.includes(request.headers.origin)) return reply.code(403).send({ error: 'invalid_origin', message: 'Schreibzugriffe sind nur aus der lokalen App erlaubt.' });
    if (!/^application\/json(?:\s*;|\s*$)/i.test(request.headers['content-type'] ?? '')) return reply.code(415).send({ error: 'json_required' });
  });
}
