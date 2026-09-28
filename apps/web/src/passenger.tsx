import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api, areaName, money, rideLabel } from './api';
import type { Area, Ride } from './api';
import { useSession } from './auth';
import { Empty, Fare, Notice, Status, Timeline } from './ui';

const cancellable = new Set(['REQUESTED', 'MATCHED', 'ACCEPTED', 'DRIVER_ARRIVED']);
const v1Destinations: Record<string, number> = { mohakhali: 8000, 'gulshan-1': 12000 };

function RideCard({ ride, areas, onCancel, busy }: {
  ride: Ride; areas: Area[]; onCancel?: () => void; busy?: boolean;
}) {
  return <article className="panel ride-card">
    <div className="card-heading"><div><p className="eyebrow">Your journey</p>
      <h3>{areaName(areas, ride.pickupAreaId)} <span className="arrow">→</span> {areaName(areas, ride.destinationAreaId)}</h3>
    </div><Status state={ride.status} label={rideLabel[ride.status]} /></div>
    <div className="meta-row"><span>{ride.seats} passenger seat{ride.seats > 1 ? 's' : ''}</span>
      <span>Requested {new Date(ride.createdAt).toLocaleString()}</span></div>
    {ride.status === 'REQUESTED' && <Notice>Bullet is unavailable or full right now.
      Your request is waiting; you have not been charged.</Notice>}
    {ride.status === 'MATCHED' && <Notice>Seat reserved in Bullet. Waiting for Jashim to accept.</Notice>}
    {ride.status === 'CANCELLED' && <Notice>Your request was cancelled. Cash due is {money(0)}.</Notice>}
    <Fare estimate={ride.estimatedFarePoysha} snapshot={ride.fareSnapshot} due={ride.cashDuePoysha} />
    {onCancel && cancellable.has(ride.status) && <button className="danger-outline" disabled={busy}
      onClick={onCancel}>{busy ? 'Cancelling…' : 'Cancel request'}</button>}
    {ride.events && <div className="history-events"><h4>Ride timeline</h4>
      <Timeline events={ride.events} /></div>}
  </article>;
}

export function PassengerDashboard() {
  const { user } = useSession();
  const [areas, setAreas] = useState<Area[]>([]);
  const [ride, setRide] = useState<Ride | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [pickup, setPickup] = useState('');
  const [destination, setDestination] = useState('');
  const [seats, setSeats] = useState(1);

  const refresh = useCallback(async () => {
    const [newAreas, rides] = await Promise.all([api.areas(), api.rides('active')]);
    setAreas(newAreas);
    setRide(rides[0] ? await api.ride(rides[0].id) : null);
  }, []);
  useEffect(() => {
    let live = true;
    refresh().catch((failure) => {
      if (live) setError(failure instanceof Error ? failure.message : 'Could not load your ride.');
    }).finally(() => { if (live) setLoading(false); });
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void refresh().catch((failure) => {
          if (live) setError(failure instanceof Error ? failure.message : 'Could not refresh your ride.');
        });
      }
    }, 10000);
    return () => { live = false; window.clearInterval(interval); };
  }, [refresh]);

  const banani = areas.find((area) => area.code === 'banani');
  const selectedPickup = pickup || banani?.id || '';
  const selectedDestination = areas.find((area) => area.id === destination);
  const preview = selectedPickup === banani?.id && selectedDestination &&
    v1Destinations[selectedDestination.code] !== undefined
    ? seats * (5000 + v1Destinations[selectedDestination.code]) : null;

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(''); setSuccess('');
    if (!selectedPickup || !destination || selectedPickup === destination ||
      !Number.isInteger(seats) || seats < 1 || seats > 3 || preview === null) {
      setError('Choose Banani, a supported destination and 1–3 seats.');
      return;
    }
    setBusy(true);
    try {
      const created = await api.createRide(selectedPickup, destination, seats);
      await refresh();
      setSuccess(created.status === 'REQUESTED'
        ? 'Request received. You are waiting for a seat.' : 'Your seat is matched with Bullet.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not request a ride.');
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }
  async function cancel() {
    if (!ride) return;
    setBusy(true); setError(''); setSuccess('');
    try {
      await api.cancelRide(ride.id);
      await refresh();
      setSuccess('Your request was cancelled. The seat is available again.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not cancel your request.');
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }
  async function manualRefresh() {
    setError('');
    try { await refresh(); } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not refresh your ride.');
    }
  }

  return <main className="page">
    <div className="page-intro"><div><p className="eyebrow">Passenger portal</p>
      <h1>Good to see you, {user?.name.split(' ')[0]}.</h1>
      <p>Ride together across Dhaka. Your journey and fare stay private to you.</p></div>
      <Link className="text-link" to="/passenger/history">View ride history →</Link></div>
    {success && <Notice kind="success">{success}</Notice>}
    {error && <Notice kind="error">{error} <button className="inline-button" onClick={() => void manualRefresh()}>Retry</button></Notice>}
    {loading ? <p role="status" className="panel loading">Loading your ride and areas…</p>
      : <div className="dashboard-grid">
        <section>
          <div className="section-heading"><h2>Current ride</h2>
            <button className="subtle" onClick={() => void manualRefresh()}>Refresh status</button></div>
          {ride ? <RideCard ride={ride} areas={areas} onCancel={() => void cancel()} busy={busy} />
            : <Empty title="No active ride">When you book, your request and status will appear here.</Empty>}
        </section>
        <section className="panel booking">
          <p className="eyebrow">New journey</p><h2>Book a seat</h2>
          <p className="muted">Two supported routes, one shared Tesla. Other Dhaka areas are listed for future service.</p>
          <form onSubmit={(event) => void create(event)}>
            <label>Pickup area
              <select value={selectedPickup} onChange={(event) => setPickup(event.target.value)}
                disabled={Boolean(ride) || busy} required>
                <option value="">Choose pickup</option>
                {areas.map((area) => <option key={area.id} value={area.id}
                  disabled={area.code !== 'banani'}>{area.name}{area.code !== 'banani' ? ' · coming later' : ''}</option>)}
              </select>
            </label>
            <label>Destination
              <select value={destination} onChange={(event) => setDestination(event.target.value)}
                disabled={Boolean(ride) || busy} required>
                <option value="">Choose destination</option>
                {areas.filter((area) => area.id !== selectedPickup).map((area) =>
                  <option key={area.id} value={area.id} disabled={v1Destinations[area.code] === undefined}>
                    {area.name}{v1Destinations[area.code] === undefined ? ' · coming later' : ''}
                  </option>)}
              </select>
            </label>
            <label>Passenger seats
              <select value={seats} onChange={(event) => setSeats(Number(event.target.value))}
                disabled={Boolean(ride) || busy}>
                {[1, 2, 3].map((count) => <option key={count} value={count}>{count} seat{count > 1 ? 's' : ''}</option>)}
              </select>
            </label>
            <div className="estimate"><span>Standalone estimate</span>
              <strong>{preview === null ? 'Choose a route' : money(preview)}</strong></div>
            <p className="muted fine">Indicative v1 tariff. The server confirms the estimate on booking;
              pooled discount is fixed only when Jashim accepts.</p>
            <button type="submit" className="primary full" disabled={Boolean(ride) || busy || areas.length === 0}>
              {busy ? 'Submitting…' : ride ? 'Finish your active ride first' : 'Request a ride'}
            </button>
          </form>
        </section>
      </div>}
  </main>;
}

export function PassengerHistory() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, Ride>>({});
  const [detailBusy, setDetailBusy] = useState('');

  async function load(offset = 0) {
    setError('');
    try {
      const [areaRows, page] = await Promise.all([api.areas(), api.rides('history', offset)]);
      setAreas(areaRows);
      setRides((previous) => offset ? [...previous, ...page] : page);
      setMore(page.length === 50);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load history.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function details(id: string) {
    if (expanded[id]) {
      setExpanded((previous) => { const next = { ...previous }; delete next[id]; return next; });
      return;
    }
    setDetailBusy(id); setError('');
    try {
      const detail = await api.ride(id);
      setExpanded((previous) => ({ ...previous, [id]: detail }));
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load ride details.'); }
    finally { setDetailBusy(''); }
  }
  return <main className="page">
    <div className="page-intro"><div><p className="eyebrow">Passenger portal</p><h1>Ride history</h1>
      <p>Your completed and cancelled rides, with your own fares and status events.</p></div>
      <Link className="text-link" to="/passenger">← Current ride</Link></div>
    {error && <Notice kind="error">{error} <button className="inline-button"
      onClick={() => void load()}>Retry</button></Notice>}
    {loading ? <p role="status" className="panel loading">Loading your history…</p>
      : rides.length === 0 ? <Empty title="No past rides">Completed and cancelled rides will appear here.</Empty>
        : <div className="history-list">{rides.map((ride) => <div key={ride.id}>
          <RideCard ride={expanded[ride.id] ?? ride} areas={areas} />
          <button className="subtle detail-toggle" disabled={detailBusy === ride.id}
            onClick={() => void details(ride.id)}>
            {detailBusy === ride.id ? 'Loading details…' : expanded[ride.id] ? 'Hide timeline' : 'View timeline'}
          </button>
        </div>)}
        {more && <button className="secondary" onClick={() => void load(rides.length)}>Load more rides</button>}
        </div>}
  </main>;
}
