import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PostgresMatchingRepository } from '../matching/repository.js';

export type RideRow = {
  id: string; passenger_user_id: string; pickup_area_id: string; destination_area_id: string;
  seats_requested: number; status: string; estimated_fare_poysha: number;
  pricing_version: number; payment_method: string; created_at: Date;
  updated_at: Date; cancelled_at: Date | null;
};
export type EventRow = {
  id: string; ride_request_id: string; actor_user_id: string | null;
  from_state: string | null; to_state: string; reason: string; occurred_at: Date;
};

export class PostgresRideRepository {
  constructor(private readonly db: Pool) {}

  async areas() {
    const result = await this.db.query<{ id: string; code: string; name: string }>(
      'SELECT id, code, name FROM areas ORDER BY name',
    );
    return result.rows;
  }

  async tariff(pickupId: string, destinationId: string) {
    const result = await this.db.query<{
      pricing_version: number; base_per_seat_poysha: number; zone_charge_poysha: number;
    }>(`SELECT pricing_version, base_per_seat_poysha, zone_charge_poysha
       FROM route_fares rf JOIN areas origin ON origin.id = rf.origin_area_id
       JOIN areas destination ON destination.id = rf.destination_area_id
       WHERE origin_area_id = $1 AND destination_area_id = $2
         AND origin.code = 'banani' AND destination.code IN ('mohakhali', 'gulshan-1')
       ORDER BY pricing_version DESC LIMIT 1`, [pickupId, destinationId]);
    return result.rows[0] ?? null;
  }

  async create(input: {
    passengerId: string; pickupId: string; destinationId: string; seats: number;
    estimatedFarePoysha: number; pricingVersion: number;
  }): Promise<RideRow> {
    const client = await this.db.connect();
    let committed = false;
    try {
      await client.query('BEGIN');
      const result = await client.query<RideRow>(
        `INSERT INTO ride_requests (id, passenger_user_id, pickup_area_id, destination_area_id,
           seats_requested, estimated_fare_poysha, pricing_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [randomUUID(), input.passengerId, input.pickupId, input.destinationId,
          input.seats, input.estimatedFarePoysha, input.pricingVersion],
      );
      const ride = result.rows[0];
      await client.query(
        `INSERT INTO ride_events (id, ride_request_id, actor_user_id, from_state, to_state, reason)
         VALUES ($1, $2, $3, NULL, 'REQUESTED', 'PASSENGER_REQUEST')`,
        [randomUUID(), ride.id, input.passengerId],
      );
      await client.query('COMMIT');
      committed = true;
      client.release();
      // Release the creation transaction before acquiring vehicle/pool/request locks.
      await new PostgresMatchingRepository(this.db).allocate(ride.id);
      return (await this.find(ride.id, input.passengerId))!;
    } catch (error) {
      if (!committed) await client.query('ROLLBACK');
      throw error;
    } finally {
      if (!committed) client.release();
    }
  }

  async list(passengerId: string, scope: 'active' | 'history', limit: number, offset: number) {
    const result = await this.db.query<RideRow>(
      `SELECT * FROM ride_requests WHERE passenger_user_id = $1
         AND status ${scope === 'active' ? 'NOT IN' : 'IN'} ('COMPLETED', 'CANCELLED')
       ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, [passengerId, limit, offset],
    );
    return result.rows;
  }

  async find(id: string, passengerId: string): Promise<RideRow | null> {
    const result = await this.db.query<RideRow>(
      'SELECT * FROM ride_requests WHERE id = $1 AND passenger_user_id = $2', [id, passengerId],
    );
    return result.rows[0] ?? null;
  }

  async events(id: string): Promise<EventRow[]> {
    const result = await this.db.query<EventRow>(
      'SELECT * FROM ride_events WHERE ride_request_id = $1 ORDER BY occurred_at, id', [id],
    );
    return result.rows;
  }

  async cancel(id: string, passengerId: string): Promise<RideRow | null | 'INVALID_TRANSITION'> {
    const result = await this.cancelTransaction(id, passengerId);
    if (result && result !== 'INVALID_TRANSITION') {
      await new PostgresMatchingRepository(this.db).retryWaiting();
    }
    return result;
  }

  private async cancelTransaction(id: string, passengerId: string): Promise<RideRow | null | 'INVALID_TRANSITION'> {
    // A REQUESTED lookup can race allocation. Restart with the new pool hint, never lock backwards.
    for (;;) {
      const client = await this.db.connect();
      try {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        const hint = (await client.query<{ pool_id: string; vehicle_id: string }>(
          `SELECT m.pool_id, p.vehicle_id FROM pool_memberships m
           JOIN pools p ON p.id = m.pool_id JOIN ride_requests r ON r.id = m.ride_request_id
           WHERE r.id = $1 AND r.passenger_user_id = $2 AND m.released_at IS NULL`, [id, passengerId],
        )).rows[0];
        let poolStatus: string | undefined;
        if (hint) {
          await client.query('SELECT id FROM vehicles WHERE id = $1 FOR UPDATE', [hint.vehicle_id]);
          poolStatus = (await client.query<{ status: string }>(
            'SELECT status FROM pools WHERE id = $1 FOR UPDATE', [hint.pool_id],
          )).rows[0]?.status;
        }
        const ride = (await client.query<RideRow>(
          'SELECT * FROM ride_requests WHERE id = $1 AND passenger_user_id = $2 FOR UPDATE',
          [id, passengerId],
        )).rows[0];
        if (!ride) { await client.query('ROLLBACK'); return null; }
        const membership = (await client.query<{ pool_id: string }>(
          'SELECT pool_id FROM pool_memberships WHERE ride_request_id = $1 AND released_at IS NULL', [id],
        )).rows[0];
        if (membership && membership.pool_id !== hint?.pool_id) {
          await client.query('ROLLBACK'); continue;
        }
        if (!((ride.status === 'REQUESTED' && !membership) ||
          (ride.status === 'MATCHED' && membership && poolStatus === 'OPEN'))) {
          await client.query('ROLLBACK'); return 'INVALID_TRANSITION';
        }
        const updated = await client.query<RideRow>(
          `UPDATE ride_requests SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
           updated_at = clock_timestamp() WHERE id = $1 RETURNING *`, [id],
        );
        await client.query(
          `INSERT INTO ride_events (id, ride_request_id, actor_user_id, from_state, to_state, reason, occurred_at)
           VALUES ($1, $2, $3, $4, 'CANCELLED', 'PASSENGER_CANCELLED', clock_timestamp())`,
          [randomUUID(), id, passengerId, ride.status],
        );
        if (membership) {
          await client.query('UPDATE pool_memberships SET released_at = clock_timestamp() WHERE ride_request_id = $1', [id]);
          const active = await client.query(
            'SELECT 1 FROM pool_memberships WHERE pool_id = $1 AND released_at IS NULL', [membership.pool_id],
          );
          if (!active.rowCount) {
            await client.query(
              `UPDATE pools SET status = 'CANCELLED', cancelled_at = clock_timestamp(),
               updated_at = clock_timestamp() WHERE id = $1`, [membership.pool_id],
            );
            await client.query(
              `INSERT INTO ride_events (id, entity_type, pool_id, from_state, to_state, reason, occurred_at)
               VALUES ($1, 'POOL', $2, 'OPEN', 'CANCELLED', 'FINAL_MEMBER_CANCELLED', clock_timestamp())`,
              [randomUUID(), membership.pool_id],
            );
          }
        }
        await client.query('COMMIT');
        return updated.rows[0];
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally { client.release(); }
    }
  }
}
