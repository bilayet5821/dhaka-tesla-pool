import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/service.js';
import type { SafeUser } from '../auth/repository.js';
import { requireRole, requireSession } from '../auth/middleware.js';
import { PostgresDriverRepository } from './repository.js';

const idInput = z.strictObject({ id: z.uuid() });
const listInput = z.strictObject({
  scope: z.enum(['open', 'active', 'history']).default('active'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export function driverRoutes(repository: PostgresDriverRepository, auth: AuthService) {
  const router = Router();
  router.use(requireSession(auth), requireRole('DRIVER'));
  router.get('/vehicle', (async (_request, response) => {
    response.json({ data: await repository.vehicle((response.locals.authUser as SafeUser).id) });
  }) as RequestHandler);
  router.patch('/vehicle/availability', (async (request, response) => {
    const { isOnline } = z.strictObject({ isOnline: z.boolean() }).parse(request.body);
    response.json({ data: await repository.availability((response.locals.authUser as SafeUser).id, isOnline) });
  }) as RequestHandler);
  router.get('/pools', (async (request, response) => {
    const input = listInput.parse(request.query);
    response.json({ data: await repository.list((response.locals.authUser as SafeUser).id,
      input.scope, input.limit, input.offset) });
  }) as RequestHandler);
  router.get('/pools/:id', (async (request, response) => {
    const { id } = idInput.parse(request.params);
    response.json({ data: await repository.detail((response.locals.authUser as SafeUser).id, id) });
  }) as RequestHandler);
  for (const action of ['accept', 'arrive', 'start', 'complete'] as const) {
    router.post(`/pools/:id/${action}`, (async (request, response) => {
      z.strictObject({}).parse(request.body);
      const { id } = idInput.parse(request.params);
      response.json({ data: await repository.transition((response.locals.authUser as SafeUser).id, id, action) });
    }) as RequestHandler);
  }
  return router;
}
