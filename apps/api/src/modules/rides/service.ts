import type { EventRow, PostgresRideRepository, RideRow } from './repository.js';

export class RideFailure extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
  }
}

export function publicRide(row: RideRow) {
  return {
    id: row.id, pickupAreaId: row.pickup_area_id, destinationAreaId: row.destination_area_id,
    seats: row.seats_requested, status: row.status,
    estimatedFarePoysha: row.estimated_fare_poysha, pricingVersion: row.pricing_version,
    paymentMethod: row.payment_method, createdAt: row.created_at, updatedAt: row.updated_at,
    cancelledAt: row.cancelled_at,
  };
}

function publicEvent(row: EventRow) {
  return { id: row.id, fromState: row.from_state, toState: row.to_state,
    reason: row.reason, actorUserId: row.actor_user_id, occurredAt: row.occurred_at };
}

export class RideService {
  constructor(private readonly repository: PostgresRideRepository) {}

  areas() { return this.repository.areas(); }

  async create(input: { passengerId: string; pickupAreaId: string; destinationAreaId: string; seats: number }) {
    if (input.pickupAreaId === input.destinationAreaId) {
      throw new RideFailure(400, 'INVALID_INPUT', 'Pickup and destination must differ');
    }
    const tariff = await this.repository.tariff(input.pickupAreaId, input.destinationAreaId);
    if (!tariff) throw new RideFailure(400, 'UNSUPPORTED_ROUTE', 'Route is not available');
    // Approved standalone v1 fare; a pool discount applies only when the driver accepts a future pool.
    const estimatedFarePoysha = input.seats *
      (tariff.base_per_seat_poysha + tariff.zone_charge_poysha);
    if (!Number.isSafeInteger(estimatedFarePoysha) || estimatedFarePoysha > 2147483647) {
      throw new RideFailure(500, 'INTERNAL_ERROR', 'Tariff is out of range');
    }
    try {
      return publicRide(await this.repository.create({
        passengerId: input.passengerId, pickupId: input.pickupAreaId,
        destinationId: input.destinationAreaId, seats: input.seats,
        estimatedFarePoysha, pricingVersion: tariff.pricing_version,
      }));
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
        throw new RideFailure(409, 'ACTIVE_REQUEST_EXISTS', 'Finish or cancel your active request first');
      }
      throw error;
    }
  }

  async list(passengerId: string, scope: 'active' | 'history', limit: number, offset: number) {
    return (await this.repository.list(passengerId, scope, limit, offset)).map(publicRide);
  }

  async find(id: string, passengerId: string) {
    const row = await this.repository.find(id, passengerId);
    if (!row) throw new RideFailure(404, 'NOT_FOUND', 'Ride request not found');
    return { ...publicRide(row), events: (await this.repository.events(id)).map(publicEvent) };
  }

  async cancel(id: string, passengerId: string) {
    const result = await this.repository.cancel(id, passengerId);
    if (!result) throw new RideFailure(404, 'NOT_FOUND', 'Ride request not found');
    if (result === 'INVALID_TRANSITION') {
      throw new RideFailure(409, 'INVALID_TRANSITION', 'This request can no longer be cancelled');
    }
    return publicRide(result);
  }
}
