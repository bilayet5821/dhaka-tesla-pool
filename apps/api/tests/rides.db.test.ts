import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import request from 'supertest';

const enabled = Boolean(process.env.TEST_DATABASE_URL &&
  process.env.TEST_DATABASE_URL === process.env.DATABASE_URL);
const origin = 'http://localhost:3000';

describe.skipIf(!enabled)('ride requests against PostgreSQL', () => {
  let database: typeof import('../src/db/pool.js').pool;
  let app: ReturnType<typeof import('../src/app.js').createApp>;
  let banani: string;
  let mohakhali: string;
  let gulshan: string;
  let dhanmondi: string;
  let nusratCookie: string;
  let rafiqCookie: string;
  let shirinCookie: string;
  let driverCookie: string;
  const createdIds: string[] = [];

  async function register(name: string) {
    const response = await request(app).post('/api/v1/auth/register').set('Origin', origin)
      .send({ name, email: `${name.toLowerCase()}-${randomUUID()}@example.com`,
        password: randomBytes(24).toString('base64url') });
    expect(response.status).toBe(201);
    const cookies = response.headers['set-cookie'];
    if (!cookies) throw new Error('Registration did not set a session cookie');
    return (Array.isArray(cookies) ? cookies[0] : cookies).split(';')[0];
  }

  function create(cookie: string, pickupAreaId = banani, destinationAreaId = mohakhali, seats = 1) {
    return request(app).post('/api/v1/ride-requests').set('Origin', origin).set('Cookie', cookie)
      .send({ pickupAreaId, destinationAreaId, seats });
  }

  beforeAll(async () => {
    database = (await import('../src/db/pool.js')).pool;
    await (await import('../src/db/migrate.js')).migrate();
    app = (await import('../src/app.js')).createApp(database, { allowedOrigins: [origin] });
    nusratCookie = await register('Nusrat');
    rafiqCookie = await register('Rafiq');
    shirinCookie = await register('Shirin');
    const driverId = randomUUID();
    const { hashSessionToken, newSessionToken, SESSION_COOKIE } = await import('../src/modules/auth/security.js');
    const token = newSessionToken();
    driverCookie = `${SESSION_COOKIE}=${token}`;
    const driverEmail = `jashim-${randomUUID()}@example.com`;
    await database.query(
      `INSERT INTO users (id, name, normalized_email, password_hash, role)
       VALUES ($1, 'Jashim', $2, $3, 'DRIVER')`,
      [driverId, driverEmail, await argon2.hash(randomBytes(24).toString('base64url'))],
    );
    await database.query(
      `INSERT INTO sessions (id, user_id, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + interval '1 day')`,
      [randomUUID(), driverId, hashSessionToken(token)],
    );
    const { seedRideDomain } = await import('../src/db/seed.js');
    await seedRideDomain(driverEmail);
    await seedRideDomain(driverEmail);
    const areas = await database.query<{ id: string; code: string }>('SELECT id, code FROM areas');
    banani = areas.rows.find((area) => area.code === 'banani')!.id;
    mohakhali = areas.rows.find((area) => area.code === 'mohakhali')!.id;
    gulshan = areas.rows.find((area) => area.code === 'gulshan-1')!.id;
    dhanmondi = areas.rows.find((area) => area.code === 'dhanmondi')!.id;
  });

  afterAll(async () => { if (database) await database.end(); });

  it('lists supported areas and saves Nusrat and Rafiq standalone estimates and creation events', async () => {
    const bullet = await database.query<{ name: string; capacity_seats: number; is_online: boolean }>(
      'SELECT name, capacity_seats, is_online FROM vehicles WHERE driver_user_id = (SELECT user_id FROM sessions WHERE token_hash = $1)',
      [(await import('../src/modules/auth/security.js')).hashSessionToken(driverCookie.split('=')[1])],
    );
    expect(bullet.rows).toEqual([{ name: 'Bullet', capacity_seats: 3, is_online: false }]);
    const areas = await request(app).get('/api/v1/areas');
    expect(areas.status).toBe(200);
    expect(areas.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'banani', name: 'Banani' }),
      expect.objectContaining({ code: 'gulshan-1', name: 'Gulshan 1' }),
    ]));
    expect(areas.body.data).toHaveLength(8);
    const nusrat = await create(nusratCookie);
    const rafiq = await create(rafiqCookie, banani, gulshan);
    expect(nusrat.status).toBe(201);
    expect(rafiq.status).toBe(201);
    expect(nusrat.body.data).toMatchObject({ status: 'REQUESTED', estimatedFarePoysha: 13000,
      paymentMethod: 'CASH', pricingVersion: 1 });
    expect(JSON.stringify(nusrat.body)).not.toMatch(/password|token_hash|session|passenger_user_id/i);
    expect(rafiq.body.data).toMatchObject({ status: 'REQUESTED', estimatedFarePoysha: 17000 });
    createdIds.push(nusrat.body.data.id, rafiq.body.data.id);
    const saved = await database.query<{ status: string; estimated_fare_poysha: number }>(
      'SELECT status, estimated_fare_poysha FROM ride_requests WHERE id = $1', [createdIds[0]],
    );
    expect(saved.rows[0]).toMatchObject({ status: 'REQUESTED', estimated_fare_poysha: 13000 });
    const own = await request(app).get(`/api/v1/ride-requests/${createdIds[0]}`).set('Cookie', nusratCookie);
    expect(own.body.data.events).toMatchObject([{ fromState: null, toState: 'REQUESTED',
      reason: 'PASSENGER_REQUEST' }]);
    expect((await request(app).get('/api/v1/ride-requests').set('Cookie', nusratCookie)).body.data)
      .toEqual([expect.objectContaining({ id: createdIds[0] })]);
  });

  it('rejects invalid areas, routes, counts, IDs, forged origins and wrong roles', async () => {
    expect((await create(nusratCookie, randomUUID(), mohakhali)).status).toBe(400);
    expect((await create(nusratCookie, banani, banani)).body.error.code).toBe('INVALID_INPUT');
    expect((await create(nusratCookie, dhanmondi, mohakhali)).body.error.code).toBe('UNSUPPORTED_ROUTE');
    for (const seats of [0, 4, 1.5, '2']) expect((await create(nusratCookie, banani, mohakhali, seats as number)).status).toBe(400);
    expect((await create(nusratCookie, 'malformed')).status).toBe(400);
    expect((await request(app).get('/api/v1/ride-requests/invalid').set('Cookie', nusratCookie)).status).toBe(400);
    expect((await request(app).get('/api/v1/ride-requests')).status).toBe(401);
    expect((await create(driverCookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/ride-requests').set('Cookie', driverCookie)).status).toBe(403);
    expect((await request(app).post('/api/v1/ride-requests').set('Cookie', nusratCookie)
      .send({ pickupAreaId: banani, destinationAreaId: mohakhali, seats: 1 })).status).toBe(403);
    expect((await request(app).post('/api/v1/ride-requests').set('Origin', origin)
      .set('Content-Type', 'text/plain').set('Cookie', nusratCookie).send('x')).status).toBe(415);
    expect((await create(nusratCookie)).body.error.code).toBe('ACTIVE_REQUEST_EXISTS');
  });

  it('enforces one active request even under concurrent creates and refuses later-state cancellation', async () => {
    const attempts = await Promise.all([create(shirinCookie), create(shirinCookie)]);
    expect(attempts.map((result) => result.status).sort()).toEqual([201, 409]);
    const id = attempts.find((result) => result.status === 201)!.body.data.id as string;
    const events = await database.query<{ count: string }>(
      'SELECT count(*) FROM ride_events WHERE ride_request_id = $1', [id],
    );
    expect(Number(events.rows[0].count)).toBe(1);
    // Simulate a later phase's state; Phase 3 must not accidentally permit cancelling it.
    await database.query("UPDATE ride_requests SET status = 'STARTED' WHERE id = $1", [id]);
    const blocked = await request(app).post(`/api/v1/ride-requests/${id}/cancel`)
      .set('Origin', origin).set('Cookie', shirinCookie).send({});
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('INVALID_TRANSITION');
  });

  it('hides other riders and atomically cancels the owner request once', async () => {
    const id = createdIds[0];
    expect((await request(app).get(`/api/v1/ride-requests/${id}`).set('Cookie', rafiqCookie)).status).toBe(404);
    const forbidden = await request(app).post(`/api/v1/ride-requests/${id}/cancel`)
      .set('Origin', origin).set('Cookie', rafiqCookie).send({});
    expect(forbidden.status).toBe(404);
    const cancelled = await request(app).post(`/api/v1/ride-requests/${id}/cancel`)
      .set('Origin', origin).set('Cookie', nusratCookie).send({});
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', estimatedFarePoysha: 13000 });
    const repeated = await request(app).post(`/api/v1/ride-requests/${id}/cancel`)
      .set('Origin', origin).set('Cookie', nusratCookie).send({});
    expect(repeated.status).toBe(409);
    expect(repeated.body.error.code).toBe('INVALID_TRANSITION');
    const history = await request(app).get('/api/v1/ride-requests?scope=history').set('Cookie', nusratCookie);
    expect(history.body.data).toEqual([expect.objectContaining({ id, status: 'CANCELLED' })]);
    const detail = await request(app).get(`/api/v1/ride-requests/${id}`).set('Cookie', nusratCookie);
    expect(detail.body.data.events.map((event: { toState: string }) => event.toState))
      .toEqual(['REQUESTED', 'CANCELLED']);
    const persisted = await database.query<{ count: string }>(
      'SELECT count(*) FROM ride_events WHERE ride_request_id = $1', [id],
    );
    expect(Number(persisted.rows[0].count)).toBe(2);
    const next = await create(nusratCookie, banani, mohakhali, 2);
    expect(next.body.data).toMatchObject({ status: 'REQUESTED', estimatedFarePoysha: 26000 });
  });
});
