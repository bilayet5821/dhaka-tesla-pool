import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import argon2 from 'argon2';
import { Pool } from 'pg';
import request from 'supertest';
import { isolateDatabaseSuite } from './database-isolation.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL &&
  process.env.TEST_DATABASE_URL === process.env.DATABASE_URL);
const origin = 'http://localhost:3000';

describe.skipIf(!enabled)('driver lifecycle against PostgreSQL', () => {
  let db: Pool;
  let app: ReturnType<typeof import('../src/app.js').createApp>;
  let driver: string;
  let vehicleId: string;
  let banani: string;
  let mohakhali: string;
  let gulshan: string;
  let releaseDatabase: (() => Promise<void>) | undefined;

  async function passenger(name: string) {
    const res = await request(app).post('/api/v1/auth/register').set('Origin', origin).send({
      name, email: `${name.toLowerCase()}-${randomUUID()}@example.com`,
      password: randomBytes(24).toString('base64url'),
    });
    expect(res.status).toBe(201);
    return res.headers['set-cookie'][0].split(';')[0] as string;
  }
  function create(cookie: string, destination = mohakhali, seats = 1) {
    return request(app).post('/api/v1/ride-requests').set('Origin', origin).set('Cookie', cookie)
      .send({ pickupAreaId: banani, destinationAreaId: destination, seats });
  }
  function action(id: string, step: string, cookie = driver) {
    return request(app).post(`/api/v1/driver/pools/${id}/${step}`)
      .set('Origin', origin).set('Cookie', cookie).send({});
  }
  function availability(isOnline: boolean, cookie = driver) {
    return request(app).patch('/api/v1/driver/vehicle/availability')
      .set('Origin', origin).set('Cookie', cookie).send({ isOnline });
  }
  function cancel(id: string, cookie: string) {
    return request(app).post(`/api/v1/ride-requests/${id}/cancel`)
      .set('Origin', origin).set('Cookie', cookie).send({});
  }

  beforeAll(async () => {
    releaseDatabase = await isolateDatabaseSuite();
    db = (await import('../src/db/pool.js')).pool;
    await (await import('../src/db/migrate.js')).migrate();
    app = (await import('../src/app.js')).createApp(db, { allowedOrigins: [origin] });
    const { newSessionToken, hashSessionToken, SESSION_COOKIE } =
      await import('../src/modules/auth/security.js');
    const driverId = randomUUID();
    const email = `jashim-${randomUUID()}@example.com`;
    await db.query(`INSERT INTO users (id, name, normalized_email, password_hash, role)
      VALUES ($1, 'Jashim', $2, $3, 'DRIVER')`,
    [driverId, email, await argon2.hash(randomBytes(24).toString('base64url'))]);
    const token = newSessionToken();
    driver = `${SESSION_COOKIE}=${token}`;
    await db.query(`INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES ($1, $2, $3, now() + interval '1 day')`,
    [randomUUID(), driverId, hashSessionToken(token)]);
    await (await import('../src/db/seed.js')).seedRideDomain(email);
    vehicleId = (await db.query<{ id: string }>(
      'SELECT id FROM vehicles WHERE driver_user_id = $1', [driverId],
    )).rows[0].id;
    const areas = (await db.query<{ id: string; code: string }>('SELECT id, code FROM areas')).rows;
    banani = areas.find((a) => a.code === 'banani')!.id;
    mohakhali = areas.find((a) => a.code === 'mohakhali')!.id;
    gulshan = areas.find((a) => a.code === 'gulshan-1')!.id;
  });
  afterAll(async () => {
    try { if (db) await db.end(); } finally { await releaseDatabase?.(); }
  });

  it('requires a driver session, valid origin and JSON, and controls only the assigned vehicle', async () => {
    const rider = await passenger('Observer');
    expect((await request(app).get('/api/v1/driver/vehicle')).status).toBe(401);
    expect((await request(app).get('/api/v1/driver/vehicle').set('Cookie', rider)).status).toBe(403);
    expect((await availability(true, rider)).status).toBe(403);
    expect((await request(app).patch('/api/v1/driver/vehicle/availability')
      .set('Cookie', driver).send({ isOnline: true })).status).toBe(403);
    expect((await request(app).patch('/api/v1/driver/vehicle/availability')
      .set('Origin', origin).set('Cookie', driver).set('Content-Type', 'text/plain')
      .send('true')).status).toBe(415);
    expect((await request(app).get('/api/v1/driver/vehicle').set('Cookie', driver)).body.data)
      .toMatchObject({ id: vehicleId, name: 'Bullet', capacitySeats: 3, isOnline: false });
  });

  it('prices accepted members, freezes membership, advances the trip and retries waiting rides', async () => {
    const nusrat = await passenger('Nusrat');
    const rafiq = await passenger('Rafiq');
    const shirin = await passenger('Shirin');
    const fourth = await passenger('Fourth');
    const a = await create(nusrat);
    const b = await create(rafiq, gulshan);
    const c = await create(shirin);
    expect([a.body.data.status, b.body.data.status, c.body.data.status])
      .toEqual(['REQUESTED', 'REQUESTED', 'REQUESTED']);
    expect((await availability(true)).status).toBe(200);
    const current = await request(app).get('/api/v1/driver/pools?scope=open').set('Cookie', driver);
    expect(current.body.data).toHaveLength(1);
    const pool = current.body.data[0];
    expect(pool.status).toBe('OPEN');
    expect(pool.members.map((m: { passengerName: string }) => m.passengerName).sort())
      .toEqual(['Nusrat', 'Rafiq', 'Shirin']);
    expect((await availability(false)).body.error.code).toBe('VEHICLE_BUSY');
    expect((await action(pool.id, 'accept', nusrat)).status).toBe(403);
    expect((await action(randomUUID(), 'accept')).status).toBe(404);
    const beforeInvalid = (await db.query('SELECT count(*)::int AS n FROM ride_events WHERE pool_id = $1',
      [pool.id])).rows[0].n;
    expect((await action(pool.id, 'arrive')).status).toBe(409);
    expect((await db.query('SELECT count(*)::int AS n FROM ride_events WHERE pool_id = $1',
      [pool.id])).rows[0].n).toBe(beforeInvalid);
    expect((await action(pool.id, 'accept')).status).toBe(200);
    expect((await action(pool.id, 'accept')).status).toBe(409);
    expect((await db.query('SELECT count(*)::int AS n FROM ride_events WHERE pool_id = $1',
      [pool.id])).rows[0].n).toBe(beforeInvalid + 1);
    const fares = await db.query<{ ride_request_id: string; total_poysha: number }>(
      'SELECT ride_request_id, total_poysha FROM fare_snapshots WHERE ride_request_id = ANY($1::uuid[])',
      [[a.body.data.id, b.body.data.id, c.body.data.id]],
    );
    expect(Object.fromEntries(fares.rows.map((f) => [f.ride_request_id, f.total_poysha])))
      .toMatchObject({ [a.body.data.id]: 11400, [b.body.data.id]: 14600, [c.body.data.id]: 11400 });
    const own = await request(app).get(`/api/v1/ride-requests/${a.body.data.id}`)
      .set('Cookie', nusrat);
    expect(own.body.data.fareSnapshot).toMatchObject({
      pricingVersion: 1, seatCount: 1, basePerSeatPoysha: 5000,
      zonePerSeatPoysha: 8000, discountPerSeatPoysha: 1600, totalPoysha: 11400,
    });
    expect((await request(app).get(`/api/v1/ride-requests/${b.body.data.id}`)
      .set('Cookie', rafiq)).body.data.fareSnapshot).toMatchObject({
      zonePerSeatPoysha: 12000, discountPerSeatPoysha: 2400, totalPoysha: 14600,
    });
    expect((await request(app).get(`/api/v1/ride-requests/${b.body.data.id}`)
      .set('Cookie', nusrat)).status).toBe(404);
    const waiting = await create(fourth);
    expect(waiting.body.data.status).toBe('REQUESTED');
    expect((await cancel(a.body.data.id, rafiq)).status).toBe(404);
    const cancelled = await cancel(a.body.data.id, nusrat);
    expect(cancelled.body.data).toMatchObject({
      status: 'CANCELLED', finalFarePoysha: 11400, cashDuePoysha: 0,
    });
    expect((await cancel(a.body.data.id, nusrat)).status).toBe(409);
    expect((await db.query('SELECT released_at FROM pool_memberships WHERE ride_request_id = $1',
      [a.body.data.id])).rows[0].released_at).not.toBeNull();
    expect((await db.query('SELECT status FROM ride_requests WHERE id = $1',
      [waiting.body.data.id])).rows[0].status).toBe('REQUESTED');
    expect((await action(pool.id, 'arrive')).status).toBe(200);
    expect((await db.query('SELECT status FROM ride_requests WHERE id = $1', [b.body.data.id]))
      .rows[0].status).toBe('DRIVER_ARRIVED');
    expect((await action(pool.id, 'start')).status).toBe(200);
    expect((await db.query('SELECT status FROM ride_requests WHERE id = $1', [b.body.data.id]))
      .rows[0].status).toBe('STARTED');
    expect((await cancel(b.body.data.id, rafiq)).status).toBe(409);
    expect((await action(pool.id, 'complete')).status).toBe(200);
    expect((await db.query('SELECT status FROM ride_requests WHERE id = $1',
      [waiting.body.data.id])).rows[0].status).toBe('MATCHED');
    expect((await request(app).get('/api/v1/driver/pools?scope=history')
      .set('Cookie', driver)).body.data).toEqual([
      expect.objectContaining({ id: pool.id, status: 'COMPLETED' }),
    ]);
    expect((await db.query('SELECT count(*)::int AS n FROM fare_snapshots')).rows[0].n).toBe(3);
    expect((await db.query('SELECT status FROM ride_requests WHERE id = $1', [b.body.data.id]))
      .rows[0].status).toBe('COMPLETED');
    expect((await db.query('SELECT to_state FROM ride_events WHERE pool_id = $1 ORDER BY occurred_at, id',
      [pool.id])).rows.map((e) => e.to_state))
      .toEqual(['OPEN', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED']);
    expect((await db.query('SELECT count(*)::int AS n FROM pool_memberships WHERE pool_id = $1 AND released_at IS NULL',
      [pool.id])).rows[0].n).toBe(2);
    const secondPool = (await request(app).get('/api/v1/driver/pools?scope=open')
      .set('Cookie', driver)).body.data[0];
    expect((await cancel(waiting.body.data.id, fourth)).status).toBe(200);
    expect((await db.query('SELECT status FROM pools WHERE id = $1', [secondPool.id]))
      .rows[0].status).toBe('CANCELLED');
    expect((await availability(false)).body.data.isOnline).toBe(false);
  });

  it('keeps one-seat standalone acceptance and immutable snapshots across final-member cancellation', async () => {
    const sole = await passenger('Solo');
    const ride = await create(sole, mohakhali, 2);
    expect(ride.body.data.status).toBe('REQUESTED');
    expect((await availability(true)).status).toBe(200);
    const pool = (await request(app).get('/api/v1/driver/pools?scope=open')
      .set('Cookie', driver)).body.data[0];
    expect((await action(pool.id, 'accept')).status).toBe(200);
    const snapshot = (await db.query<{ total_poysha: number }>(
      'SELECT total_poysha FROM fare_snapshots WHERE ride_request_id = $1', [ride.body.data.id],
    )).rows[0];
    expect(snapshot.total_poysha).toBe(26000);
    await expect(db.query('UPDATE fare_snapshots SET total_poysha = 1 WHERE ride_request_id = $1',
      [ride.body.data.id])).rejects.toThrow();
    expect((await action(pool.id, 'arrive')).status).toBe(200);
    expect((await cancel(ride.body.data.id, sole)).status).toBe(200);
    expect((await db.query('SELECT status FROM pools WHERE id = $1', [pool.id])).rows[0].status)
      .toBe('CANCELLED');
    expect((await db.query('SELECT total_poysha FROM fare_snapshots WHERE ride_request_id = $1',
      [ride.body.data.id])).rows[0].total_poysha).toBe(26000);
    expect((await action(pool.id, 'start')).status).toBe(409);
    expect((await request(app).get(`/api/v1/ride-requests/${ride.body.data.id}`)
      .set('Cookie', sole)).body.data).toMatchObject({
      finalFarePoysha: 26000, cashDuePoysha: 0,
    });
  });

  it('serializes acceptance against matching and denies another driver access to the pool', async () => {
    const first = await passenger('First');
    const second = await passenger('Second');
    const a = await create(first);
    const b = await create(second, gulshan);
    const poolId = (await request(app).get('/api/v1/driver/pools?scope=open')
      .set('Cookie', driver)).body.data[0].id as string;
    const otherDriver = randomUUID();
    const { newSessionToken, hashSessionToken, SESSION_COOKIE } =
      await import('../src/modules/auth/security.js');
    const token = newSessionToken();
    const otherCookie = `${SESSION_COOKIE}=${token}`;
    await db.query(`INSERT INTO users (id, name, normalized_email, password_hash, role)
      VALUES ($1, 'Other driver', $2, $3, 'DRIVER')`,
    [otherDriver, `other-${randomUUID()}@example.com`,
      await argon2.hash(randomBytes(24).toString('base64url'))]);
    await db.query(`INSERT INTO sessions (id, user_id, token_hash, expires_at)
      VALUES ($1, $2, $3, now() + interval '1 day')`,
    [randomUUID(), otherDriver, hashSessionToken(token)]);
    await db.query(`INSERT INTO vehicles (id, driver_user_id, name, capacity_seats)
      VALUES ($1, $2, 'Other vehicle', 3)`, [randomUUID(), otherDriver]);
    expect((await request(app).get(`/api/v1/driver/pools/${poolId}`)
      .set('Cookie', otherCookie)).status).toBe(404);
    expect((await action(poolId, 'accept', otherCookie)).status).toBe(404);
    expect((await availability(true, otherCookie)).body.data.name).toBe('Other vehicle');
    expect((await availability(false, otherCookie)).body.data.isOnline).toBe(false);
    expect((await db.query('SELECT is_online FROM vehicles WHERE id = $1',
      [vehicleId])).rows[0].is_online).toBe(true);

    const waitingId = randomUUID();
    await db.query(`INSERT INTO ride_requests (id, passenger_user_id, pickup_area_id,
      destination_area_id, seats_requested, estimated_fare_poysha, pricing_version)
      VALUES ($1, (SELECT passenger_user_id FROM ride_requests WHERE id = $2),
        $3, $4, 1, 13000, 1)`, [waitingId, a.body.data.id, banani, mohakhali])
      .then(() => { throw new Error('Active passenger constraint did not reject duplicate'); },
        (error: unknown) => { expect(error).toMatchObject({ code: '23505' }); });
    const third = await passenger('Third');
    const { hashSessionToken: hash } = await import('../src/modules/auth/security.js');
    const passengerId = (await db.query<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE token_hash = $1',
      [hash(third.split('=')[1])],
    )).rows[0].user_id;
    await db.query(`INSERT INTO ride_requests (id, passenger_user_id, pickup_area_id,
      destination_area_id, seats_requested, estimated_fare_poysha, pricing_version)
      VALUES ($1, $2, $3, $4, 1, 13000, 1)`,
    [waitingId, passengerId, banani, mohakhali]);
    await db.query(`INSERT INTO ride_events (id, ride_request_id, to_state, reason)
      VALUES ($1, $2, 'REQUESTED', 'PASSENGER_REQUEST')`, [randomUUID(), waitingId]);
    const blocker = await db.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [vehicleId]);
    const matching = new (await import('../src/modules/matching/repository.js'))
      .PostgresMatchingRepository(db);
    const acceptance = action(poolId, 'accept').then((result) => result);
    const allocation = matching.allocate(waitingId);
    try {
      let blocked = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        blocked = (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
            AND (query LIKE 'SELECT * FROM vehicles WHERE driver_user_id = $1 FOR UPDATE%'
              OR query LIKE 'SELECT capacity_seats, is_online FROM vehicles WHERE id = $1 FOR UPDATE%')`))
          .rows[0].n;
        if (blocked >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBeGreaterThanOrEqual(2);
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
    }
    const [accepted] = await Promise.all([acceptance, allocation]);
    expect(accepted.status).toBe(200);
    const candidate = (await db.query<{ status: string }>(
      'SELECT status FROM ride_requests WHERE id = $1', [waitingId],
    )).rows[0];
    expect(['REQUESTED', 'ACCEPTED']).toContain(candidate.status);
    const members = (await db.query<{ id: string; status: string; seats_requested: number }>(
      `SELECT r.id, r.status, r.seats_requested FROM pool_memberships m
       JOIN ride_requests r ON r.id = m.ride_request_id
       WHERE m.pool_id = $1 AND m.released_at IS NULL`, [poolId],
    )).rows;
    expect(members.reduce((sum, row) => sum + row.seats_requested, 0)).toBeLessThanOrEqual(3);
    expect(members.every((row) => row.status === 'ACCEPTED')).toBe(true);
    expect(members.map((row) => row.id)).toEqual(expect.arrayContaining([a.body.data.id, b.body.data.id]));
    expect((await db.query('SELECT count(*)::int AS n FROM fare_snapshots WHERE ride_request_id = ANY($1::uuid[])',
      [members.map((row) => row.id)])).rows[0].n).toBe(members.length);
    expect((await db.query('SELECT to_state FROM ride_events WHERE ride_request_id = $1 ORDER BY occurred_at, id',
      [waitingId])).rows.map((event) => event.to_state))
      .toEqual(candidate.status === 'REQUESTED' ? ['REQUESTED'] : ['REQUESTED', 'MATCHED', 'ACCEPTED']);
    expect((await action(poolId, 'accept')).status).toBe(409);
  });
});
