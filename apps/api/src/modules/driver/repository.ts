import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PostgresMatchingRepository } from '../matching/repository.js';
import type { RideRow } from '../rides/repository.js';
import { RideFailure } from '../rides/service.js';

type Vehicle = { id: string; driver_user_id: string; name: string; capacity_seats: number; is_online: boolean };
type Trip = {
  id: string; vehicle_id: string; pickup_area_id: string; status: string;
  created_at: Date; accepted_at: Date | null; arrived_at: Date | null;
  started_at: Date | null; completed_at: Date | null; cancelled_at: Date | null;
};
type Member = RideRow & { name: string; released_at: Date | null; final_fare_poysha: number | null };

const transitions = {
  accept: { from: 'OPEN', to: 'ACCEPTED', rideFrom: 'MATCHED', rideTo: 'ACCEPTED', column: 'accepted_at' },
  arrive: { from: 'ACCEPTED', to: 'ARRIVED', rideFrom: 'ACCEPTED', rideTo: 'DRIVER_ARRIVED', column: 'arrived_at' },
  start: { from: 'ARRIVED', to: 'IN_PROGRESS', rideFrom: 'DRIVER_ARRIVED', rideTo: 'STARTED', column: 'started_at' },
  complete: { from: 'IN_PROGRESS', to: 'COMPLETED', rideFrom: 'STARTED', rideTo: 'COMPLETED', column: 'completed_at' },
} as const;

export class PostgresDriverRepository {
  constructor(private readonly db: Pool) {}

  async vehicle(driverId: string) {
    const result = await this.db.query<Vehicle>(
      'SELECT * FROM vehicles WHERE driver_user_id = $1', [driverId],
    );
    if (!result.rows[0]) throw new RideFailure(404, 'NOT_FOUND', 'Vehicle not found');
    return this.publicVehicle(result.rows[0]);
  }

  private publicVehicle(row: Vehicle) {
    return { id: row.id, name: row.name, capacitySeats: row.capacity_seats, isOnline: row.is_online };
  }

  async availability(driverId: string, online: boolean) {
    const client = await this.db.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const vehicle = (await client.query<Vehicle>(
        'SELECT * FROM vehicles WHERE driver_user_id = $1 FOR UPDATE', [driverId],
      )).rows[0];
      if (!vehicle) { await client.query('ROLLBACK'); throw new RideFailure(404, 'NOT_FOUND', 'Vehicle not found'); }
      if (!online) {
        const busy = await client.query(
          "SELECT 1 FROM pools WHERE vehicle_id = $1 AND status NOT IN ('COMPLETED', 'CANCELLED') FOR UPDATE",
          [vehicle.id],
        );
        if (busy.rowCount) {
          await client.query('ROLLBACK');
          throw new RideFailure(409, 'VEHICLE_BUSY', 'Finish or cancel the active pool first');
        }
      }
      const updated = (await client.query<Vehicle>(
        'UPDATE vehicles SET is_online = $2, updated_at = clock_timestamp() WHERE id = $1 RETURNING *',
        [vehicle.id, online],
      )).rows[0];
      await client.query('COMMIT');
      if (online) await new PostgresMatchingRepository(this.db).retryWaiting();
      return this.publicVehicle(updated);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }

  async list(driverId: string, scope: 'open' | 'active' | 'history', limit: number, offset: number) {
    const clause = scope === 'open' ? "p.status = 'OPEN'" : scope === 'active'
      ? "p.status NOT IN ('COMPLETED', 'CANCELLED')" : "p.status IN ('COMPLETED', 'CANCELLED')";
    const rows = (await this.db.query<Trip>(
      `SELECT p.* FROM pools p JOIN vehicles v ON v.id = p.vehicle_id
       WHERE v.driver_user_id = $1 AND ${clause}
       ORDER BY p.created_at DESC, p.id DESC LIMIT $2 OFFSET $3`,
      [driverId, limit, offset],
    )).rows;
    return Promise.all(rows.map((row) => this.detail(driverId, row.id)));
  }

  async detail(driverId: string, poolId: string) {
    const trip = (await this.db.query<Trip>(
      'SELECT p.* FROM pools p JOIN vehicles v ON v.id = p.vehicle_id WHERE v.driver_user_id = $1 AND p.id = $2',
      [driverId, poolId],
    )).rows[0];
    if (!trip) throw new RideFailure(404, 'NOT_FOUND', 'Pool not found');
    const members = (await this.db.query<Member>(
      `SELECT r.*, u.name, m.released_at, f.total_poysha AS final_fare_poysha
       FROM pool_memberships m JOIN ride_requests r ON r.id = m.ride_request_id
       JOIN users u ON u.id = r.passenger_user_id
       LEFT JOIN fare_snapshots f ON f.ride_request_id = r.id
       WHERE m.pool_id = $1 ORDER BY m.joined_at, r.id`, [trip.id],
    )).rows;
    const events = (await this.db.query(
      'SELECT id, from_state AS "fromState", to_state AS "toState", reason, occurred_at AS "occurredAt" FROM ride_events WHERE pool_id = $1 ORDER BY occurred_at, id',
      [trip.id],
    )).rows;
    return {
      id: trip.id, vehicleId: trip.vehicle_id, pickupAreaId: trip.pickup_area_id,
      status: trip.status, createdAt: trip.created_at, acceptedAt: trip.accepted_at,
      arrivedAt: trip.arrived_at, startedAt: trip.started_at,
      completedAt: trip.completed_at, cancelledAt: trip.cancelled_at,
      members: members.map((m) => ({
        rideRequestId: m.id, passengerName: m.name, pickupAreaId: m.pickup_area_id,
        destinationAreaId: m.destination_area_id, seats: m.seats_requested,
        status: m.status, estimatedFarePoysha: m.estimated_fare_poysha,
        finalFarePoysha: m.final_fare_poysha, releasedAt: m.released_at,
      })),
      events,
    };
  }

  async transition(driverId: string, poolId: string, action: keyof typeof transitions) {
    const rule = transitions[action];
    const client = await this.db.connect();
    let committed = false;
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      const vehicle = (await client.query<Vehicle>(
        'SELECT * FROM vehicles WHERE driver_user_id = $1 FOR UPDATE', [driverId],
      )).rows[0];
      if (!vehicle) throw new RideFailure(404, 'NOT_FOUND', 'Pool not found');
      const trip = (await client.query<Trip>(
        'SELECT * FROM pools WHERE id = $1 AND vehicle_id = $2 FOR UPDATE', [poolId, vehicle.id],
      )).rows[0];
      if (!trip) throw new RideFailure(404, 'NOT_FOUND', 'Pool not found');
      if (trip.status !== rule.from) throw new RideFailure(409, 'INVALID_TRANSITION', 'Pool is not in the required state');
      // The vehicle and pool locks serialize allocation, cancellation and driver actions.
      const members = (await client.query<RideRow>(
        `SELECT r.* FROM ride_requests r JOIN pool_memberships m ON m.ride_request_id = r.id
         WHERE m.pool_id = $1 AND m.released_at IS NULL ORDER BY r.id FOR UPDATE OF r`,
        [poolId],
      )).rows;
      const total = members.reduce((sum, r) => sum + r.seats_requested, 0);
      if (!members.length || total > vehicle.capacity_seats ||
        members.some((r) => r.status !== rule.rideFrom)) {
        throw new RideFailure(409, 'INVALID_TRANSITION', 'Pool membership has changed');
      }
      if (action === 'accept') {
        for (const ride of members) {
          const fare = (await client.query<{
            base_per_seat_poysha: number; zone_charge_poysha: number;
          }>(
            `SELECT base_per_seat_poysha, zone_charge_poysha FROM route_fares
             WHERE origin_area_id = $1 AND destination_area_id = $2 AND pricing_version = $3`,
            [ride.pickup_area_id, ride.destination_area_id, ride.pricing_version],
          )).rows[0];
          if (!fare) throw new RideFailure(409, 'INVALID_TRANSITION', 'Tariff unavailable');
          const discount = members.length >= 2
            ? Math.floor((fare.zone_charge_poysha * 20 + 50) / 100) : 0;
          const final = ride.seats_requested *
            (fare.base_per_seat_poysha + fare.zone_charge_poysha - discount);
          if (!Number.isSafeInteger(final) || final > 2147483647) {
            throw new RideFailure(409, 'INVALID_TRANSITION', 'Fare out of range');
          }
          await client.query(
            `INSERT INTO fare_snapshots (id, ride_request_id, pricing_version, seat_count,
               base_per_seat_poysha, zone_per_seat_poysha, discount_per_seat_poysha, total_poysha)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [randomUUID(), ride.id, ride.pricing_version, ride.seats_requested,
              fare.base_per_seat_poysha, fare.zone_charge_poysha, discount, final],
          );
        }
      }
      for (const ride of members) {
        await client.query('UPDATE ride_requests SET status = $2, updated_at = clock_timestamp() WHERE id = $1',
          [ride.id, rule.rideTo]);
        await client.query(
          `INSERT INTO ride_events (id, ride_request_id, actor_user_id, from_state, to_state, reason, occurred_at)
           VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
          [randomUUID(), ride.id, driverId, rule.rideFrom, rule.rideTo, `DRIVER_${action.toUpperCase()}`],
        );
      }
      // Column names and target states come only from the fixed transition table.
      await client.query(
        `UPDATE pools SET status = $2, ${rule.column} = clock_timestamp(),
         updated_at = clock_timestamp() WHERE id = $1`, [poolId, rule.to],
      );
      await client.query(
        `INSERT INTO ride_events (id, entity_type, pool_id, actor_user_id, from_state, to_state, reason, occurred_at)
         VALUES ($1, 'POOL', $2, $3, $4, $5, $6, clock_timestamp())`,
        [randomUUID(), poolId, driverId, rule.from, rule.to, `DRIVER_${action.toUpperCase()}`],
      );
      await client.query('COMMIT');
      committed = true;
    } catch (error) {
      if (!committed) await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
    if (action === 'complete' && (await this.vehicle(driverId)).isOnline) {
      await new PostgresMatchingRepository(this.db).retryWaiting();
    }
    return this.detail(driverId, poolId);
  }
}
