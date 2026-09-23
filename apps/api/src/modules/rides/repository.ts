import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

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
      return ride;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
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
    const client = await this.db.connect();
    try {
      await client.query('BEGIN');
      const selected = await client.query<RideRow>(
        'SELECT * FROM ride_requests WHERE id = $1 AND passenger_user_id = $2 FOR UPDATE',
        [id, passengerId],
      );
      const ride = selected.rows[0];
      if (!ride) {
        await client.query('ROLLBACK');
        return null;
      }
      // Phase 3 has no memberships. A later phase must use the vehicle -> pool -> request lock order.
      if (ride.status !== 'REQUESTED') {
        await client.query('ROLLBACK');
        return 'INVALID_TRANSITION';
      }
      const updated = await client.query<RideRow>(
        `UPDATE ride_requests SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
         WHERE id = $1 RETURNING *`, [id],
      );
      await client.query(
        `INSERT INTO ride_events (id, ride_request_id, actor_user_id, from_state, to_state, reason)
         VALUES ($1, $2, $3, 'REQUESTED', 'CANCELLED', 'PASSENGER_CANCELLED')`,
        [randomUUID(), id, passengerId],
      );
      await client.query('COMMIT');
      return updated.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
