import { randomUUID } from 'node:crypto';
import express from 'express';
import type { Pool } from 'pg';
import cookieParser from 'cookie-parser';
import { ZodError } from 'zod';
import { authRoutes } from './modules/auth/routes.js';
import type { AuthConfig } from './modules/auth/routes.js';
import type { AuthRepository } from './modules/auth/repository.js';
import { PostgresAuthRepository } from './modules/auth/repository.js';
import { AuthFailure } from './modules/auth/service.js';
import { AuthService } from './modules/auth/service.js';
import { PostgresRideRepository } from './modules/rides/repository.js';
import { RideFailure } from './modules/rides/service.js';
import { areaRoutes, rideRoutes } from './modules/rides/routes.js';

type AppConfig = AuthConfig & { allowedOrigins: string[]; authRepository?: AuthRepository };

export function createApp(database: Pick<Pool, 'query'> & Partial<Pick<Pool, 'connect'>>,
  overrides: Partial<AppConfig> = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Only the nginx proxy is trusted. It replaces X-Forwarded-For with its observed client IP.
  app.set('trust proxy', 1);
  const config: AppConfig = {
    secureCookies: process.env.NODE_ENV === 'production',
    allowedOrigins: [process.env.APP_ORIGIN ?? 'http://localhost:3000',
      ...(process.env.NODE_ENV === 'production' ? [] : ['http://localhost:5173'])],
    ...overrides,
  };
  app.use((request, response, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    response.setHeader('X-Request-Id', requestId);
    response.on('finish', () => {
      // Never include request bodies, cookies, headers, or connection strings in logs.
      process.stdout.write(`${JSON.stringify({
        event: 'http_request', requestId, method: request.method,
        route: request.route?.path ?? request.path,
        status: response.statusCode, actorId: response.locals.actorId,
        rideRequestId: response.locals.rideRequestId,
        errorCode: response.locals.errorCode,
        durationMs: Math.round(performance.now() - started),
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

  app.use(['/api/v1/auth', '/api/v1/ride-requests'], (request, response, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) return next();
    if (!config.allowedOrigins.includes(request.get('origin') ?? '')) {
      response.locals.errorCode = 'ORIGIN_NOT_ALLOWED';
      response.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin not allowed' } });
      return;
    }
    if (!request.is('application/json')) {
      response.locals.errorCode = 'UNSUPPORTED_MEDIA_TYPE';
      response.status(415).json({ error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Use application/json' } });
      return;
    }
    next();
  });
  app.use('/api/v1/auth', express.json({ limit: '16kb' }), cookieParser(),
    authRoutes(config.authRepository ?? new PostgresAuthRepository(database), config));

  const rideRepository = new PostgresRideRepository(database as Pool);
  app.use('/api/v1/areas', areaRoutes(rideRepository));
  app.use('/api/v1/ride-requests', express.json({ limit: '16kb' }), cookieParser(),
    rideRoutes(rideRepository, new AuthService(config.authRepository ?? new PostgresAuthRepository(database), config.now)));

  app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    void _next;
    const status = error instanceof AuthFailure || error instanceof RideFailure ? error.status : error instanceof ZodError ? 400
      : error instanceof SyntaxError && 'body' in error ? 400 : 500;
    const code = error instanceof AuthFailure || error instanceof RideFailure ? error.code
      : status === 400 ? 'INVALID_INPUT' : 'INTERNAL_ERROR';
    response.locals.errorCode = code;
    response.status(status).json({ error: {
      code, message: error instanceof AuthFailure || error instanceof RideFailure ? error.message
        : status === 400 ? 'Invalid request' : 'Unexpected error',
      ...(error instanceof ZodError ? { details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })) } : {}),
    } });
  });
  return app;
}
