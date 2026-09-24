import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import argon2 from 'argon2';
import { Pool } from 'pg';

const enabled = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL === process.env.DATABASE_URL);
const origin = 'http://localhost:3000';
const api = '/api/v1/ride-requests';

describe.skipIf(!enabled)('pooling with PostgreSQL', () => {
  let db: Pool;
  let app: ReturnType<typeof import('../src/app.js').createApp>;
  let vehicleId: string;
  let banani: string;
  let mohakhali: string;
  let gulshan: string;
  let nusrat: string;
  let rafiq: string;
  let shirin: string;
  let fourth: string;

  async function register(name: string): Promise<string> {
    const response = await request(app).post('/api/v1/auth/register').set('Origin', origin).send({
      name, email: `${name.toLowerCase()}-${randomUUID()}@example.com`, password: randomBytes(24).toString('base64url'),
    });
    expect(response.status).toBe(201);
    return response.headers['set-cookie'][0].split(';')[0];
  }
  function create(cookie: string, destination = mohakhali, seats = 1, pickup = banani) {
    return request(app).post(api).set('Origin', origin).set('Cookie', cookie)
      .send({ pickupAreaId: pickup, destinationAreaId: destination, seats });
  }
  function cancel(cookie: string, id: string) {
    return request(app).post(`${api}/${id}/cancel`).set('Origin', origin).set('Cookie', cookie).send({});
  }
  async function online(value: boolean) {
    // Test fixture: the driver availability endpoint belongs to Phase 5.
    await db.query('UPDATE vehicles SET is_online = $1 WHERE id = $2', [value, vehicleId]);
  }
  async function pool() {
    const result = await db.query<{ id: string; status: string; seats: string; members: string }>(
      `SELECT p.id, p.status, coalesce(sum(r.seats_requested) FILTER (WHERE m.released_at IS NULL), 0)::text AS seats,
       count(m.id) FILTER (WHERE m.released_at IS NULL)::text AS members
       FROM pools p LEFT JOIN pool_memberships m ON m.pool_id = p.id
       LEFT JOIN ride_requests r ON r.id = m.ride_request_id WHERE p.vehicle_id = $1
       GROUP BY p.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1`, [vehicleId],
    );
    return result.rows[0];
  }
  async function events(id: string) {
    const result = await db.query<{ from_state: string | null; to_state: string }>(
      'SELECT from_state, to_state FROM ride_events WHERE ride_request_id = $1 ORDER BY occurred_at, id', [id],
    );
    return result.rows;
  }

  beforeAll(async () => {
    db = (await import('../src/db/pool.js')).pool;
    await (await import('../src/db/migrate.js')).migrate();
    app = (await import('../src/app.js')).createApp(db, { allowedOrigins: [origin] });
    const driverEmail = `jashim-${randomUUID()}@example.com`;
    const driverId = randomUUID();
    await db.query(`INSERT INTO users (id, name, normalized_email, password_hash, role)
      VALUES ($1, 'Jashim', $2, $3, 'DRIVER')`,
    [driverId, driverEmail, await argon2.hash(randomBytes(24).toString('base64url'))]);
    await (await import('../src/db/seed.js')).seedRideDomain(driverEmail);
    vehicleId = (await db.query<{ id: string }>(
      'SELECT id FROM vehicles WHERE driver_user_id = $1', [driverId],
    )).rows[0].id;
    const areas = (await db.query<{ id: string; code: string }>('SELECT id, code FROM areas')).rows;
    banani = areas.find((x) => x.code === 'banani')!.id;
    mohakhali = areas.find((x) => x.code === 'mohakhali')!.id;
    gulshan = areas.find((x) => x.code === 'gulshan-1')!.id;
    nusrat = await register('Nusrat');
    rafiq = await register('Rafiq');
    shirin = await register('Shirin');
    fourth = await register('Fourth');
  });
  beforeEach(async () => {
    await online(false);
    const { hashSessionToken } = await import('../src/modules/auth/security.js');
    const hashes = [nusrat, rafiq, shirin, fourth].map((cookie) => hashSessionToken(cookie.split('=')[1]));
    await db.query(`DELETE FROM ride_events WHERE ride_request_id IN (
      SELECT r.id FROM ride_requests r WHERE r.passenger_user_id IN
      (SELECT user_id FROM sessions WHERE token_hash = ANY($1::text[])))
      OR pool_id IN (SELECT id FROM pools WHERE vehicle_id = $2)`, [hashes, vehicleId]);
    await db.query('DELETE FROM pool_memberships WHERE pool_id IN (SELECT id FROM pools WHERE vehicle_id = $1)', [vehicleId]);
    await db.query('DELETE FROM pools WHERE vehicle_id = $1', [vehicleId]);
    await db.query('DELETE FROM ride_requests WHERE passenger_user_id IN (SELECT user_id FROM sessions WHERE token_hash = ANY($1::text[]))', [hashes]);
  });
  afterAll(async () => { if (db) await db.end(); });

  it('matches compatible Nusrat and Rafiq, then fills the third seat without a discount snapshot', async () => {
    await online(true);
    const a = await create(nusrat);
    const b = await create(rafiq, gulshan);
    const c = await create(shirin);
    expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
    expect([a.body.data.status, b.body.data.status, c.body.data.status]).toEqual(['MATCHED', 'MATCHED', 'MATCHED']);
    expect([a.body.data.estimatedFarePoysha, b.body.data.estimatedFarePoysha]).toEqual([13000, 17000]);
    expect(await pool()).toMatchObject({ status: 'OPEN', seats: '3', members: '3' });
    expect((await db.query('SELECT count(*)::int AS n FROM pools WHERE vehicle_id = $1', [vehicleId])).rows[0].n).toBe(1);
    expect((await events(b.body.data.id)).map((x) => x.to_state)).toEqual(['REQUESTED', 'MATCHED']);
    expect((await db.query("SELECT to_state FROM ride_events WHERE pool_id = $1", [(await pool()).id])).rows)
      .toMatchObject([{ to_state: 'OPEN' }]);
    const fourthRide = await create(fourth);
    expect(fourthRide.body.data.status).toBe('REQUESTED');
    expect(await pool()).toMatchObject({ seats: '3', members: '3' });
    expect((await events(fourthRide.body.data.id)).map((x) => x.to_state)).toEqual(['REQUESTED']);
    expect((await db.query("SELECT to_regclass('fare_snapshots') AS name")).rows[0].name).toBeNull();
  });

  it('leaves unsupported routes rejected, offline rides waiting, and preserves ownership', async () => {
    const offline = await create(nusrat);
    expect(offline.body.data.status).toBe('REQUESTED');
    expect((await pool())).toBeUndefined();
    expect((await create(rafiq, banani)).status).toBe(400);
    await online(true);
    const matched = await create(rafiq, gulshan);
    expect(matched.body.data.status).toBe('MATCHED');
    const id = matched.body.data.id as string;
    expect((await request(app).get(`${api}/${id}`).set('Cookie', nusrat)).status).toBe(404);
    expect((await cancel(nusrat, id)).status).toBe(404);
    expect((await request(app).get(api)).status).toBe(401);
    expect((await db.query('SELECT status FROM ride_requests WHERE id = $1', [id])).rows[0].status).toBe('MATCHED');
    // The approved rule retries waiting rides on availability changes (Phase 5), not on another creation.
  });

  it('keeps an incompatible pickup waiting while Bullet has a different OPEN pool', async () => {
    const dhanmondi = (await db.query<{ id: string }>('SELECT id FROM areas WHERE code = $1', ['dhanmondi'])).rows[0].id;
    await db.query(`INSERT INTO pools (id, vehicle_id, pickup_area_id, status)
      VALUES ($1, $2, $3, 'OPEN')`, [randomUUID(), vehicleId, dhanmondi]);
    await online(true);
    const result = await create(nusrat);
    expect(result.status).toBe(201);
    expect(result.body.data.status).toBe('REQUESTED');
    expect((await pool())).toMatchObject({ status: 'OPEN', seats: '0' });
    expect((await events(result.body.data.id)).map((x) => x.to_state)).toEqual(['REQUESTED']);
  });

  it('releases a MATCHED seat and synchronously retries a waiting request', async () => {
    await online(true);
    const a = await create(nusrat);
    const b = await create(rafiq, gulshan);
    const c = await create(shirin);
    const waiting = await create(fourth);
    expect(waiting.body.data.status).toBe('REQUESTED');
    const result = await cancel(nusrat, a.body.data.id);
    expect(result.status).toBe(200);
    expect(result.body.data.status).toBe('CANCELLED');
    expect((await cancel(nusrat, a.body.data.id)).body.error.code).toBe('INVALID_TRANSITION');
    expect((await pool())).toMatchObject({ status: 'OPEN', seats: '3', members: '3' });
    expect((await db.query('SELECT status FROM ride_requests WHERE id = $1', [waiting.body.data.id])).rows[0].status)
      .toBe('MATCHED');
    const released = await db.query('SELECT released_at FROM pool_memberships WHERE ride_request_id = $1', [a.body.data.id]);
    expect(released.rows[0].released_at).not.toBeNull();
    expect((await events(a.body.data.id)).map((x) => x.to_state)).toEqual(['REQUESTED', 'MATCHED', 'CANCELLED']);
    expect((await events(b.body.data.id)).map((x) => x.to_state)).toEqual(['REQUESTED', 'MATCHED']);
    expect((await events(c.body.data.id)).map((x) => x.to_state)).toEqual(['REQUESTED', 'MATCHED']);
  });

  it('cancels the OPEN pool atomically when the last member leaves', async () => {
    await online(true);
    const a = await create(nusrat);
    const firstPool = await pool();
    expect((await cancel(nusrat, a.body.data.id)).status).toBe(200);
    expect((await pool())).toMatchObject({ id: firstPool.id, status: 'CANCELLED', seats: '0' });
    expect((await db.query('SELECT to_state FROM ride_events WHERE pool_id = $1 ORDER BY occurred_at, id',
      [firstPool.id])).rows.map((x) => x.to_state)).toEqual(['OPEN', 'CANCELLED']);
    const newRide = await create(rafiq, gulshan);
    expect(newRide.body.data.status).toBe('MATCHED');
    expect((await pool()).id).not.toBe(firstPool.id);
  });

  it('serializes two concurrent last-seat claims behind a locked vehicle', async () => {
    await online(true);
    const a = await create(nusrat);
    const b = await create(rafiq, gulshan);
    expect([a.body.data.status, b.body.data.status]).toEqual(['MATCHED', 'MATCHED']);
    await online(false);
    const c = await create(shirin);
    const d = await create(fourth);
    expect([c.body.data.status, d.body.data.status]).toEqual(['REQUESTED', 'REQUESTED']);
    await online(true);
    const blocker = await db.connect();
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [vehicleId]);
    const matcher = new (await import('../src/modules/matching/repository.js')).PostgresMatchingRepository(db);
    const claims = [matcher.allocate(c.body.data.id), matcher.allocate(d.body.data.id)];
    try {
      // Observe both independent connections waiting on the vehicle lock before releasing it.
      let blocked = 0;
      for (let n = 0; n < 100; n++) {
        const result = await db.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE pid <> pg_backend_pid() AND wait_event_type = 'Lock'
             AND query LIKE 'SELECT capacity_seats, is_online FROM vehicles WHERE id = $1 FOR UPDATE%'`,
        );
        blocked = result.rows[0].n;
        if (blocked >= 2) break;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      expect(blocked).toBeGreaterThanOrEqual(2);
    } finally {
      await blocker.query('COMMIT');
      blocker.release();
    }
    await Promise.all(claims);
    const rows = (await db.query<{ id: string; status: string }>(
      'SELECT id, status FROM ride_requests WHERE id = ANY($1::uuid[]) ORDER BY id',
      [[c.body.data.id, d.body.data.id]],
    )).rows;
    expect(rows.map((x) => x.status).sort()).toEqual(['MATCHED', 'REQUESTED']);
    expect(await pool()).toMatchObject({ seats: '3', members: '3', status: 'OPEN' });
    for (const row of rows) expect((await events(row.id)).map((x) => x.to_state))
      .toEqual(row.status === 'MATCHED' ? ['REQUESTED', 'MATCHED'] : ['REQUESTED']);
    expect((await db.query('SELECT count(*)::int AS n FROM pool_memberships WHERE ride_request_id = ANY($1::uuid[])',
      [[c.body.data.id, d.body.data.id]])).rows[0].n).toBe(1);
  });
});
