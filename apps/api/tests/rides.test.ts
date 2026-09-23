import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { hashSessionToken, newSessionToken, SESSION_COOKIE } from '../src/modules/auth/security.js';
import type { AuthRepository } from '../src/modules/auth/repository.js';
import { RideService } from '../src/modules/rides/service.js';
import type { PostgresRideRepository, RideRow } from '../src/modules/rides/repository.js';

const banani = '76d763e5-c603-46eb-a107-ffeb1fd49e94';
const mohakhali = '0475acbc-b8fd-407f-84d6-a724d2f7b6a7';
const gulshan = '73414c18-e836-4fee-95bb-b6b3d2eadfe6';

function fixture() {
  const stored: RideRow[] = [];
  const repository = {
    tariff: async (pickup: string, destination: string) => pickup === banani &&
      (destination === mohakhali || destination === gulshan) ? {
        pricing_version: 1, base_per_seat_poysha: 5000,
        zone_charge_poysha: destination === mohakhali ? 8000 : 12000,
      } : null,
    create: async (input: { passengerId: string; pickupId: string; destinationId: string;
      seats: number; estimatedFarePoysha: number; pricingVersion: number }) => {
      const now = new Date();
      const row: RideRow = { id: 'test-request', passenger_user_id: input.passengerId,
        pickup_area_id: input.pickupId, destination_area_id: input.destinationId,
        seats_requested: input.seats, status: 'REQUESTED', estimated_fare_poysha: input.estimatedFarePoysha,
        pricing_version: input.pricingVersion, payment_method: 'CASH', created_at: now,
        updated_at: now, cancelled_at: null };
      stored.push(row);
      return row;
    },
  } as unknown as PostgresRideRepository;
  return { service: new RideService(repository), stored };
}

describe('approved standalone fare before matching', () => {
  it('quotes Nusrat 13000 and Rafiq 17000 poysha with no early pool discount', async () => {
    const { service, stored } = fixture();
    const nusrat = await service.create({ passengerId: 'nusrat', pickupAreaId: banani,
      destinationAreaId: mohakhali, seats: 1 });
    const rafiq = await service.create({ passengerId: 'rafiq', pickupAreaId: banani,
      destinationAreaId: gulshan, seats: 1 });
    expect(nusrat).toMatchObject({ status: 'REQUESTED', estimatedFarePoysha: 13000 });
    expect(rafiq).toMatchObject({ status: 'REQUESTED', estimatedFarePoysha: 17000 });
    expect(stored.map((ride) => ride.estimated_fare_poysha)).toEqual([13000, 17000]);
  });

  it('multiplies per-seat fare and rejects identical endpoints', async () => {
    const { service } = fixture();
    expect((await service.create({ passengerId: 'nusrat', pickupAreaId: banani,
      destinationAreaId: mohakhali, seats: 3 })).estimatedFarePoysha).toBe(39000);
    await expect(service.create({ passengerId: 'nusrat', pickupAreaId: banani,
      destinationAreaId: banani, seats: 1 })).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });
});

describe('ride API guards before database access', () => {
  it('rejects anonymous, driver, invalid passenger payload and cross-origin writes', async () => {
    const token = newSessionToken();
    const passengerToken = newSessionToken();
    const sessionHash = hashSessionToken(token);
    const app = createApp({ query: async () => ({ rows: [] }) } as never, {
      allowedOrigins: ['http://localhost:3000'],
      authRepository: {
        findActiveUserBySession: async (hash: string) => hash === sessionHash ? {
          id: banani, name: 'Jashim', normalized_email: 'jashim@example.com', role: 'DRIVER',
        } : hash === hashSessionToken(passengerToken) ? {
          id: mohakhali, name: 'Nusrat', normalized_email: 'nusrat@example.com', role: 'PASSENGER',
        } : null,
      } as unknown as AuthRepository,
    });
    const cookie = `${SESSION_COOKIE}=${token}`;
    expect((await request(app).get('/api/v1/ride-requests')).status).toBe(401);
    const driver = await request(app).post('/api/v1/ride-requests')
      .set('Origin', 'http://localhost:3000').set('Cookie', cookie)
      .send({ pickupAreaId: banani, destinationAreaId: mohakhali, seats: 1 });
    expect(driver.status).toBe(403);
    expect(driver.body.error.code).toBe('FORBIDDEN');
    const invalid = await request(app).post('/api/v1/ride-requests')
      .set('Origin', 'http://localhost:3000').set('Cookie', `${SESSION_COOKIE}=${passengerToken}`)
      .send({ pickupAreaId: banani, destinationAreaId: mohakhali, seats: 4 });
    expect(invalid.status).toBe(400);
    expect((await request(app).post('/api/v1/ride-requests').set('Origin', 'https://attacker.example')
      .set('Cookie', cookie).send({})).status).toBe(403);
  });
});
