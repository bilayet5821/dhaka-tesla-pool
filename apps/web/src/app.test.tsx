import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { App } from './app';
import type { AssignedPool, Ride, User } from './api';
import { Fare } from './ui';

const passenger: User = { id: 'p1', name: 'Nusrat', email: 'nusrat@example.com', role: 'PASSENGER' };
const driver: User = { id: 'd1', name: 'Jashim', email: 'jashim@example.com', role: 'DRIVER' };
const banani = { id: 'banani-id', code: 'banani', name: 'Banani' };
const mohakhali = { id: 'mohakhali-id', code: 'mohakhali', name: 'Mohakhali' };
const gulshan = { id: 'gulshan-id', code: 'gulshan-1', name: 'Gulshan 1' };

function reply(data: unknown, status = 200) {
  return new Response(JSON.stringify(status < 400 ? { data } : {
    error: data,
  }), { status, headers: { 'Content-Type': 'application/json' } });
}
function install(handler: (path: string, method: string, body?: Record<string, unknown>) =>
  Response | Promise<Response>) {
  const spy = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = String(input).replace('/api/v1', '');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : undefined;
    return handler(path, method, body);
  });
  vi.stubGlobal('fetch', spy);
  return spy;
}
function ride(status: Ride['status'] = 'REQUESTED'): Ride {
  return {
    id: 'ride-1', pickupAreaId: banani.id, destinationAreaId: mohakhali.id, seats: 1,
    status, estimatedFarePoysha: 13000, pricingVersion: 1, paymentMethod: 'CASH',
    createdAt: '2026-09-28T08:00:00Z', updatedAt: '2026-09-28T08:00:00Z', cancelledAt: null,
    finalFarePoysha: null, cashDuePoysha: null, fareSnapshot: null,
    events: [{ id: 'event-1', fromState: null, toState: 'REQUESTED',
      reason: 'PASSENGER_REQUEST', occurredAt: '2026-09-28T08:00:00Z' }],
  };
}
function pool(status: AssignedPool['status'] = 'OPEN'): AssignedPool {
  const memberStatus = {
    OPEN: 'MATCHED', ACCEPTED: 'ACCEPTED', ARRIVED: 'DRIVER_ARRIVED',
    IN_PROGRESS: 'STARTED', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED',
  } as const;
  return {
    id: 'pool-1', vehicleId: 'vehicle-1', pickupAreaId: banani.id, status,
    createdAt: '2026-09-28T08:00:00Z', acceptedAt: null, arrivedAt: null,
    startedAt: null, completedAt: null, cancelledAt: null,
    members: [{ rideRequestId: 'ride-1', passengerName: 'Nusrat',
      pickupAreaId: banani.id, destinationAreaId: mohakhali.id,
      seats: 1, status: memberStatus[status], estimatedFarePoysha: 13000,
      finalFarePoysha: status === 'OPEN' ? null : 13000, releasedAt: null }],
    events: [],
  };
}

describe('frontend API flows', () => {
  it('shows session loading until the server restores the passenger', async () => {
    let finish!: (response: Response) => void;
    install((path) => {
      if (path === '/auth/me') return new Promise<Response>((resolve) => { finish = resolve; });
      if (path === '/areas') return reply([banani, mohakhali]);
      if (path.startsWith('/ride-requests?')) return reply([]);
      throw new Error(`Unexpected ${path}`);
    });
    window.history.replaceState({}, '', '/passenger');
    render(<App />);
    expect(screen.getByRole('status')).toHaveTextContent('Restoring your session');
    finish(reply({ user: passenger }));
    expect(await screen.findByText('No active ride')).toBeInTheDocument();
  });

  it('signs in Jashim and redirects to driver-only navigation', async () => {
    const requests = install((path, method, body) => {
      if (path === '/auth/me') return reply({ code: 'AUTH_REQUIRED', message: 'Sign in required' }, 401);
      if (path === '/auth/login') {
        expect(method).toBe('POST');
        expect(body).toEqual({ email: 'jashim@example.com', password: 'private-demo-password' });
        return reply({ user: driver });
      }
      if (path === '/driver/vehicle') return reply({
        id: 'vehicle-1', name: 'Bullet', capacitySeats: 3, isOnline: false,
      });
      if (path.startsWith('/driver/pools?')) return reply([]);
      if (path === '/areas') return reply([banani, mohakhali]);
      throw new Error(`Unexpected ${path}`);
    });
    render(<App />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole('textbox', { name: 'Email' }), 'jashim@example.com');
    await user.type(screen.getByLabelText('Password'), 'private-demo-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Ready to roll, Jashim?')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Trips' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'My ride' })).not.toBeInTheDocument();
    expect(requests.mock.calls.some(([path]) => String(path).includes('/auth/login'))).toBe(true);
  });

  it('restores a guest, registers a passenger, then signs out without storing tokens', async () => {
    const requests = install((path, method, body) => {
      if (path === '/auth/me') return reply({ code: 'AUTH_REQUIRED', message: 'Sign in required' }, 401);
      if (path === '/auth/register') {
        expect(method).toBe('POST');
        expect(body).toMatchObject({ name: 'Nusrat', email: 'nusrat@example.com' });
        return reply({ user: passenger }, 201);
      }
      if (path === '/areas') return reply([banani, mohakhali, gulshan]);
      if (path.startsWith('/ride-requests?')) return reply([]);
      if (path === '/auth/logout') return reply({ signedOut: true });
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(<App />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('link', { name: 'Sign up' }));
    await user.type(screen.getByRole('textbox', { name: 'Full name' }), 'Nusrat');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'nusrat@example.com');
    await user.type(screen.getByLabelText('Password'), 'long-private-passphrase');
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Good to see you, Nusrat.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(requests.mock.calls.some(([path]) => String(path).includes('/auth/logout'))).toBe(true);
    expect(window.localStorage.length).toBe(0);
  });

  it('books a waiting request, shows its own estimate and cancels only while valid', async () => {
    let current: Ride | null = null;
    const requests = install((path, method, body) => {
      if (path === '/auth/me') return reply({ user: passenger });
      if (path === '/areas') return reply([banani, mohakhali, gulshan]);
      if (path.startsWith('/ride-requests?scope=active')) return reply(current ? [current] : []);
      if (path === '/ride-requests' && method === 'POST') {
        expect(body).toEqual({ pickupAreaId: banani.id, destinationAreaId: mohakhali.id, seats: 1 });
        current = ride();
        return reply(current, 201);
      }
      if (path === '/ride-requests/ride-1' && method === 'GET') return reply(current);
      if (path === '/ride-requests/ride-1/cancel') {
        current = null;
        return reply({ ...ride('CANCELLED'), cashDuePoysha: 0 });
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    render(<App />);
    const user = userEvent.setup();
    expect(await screen.findByText('No active ride')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request a ride' })).toBeEnabled();
    await user.selectOptions(screen.getByLabelText('Destination'), mohakhali.id);
    expect(screen.getByText('৳130.00')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request a ride' }));
    expect(await screen.findByText('Waiting for a seat')).toBeInTheDocument();
    expect(screen.getByText(/Your request is waiting/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finish your active ride first' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(await screen.findByText('Your request was cancelled. The seat is available again.')).toBeInTheDocument();
    expect(await screen.findByText('No active ride')).toBeInTheDocument();
    expect(requests.mock.calls.some(([path]) => String(path).includes('/ride-1/cancel'))).toBe(true);
  });

  it('shows restoration/loading errors and an empty history with a retry action', async () => {
    let failed = true;
    install((path) => {
      if (path === '/auth/me') {
        if (failed) return reply({ code: 'DEPENDENCY_UNAVAILABLE', message: 'Database unavailable' }, 503);
        return reply({ user: passenger });
      }
      if (path === '/areas') return reply([banani, mohakhali]);
      if (path.startsWith('/ride-requests?')) return reply([]);
      throw new Error(`Unexpected ${path}`);
    });
    window.history.replaceState({}, '', '/passenger/history');
    render(<App />);
    expect(await screen.findByText('Connection unavailable')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Database unavailable');
    failed = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No past rides')).toBeInTheDocument();
  });

  it('protects roles, controls Bullet availability and presents only the valid next action', async () => {
    let online = false;
    let current = pool();
    let rejectAccept = true;
    const requests = install((path, method, body) => {
      if (path === '/auth/me') return reply({ user: driver });
      if (path === '/areas') return reply([banani, mohakhali, gulshan]);
      if (path === '/driver/vehicle' && method === 'GET') {
        return reply({ id: 'vehicle-1', name: 'Bullet', capacitySeats: 3, isOnline: online });
      }
      if (path === '/driver/vehicle/availability') {
        online = Boolean(body?.isOnline);
        return reply({ id: 'vehicle-1', name: 'Bullet', capacitySeats: 3, isOnline: online });
      }
      if (path.startsWith('/driver/pools?scope=active')) return reply([current]);
      const action = path.match(/^\/driver\/pools\/pool-1\/(accept|arrive|start|complete)$/)?.[1];
      if (action) {
        if (action === 'accept' && rejectAccept) {
          rejectAccept = false;
          return reply({ code: 'INVALID_TRANSITION', message: 'Pool membership has changed' }, 409);
        }
        current = pool({ accept: 'ACCEPTED', arrive: 'ARRIVED', start: 'IN_PROGRESS',
          complete: 'COMPLETED' }[action] as AssignedPool['status']);
        return reply(current);
      }
      throw new Error(`Unexpected ${method} ${path}`);
    });
    window.history.replaceState({}, '', '/passenger');
    render(<App />);
    const user = userEvent.setup();
    expect(await screen.findByText('Ready to roll, Jashim?')).toBeInTheDocument();
    expect(window.location.pathname).toBe('/driver');
    expect(screen.queryByRole('link', { name: 'My ride' })).not.toBeInTheDocument();
    expect(await screen.findByText('Relevant Ride Requests')).toBeInTheDocument();
    expect(screen.getByText('Nusrat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go online' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Go online' }));
    expect(await screen.findByText('Bullet is online. Waiting rides were checked.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Go offline' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Accept pool' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Pool membership has changed');
    expect(screen.getByRole('button', { name: 'Accept pool' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Accept pool' }));
    expect(await screen.findByRole('button', { name: 'Mark arrived' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Mark arrived' }));
    expect(await screen.findByRole('button', { name: 'Start trip' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Start trip' }));
    expect(await screen.findByRole('button', { name: 'Complete trip' })).toBeEnabled();
    expect(requests.mock.calls.filter(([path]) => String(path).includes('/driver/pools/pool-1/')))
      .toHaveLength(4);
  });

  it('shows immutable fare components and hides cancellation after trip start', async () => {
    const started = { ...ride('STARTED'), finalFarePoysha: 11400, cashDuePoysha: 11400,
      fareSnapshot: { pricingVersion: 1, seatCount: 1, basePerSeatPoysha: 5000,
        zonePerSeatPoysha: 8000, discountPerSeatPoysha: 1600,
        totalPoysha: 11400, committedAt: '2026-09-28T08:05:00Z' } };
    install((path) => {
      if (path === '/auth/me') return reply({ user: passenger });
      if (path === '/areas') return reply([banani, mohakhali]);
      if (path.startsWith('/ride-requests?')) return reply([started]);
      if (path === '/ride-requests/ride-1') return reply(started);
      throw new Error(`Unexpected ${path}`);
    });
    render(<App />);
    expect(await screen.findByText('Trip in progress')).toBeInTheDocument();
    const fare = screen.getByText('Accepted fare').closest('section')!;
    expect(within(fare).getAllByText('৳114.00')).toHaveLength(2);
    expect(within(fare).getByText('−৳16.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel request' })).not.toBeInTheDocument();
    const cancelledFare = render(<Fare estimate={13000} snapshot={started.fareSnapshot} due={0} />);
    expect(within(cancelledFare.container).getByText('৳0.00')).toBeInTheDocument();
  });

  it('shows a driver empty pool state and handles availability conflicts', async () => {
    install((path, method) => {
      if (path === '/auth/me') return reply({ user: driver });
      if (path === '/areas') return reply([banani, mohakhali]);
      if (path === '/driver/vehicle') return reply({
        id: 'vehicle-1', name: 'Bullet', capacitySeats: 3, isOnline: true,
      });
      if (path.startsWith('/driver/pools?')) return reply([]);
      if (path === '/driver/vehicle/availability' && method === 'PATCH') {
        return reply({ code: 'VEHICLE_BUSY', message: 'Finish or cancel the active pool first' }, 409);
      }
      throw new Error(`Unexpected ${path}`);
    });
    window.history.replaceState({}, '', '/driver');
    render(<App />);
    expect(await screen.findByText('No active pool')).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go offline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Finish or cancel the active pool first');
  });

  it('returns to sign in when an authenticated request reports session expiry', async () => {
    let expired = false;
    install((path) => {
      if (path === '/auth/me') return reply({ user: passenger });
      if (path === '/areas') return reply([banani, mohakhali]);
      if (path.startsWith('/ride-requests?')) {
        return expired ? reply({ code: 'AUTH_REQUIRED', message: 'Sign in required' }, 401) : reply([]);
      }
      throw new Error(`Unexpected ${path}`);
    });
    render(<App />);
    expect(await screen.findByText('No active ride')).toBeInTheDocument();
    expired = true;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
});
