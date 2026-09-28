export type Role = 'PASSENGER' | 'DRIVER';
export type User = { id: string; name: string; email: string; role: Role };
export type Area = { id: string; code: string; name: string };
export type RideStatus = 'REQUESTED' | 'MATCHED' | 'ACCEPTED' | 'DRIVER_ARRIVED' |
  'STARTED' | 'COMPLETED' | 'CANCELLED';
export type PoolStatus = 'OPEN' | 'ACCEPTED' | 'ARRIVED' | 'IN_PROGRESS' |
  'COMPLETED' | 'CANCELLED';
export type FareSnapshot = {
  pricingVersion: number; seatCount: number; basePerSeatPoysha: number;
  zonePerSeatPoysha: number; discountPerSeatPoysha: number;
  totalPoysha: number; committedAt: string;
};
export type Ride = {
  id: string; pickupAreaId: string; destinationAreaId: string; seats: number;
  status: RideStatus; estimatedFarePoysha: number; pricingVersion: number;
  paymentMethod: 'CASH'; createdAt: string; updatedAt: string;
  cancelledAt: string | null; finalFarePoysha: number | null;
  cashDuePoysha: number | null; fareSnapshot: FareSnapshot | null;
  events?: Array<{ id: string; fromState: string | null; toState: string;
    reason: string; occurredAt: string }>;
};
export type Vehicle = { id: string; name: string; capacitySeats: number; isOnline: boolean };
export type PoolMember = {
  rideRequestId: string; passengerName: string; pickupAreaId: string;
  destinationAreaId: string; seats: number; status: RideStatus;
  estimatedFarePoysha: number; finalFarePoysha: number | null;
  releasedAt: string | null;
};
export type AssignedPool = {
  id: string; vehicleId: string; pickupAreaId: string; status: PoolStatus;
  createdAt: string; acceptedAt: string | null; arrivedAt: string | null;
  startedAt: string | null; completedAt: string | null; cancelledAt: string | null;
  members: PoolMember[];
  events: Array<{ id: string; fromState: string | null; toState: string;
    reason: string; occurredAt: string }>;
};

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

const base = '/api/v1';
async function request<T>(path: string, method = 'GET', body?: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method,
      credentials: 'same-origin',
      ...(body === undefined ? {} : {
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
    });
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Could not connect to the server. Try again.', 0);
  }
  let payload: { data?: T; error?: { code?: string; message?: string } };
  try {
    payload = await response.json() as typeof payload;
  } catch {
    throw new ApiError('BAD_RESPONSE', 'The server returned an unexpected response.', response.status);
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      window.dispatchEvent(new Event('session-expired'));
    }
    throw new ApiError(payload.error?.code ?? 'API_ERROR',
      payload.error?.message ?? 'The request could not be completed.', response.status);
  }
  if (payload.data === undefined) throw new ApiError('BAD_RESPONSE', 'No data was returned.', response.status);
  return payload.data;
}

export const api = {
  me: () => request<{ user: User }>('/auth/me'),
  signIn: (email: string, password: string) =>
    request<{ user: User }>('/auth/login', 'POST', { email, password }),
  signUp: (name: string, email: string, password: string) =>
    request<{ user: User }>('/auth/register', 'POST', { name, email, password }),
  signOut: () => request<{ signedOut: boolean }>('/auth/logout', 'POST', {}),
  areas: () => request<Area[]>('/areas'),
  rides: (scope: 'active' | 'history', offset = 0) =>
    request<Ride[]>(`/ride-requests?scope=${scope}&limit=50&offset=${offset}`),
  ride: (id: string) => request<Ride>(`/ride-requests/${encodeURIComponent(id)}`),
  createRide: (pickupAreaId: string, destinationAreaId: string, seats: number) =>
    request<Ride>('/ride-requests', 'POST', { pickupAreaId, destinationAreaId, seats }),
  cancelRide: (id: string) =>
    request<Ride>(`/ride-requests/${encodeURIComponent(id)}/cancel`, 'POST', {}),
  vehicle: () => request<Vehicle>('/driver/vehicle'),
  availability: (isOnline: boolean) =>
    request<Vehicle>('/driver/vehicle/availability', 'PATCH', { isOnline }),
  pools: (scope: 'active' | 'history', offset = 0) =>
    request<AssignedPool[]>(`/driver/pools?scope=${scope}&limit=50&offset=${offset}`),
  pool: (id: string) => request<AssignedPool>(`/driver/pools/${encodeURIComponent(id)}`),
  driverAction: (id: string, action: 'accept' | 'arrive' | 'start' | 'complete') =>
    request<AssignedPool>(`/driver/pools/${encodeURIComponent(id)}/${action}`, 'POST', {}),
};

export const money = (poysha: number) =>
  `৳${(poysha / 100).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const areaName = (areas: Area[], id: string) =>
  areas.find((area) => area.id === id)?.name ?? 'Unknown area';
export const rideLabel: Record<RideStatus, string> = {
  REQUESTED: 'Waiting for a seat', MATCHED: 'Matched with Bullet',
  ACCEPTED: 'Driver accepted', DRIVER_ARRIVED: 'Driver arrived',
  STARTED: 'Trip in progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
export const poolLabel: Record<PoolStatus, string> = {
  OPEN: 'Open for riders', ACCEPTED: 'Accepted', ARRIVED: 'Arrived',
  IN_PROGRESS: 'Trip in progress', COMPLETED: 'Completed', CANCELLED: 'Cancelled',
};
