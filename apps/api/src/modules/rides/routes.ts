import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { requireRole, requireSession } from '../auth/middleware.js';
import type { AuthService } from '../auth/service.js';
import type { SafeUser } from '../auth/repository.js';
import { PostgresRideRepository } from './repository.js';
import { RideService } from './service.js';

const createInput = z.strictObject({
  pickupAreaId: z.uuid(), destinationAreaId: z.uuid(), seats: z.number().int().min(1).max(3),
});
const idInput = z.strictObject({ id: z.uuid() });
const listInput = z.strictObject({
  scope: z.enum(['active', 'history']).default('active'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export function rideRoutes(repository: PostgresRideRepository, auth: AuthService) {
  const service = new RideService(repository);
  const router = Router();
  router.use(requireSession(auth), requireRole('PASSENGER'));
  router.post('/', (async (request, response) => {
    const input = createInput.parse(request.body);
    const user = response.locals.authUser as SafeUser;
    const ride = await service.create({ ...input, passengerId: user.id });
    response.locals.rideRequestId = ride.id;
    response.status(201).json({ data: ride });
  }) as RequestHandler);
  router.get('/', (async (request, response) => {
    const input = listInput.parse(request.query);
    const user = response.locals.authUser as SafeUser;
    response.json({ data: await service.list(user.id, input.scope, input.limit, input.offset) });
  }) as RequestHandler);
  router.get('/:id', (async (request, response) => {
    const { id } = idInput.parse(request.params);
    const user = response.locals.authUser as SafeUser;
    const ride = await service.find(id, user.id);
    response.locals.rideRequestId = ride.id;
    response.json({ data: ride });
  }) as RequestHandler);
  router.post('/:id/cancel', (async (request, response) => {
    z.strictObject({}).parse(request.body);
    const { id } = idInput.parse(request.params);
    const user = response.locals.authUser as SafeUser;
    const ride = await service.cancel(id, user.id);
    response.locals.rideRequestId = ride.id;
    response.json({ data: ride });
  }) as RequestHandler);
  return router;
}

export function areaRoutes(repository: PostgresRideRepository) {
  const service = new RideService(repository);
  const router = Router();
  router.get('/', (async (_request, response) => {
    response.json({ data: await service.areas() });
  }) as RequestHandler);
  return router;
}
