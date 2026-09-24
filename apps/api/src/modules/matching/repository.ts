import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { RideRow } from '../rides/repository.js';

type PoolRow = { id: string; pickup_area_id: string; status: string };

export class PostgresMatchingRepository {
  constructor(private readonly db: Pool) {}

  async allocate(requestId: string): Promise<void> {
    // Hints only: every condition is checked again under locks. Existing pools first.
    const candidates = await this.db.query<{ id: string }>(
      `SELECT v.id FROM vehicles v LEFT JOIN pools p ON p.vehicle_id = v.id
         AND p.status NOT IN ('COMPLETED', 'CANCELLED')
       WHERE v.is_online AND (p.id IS NULL OR p.status = 'OPEN')
       ORDER BY p.created_at ASC NULLS LAST, p.id ASC NULLS LAST, v.created_at, v.id`,
    );
    for (const candidate of candidates.rows) {
      const client = await this.db.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const vehicle = (await client.query<{ capacity_seats: number; is_online: boolean }>(
          'SELECT capacity_seats, is_online FROM vehicles WHERE id = $1 FOR UPDATE', [candidate.id],
        )).rows[0];
        if (!vehicle?.is_online) { await client.query('ROLLBACK'); continue; }
        let pool = (await client.query<PoolRow>(
          `SELECT id, pickup_area_id, status FROM pools WHERE vehicle_id = $1
           AND status NOT IN ('COMPLETED', 'CANCELLED') FOR UPDATE`, [candidate.id],
        )).rows[0];
        if (pool && pool.status !== 'OPEN') { await client.query('ROLLBACK'); continue; }
        // New pool is private to this transaction until commit; vehicle lock protects its creation.
        if (!pool) {
          pool = (await client.query<PoolRow>(
            `INSERT INTO pools (id, vehicle_id, pickup_area_id, status)
             SELECT $1, $2, pickup_area_id, 'OPEN' FROM ride_requests WHERE id = $3
             RETURNING id, pickup_area_id, status`, [randomUUID(), candidate.id, requestId],
          )).rows[0];
        }
        const ride = (await client.query<RideRow>(
          'SELECT * FROM ride_requests WHERE id = $1 FOR UPDATE', [requestId],
        )).rows[0];
        if (!ride || ride.status !== 'REQUESTED') { await client.query('ROLLBACK'); return; }
        const eligibility = await client.query(
          `SELECT 1 FROM users u JOIN route_fares rf ON rf.origin_area_id = $2
             AND rf.destination_area_id = $3 AND rf.pricing_version = $4
           JOIN areas a ON a.id = rf.origin_area_id
           JOIN areas d ON d.id = rf.destination_area_id
           WHERE u.id = $1 AND u.role = 'PASSENGER' AND a.code = 'banani'
             AND d.code IN ('mohakhali', 'gulshan-1')
             AND NOT EXISTS (SELECT 1 FROM pool_memberships WHERE ride_request_id = $5)
             AND NOT EXISTS (SELECT 1 FROM ride_requests WHERE passenger_user_id = $1
               AND id <> $5 AND status NOT IN ('COMPLETED', 'CANCELLED'))`,
          [ride.passenger_user_id, ride.pickup_area_id, ride.destination_area_id, ride.pricing_version, ride.id],
        );
        const members = (await client.query<{
          seats_requested: number; pickup_area_id: string; destination_area_id: string;
          destination_code: string; status: string;
        }>(`SELECT r.seats_requested, r.pickup_area_id, r.destination_area_id, d.code AS destination_code, r.status
            FROM pool_memberships m JOIN ride_requests r ON r.id = m.ride_request_id
            JOIN areas d ON d.id = r.destination_area_id
            WHERE m.pool_id = $1 AND m.released_at IS NULL`, [pool.id])).rows;
        const codes = (await client.query<{ code: string }>('SELECT code FROM areas WHERE id = $1',
          [ride.pickup_area_id])).rows;
        const compatible = pool.pickup_area_id === ride.pickup_area_id && members.every((member) =>
          member.status === 'MATCHED' && member.pickup_area_id === ride.pickup_area_id &&
          (member.destination_area_id === ride.destination_area_id ||
            (codes[0]?.code === 'banani' && ['mohakhali', 'gulshan-1'].includes(member.destination_code))));
        const reserved = members.reduce((total, member) => total + member.seats_requested, 0);
        if (!eligibility.rowCount || !compatible || reserved + ride.seats_requested > vehicle.capacity_seats) {
          await client.query('ROLLBACK'); continue;
        }
        // A newly created pool has no creation event yet. Existing pools retain theirs.
        await client.query(
          `INSERT INTO ride_events (id, entity_type, pool_id, to_state, reason)
           SELECT $1, 'POOL', $2, 'OPEN', 'SYSTEM_POOL_CREATED'
           WHERE NOT EXISTS (SELECT 1 FROM ride_events WHERE pool_id = $2)`, [randomUUID(), pool.id],
        );
        await client.query(
          'INSERT INTO pool_memberships (id, pool_id, ride_request_id) VALUES ($1, $2, $3)',
          [randomUUID(), pool.id, ride.id],
        );
        await client.query("UPDATE ride_requests SET status = 'MATCHED', updated_at = clock_timestamp() WHERE id = $1", [ride.id]);
        await client.query(
          `INSERT INTO ride_events (id, ride_request_id, from_state, to_state, reason, occurred_at)
           VALUES ($1, $2, 'REQUESTED', 'MATCHED', 'SYSTEM_MATCHED', clock_timestamp())`, [randomUUID(), ride.id],
        );
        await client.query('COMMIT');
        return;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
  }

  async retryWaiting(): Promise<void> {
    const waiting = await this.db.query<{ id: string }>(
      "SELECT id FROM ride_requests WHERE status = 'REQUESTED' ORDER BY created_at, id",
    );
    for (const ride of waiting.rows) await this.allocate(ride.id);
  }
}
