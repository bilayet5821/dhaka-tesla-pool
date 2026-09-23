import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Pool } from 'pg';

export function createApp(database: Pick<Pool, 'query'>) {
  const app = express();
  app.disable('x-powered-by');
  app.use((request, response, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    response.setHeader('X-Request-Id', requestId);
    response.on('finish', () => {
      // Never include request bodies, cookies, headers, or connection strings in logs.
      process.stdout.write(`${JSON.stringify({
        event: 'http_request', requestId, method: request.method,
        route: request.route?.path ?? request.path,
        status: response.statusCode, durationMs: Math.round(performance.now() - started),
      })}\n`);
    });
    next();
  });
  app.get('/api/v1/health/live', (_request, response) => {
    response.json({ data: { status: 'live' } });
  });
  app.get('/api/v1/health/ready', async (_request, response) => {
    try {
      const result = await database.query<{ installed: string | null }>("SELECT to_regclass('public.schema_migrations') AS installed");
      if (!result.rows[0]?.installed) {
        response.status(503).json({ error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Database migrations not initialized' } });
        return;
      }
      response.json({ data: { status: 'ready' } });
    } catch {
      response.status(503).json({ error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Database unavailable' } });
    }
  });
  return app;
}
