import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, areaName, money, poolLabel, rideLabel } from './api';
import type { Area, AssignedPool, PoolMember, Vehicle } from './api';
import { useSession } from './auth';
import { Empty, Notice, Status, Timeline } from './ui';

const steps = {
  OPEN: { action: 'accept', title: 'Accept pool', expected: 'MATCHED' },
  ACCEPTED: { action: 'arrive', title: 'Mark arrived', expected: 'ACCEPTED' },
  ARRIVED: { action: 'start', title: 'Start trip', expected: 'DRIVER_ARRIVED' },
  IN_PROGRESS: { action: 'complete', title: 'Complete trip', expected: 'STARTED' },
} as const;

function Members({ members, areas }: { members: PoolMember[]; areas: Area[] }) {
  return <section className="member-section">
    <div className="section-heading"><div><p className="eyebrow">Assigned passengers</p>
      <h3>Relevant Ride Requests</h3></div>
      <span className="member-count">{members.filter((member) => !member.releasedAt).length} active</span></div>
    {members.length === 0 ? <Empty title="No relevant requests">
      When compatible passengers match with Bullet, they will appear here.</Empty>
      : <div className="member-list">{members.map((member) =>
        <div key={member.rideRequestId} className={`member ${member.releasedAt ? 'released' : ''}`}>
          <div className="member-name"><span className="avatar" aria-hidden="true">
            {member.passengerName.charAt(0).toUpperCase()}</span><div>
              <strong>{member.passengerName}</strong>
              <small>{areaName(areas, member.pickupAreaId)} → {areaName(areas, member.destinationAreaId)}</small>
            </div></div>
          <div className="member-facts"><span>{member.seats} seat{member.seats > 1 ? 's' : ''}</span>
            <Status state={member.status} label={rideLabel[member.status]} />
            <span>{member.finalFarePoysha === null ? `Est. ${money(member.estimatedFarePoysha)}`
              : `Accepted ${money(member.finalFarePoysha)}`}</span>
          </div>
          {member.releasedAt && <small className="muted">Seat released</small>}
        </div>)}</div>}
  </section>;
}

function PoolView({ pool, areas, action, busy }: {
  pool: AssignedPool; areas: Area[]; action?: () => void; busy?: boolean;
}) {
  const step = pool.status in steps ? steps[pool.status as keyof typeof steps] : null;
  const active = pool.members.filter((member) => !member.releasedAt);
  const ready = step && active.length > 0 && active.every((member) => member.status === step.expected);
  const seats = active.reduce((sum, member) => sum + member.seats, 0);
  return <article className="panel pool-card">
    <div className="card-heading"><div><p className="eyebrow">Assigned pool</p>
      <h2>{areaName(areas, pool.pickupAreaId)} departures</h2>
      <p className="muted">Pickup: {areaName(areas, pool.pickupAreaId)} · Created {new Date(pool.createdAt).toLocaleString()}</p>
    </div><Status state={pool.status} label={poolLabel[pool.status]} /></div>
    <div className="capacity"><div><strong>{seats} / 3</strong><span>passenger seats reserved</span></div>
      <div className="capacity-track"><span style={{ width: `${Math.min(seats / 3, 1) * 100}%` }} /></div></div>
    <Members members={pool.members} areas={areas} />
    {action && step && <div className="pool-action">
      <button className="primary" disabled={!ready || busy} onClick={action}>
        {busy ? 'Updating trip…' : step.title}
      </button>
      {!ready && <p className="muted fine">This action needs active riders in the expected state.</p>}
      {pool.status === 'OPEN' && <p className="muted fine">Accepting freezes the member list and commits each rider's fare.</p>}
    </div>}
    {pool.events.length > 0 && <div className="history-events"><h4>Pool timeline</h4>
      <Timeline events={pool.events} /></div>}
  </article>;
}

export function DriverDashboard() {
  const { user } = useSession();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [pool, setPool] = useState<AssignedPool | null>(null);
  const [areas, setAreas] = useState<Area[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const refresh = useCallback(async () => {
    const [nextVehicle, pools, nextAreas] = await Promise.all([
      api.vehicle(), api.pools('active'), api.areas(),
    ]);
    setVehicle(nextVehicle);
    setPool(pools[0] ?? null);
    setAreas(nextAreas);
  }, []);
  useEffect(() => {
    let live = true;
    refresh().catch((failure) => {
      if (live) setError(failure instanceof Error ? failure.message : 'Could not load driver dashboard.');
    }).finally(() => { if (live) setLoading(false); });
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh().catch((failure) => {
        if (live) setError(failure instanceof Error ? failure.message : 'Could not refresh your pool.');
      });
    }, 10000);
    return () => { live = false; window.clearInterval(interval); };
  }, [refresh]);

  async function setOnline(value: boolean) {
    setBusy(true); setError(''); setSuccess('');
    try {
      await api.availability(value);
      await refresh();
      setSuccess(value ? 'Bullet is online. Waiting rides were checked.' : 'Bullet is offline.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Availability could not be changed.');
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }
  async function advance() {
    if (!pool || !(pool.status in steps)) return;
    const step = steps[pool.status as keyof typeof steps];
    setBusy(true); setError(''); setSuccess('');
    try {
      await api.driverAction(pool.id, step.action);
      await refresh();
      setSuccess(`${step.title} completed.`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Trip could not be updated.');
      await refresh().catch(() => undefined);
    } finally { setBusy(false); }
  }
  async function manualRefresh() {
    setError('');
    try { await refresh(); } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not refresh driver dashboard.');
    }
  }

  return <main className="page">
    <div className="page-intro"><div><p className="eyebrow">Driver portal</p>
      <h1>Ready to roll, {user?.name.split(' ')[0]}?</h1>
      <p>Bullet, your assigned passengers, and each step of the trip in one place.</p></div>
      <Link className="text-link" to="/driver/history">Trip history →</Link></div>
    {success && <Notice kind="success">{success}</Notice>}
    {error && <Notice kind="error">{error} <button className="inline-button"
      onClick={() => void manualRefresh()}>Retry</button></Notice>}
    {loading ? <p className="panel loading" role="status">Loading your vehicle and pool…</p>
      : <div className="dashboard-grid driver-grid">
        <section className="panel vehicle-card">
          <p className="eyebrow">Your Tesla</p><h2>{vehicle?.name ?? 'Vehicle unavailable'}</h2>
          <p className="muted">Capacity: {vehicle?.capacitySeats ?? '—'} passenger seats</p>
          <div className="availability"><span className={vehicle?.isOnline ? 'dot online' : 'dot'} />
            <strong>{vehicle?.isOnline ? 'Online · accepting matches' : 'Offline · not matching'}</strong></div>
          <button className={vehicle?.isOnline ? 'secondary full' : 'primary full'} disabled={busy || !vehicle ||
            (vehicle.isOnline && Boolean(pool))} onClick={() => void setOnline(!vehicle?.isOnline)}>
            {busy ? 'Updating…' : vehicle?.isOnline ? 'Go offline' : 'Go online'}
          </button>
          {vehicle?.isOnline && pool && <p className="muted fine">Finish or cancel the current pool before going offline.</p>}
          <p className="muted fine">Going online checks waiting requests for compatible seats.</p>
        </section>
        <section>
          <div className="section-heading"><h2>Current pool</h2>
            <button className="subtle" onClick={() => void manualRefresh()}>Refresh pool</button></div>
          {pool ? <PoolView pool={pool} areas={areas} action={() => void advance()} busy={busy} />
            : <Empty title="No active pool">Go online and wait for compatible ride requests.
              Assigned riders will appear here.</Empty>}
        </section>
      </div>}
  </main>;
}

export function DriverHistory() {
  const [areas, setAreas] = useState<Area[]>([]);
  const [pools, setPools] = useState<AssignedPool[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [more, setMore] = useState(false);
  async function load(offset = 0) {
    setError('');
    try {
      const [nextAreas, page] = await Promise.all([api.areas(), api.pools('history', offset)]);
      setAreas(nextAreas);
      setPools((previous) => offset ? [...previous, ...page] : page);
      setMore(page.length === 50);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not load trips.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  return <main className="page">
    <div className="page-intro"><div><p className="eyebrow">Driver portal</p><h1>Trip history</h1>
      <p>Completed and cancelled assigned pools, with riders, fares and lifecycle events.</p></div>
      <Link className="text-link" to="/driver">← Dashboard</Link></div>
    {error && <Notice kind="error">{error} <button className="inline-button"
      onClick={() => void load()}>Retry</button></Notice>}
    {loading ? <p className="panel loading" role="status">Loading trip history…</p>
      : pools.length === 0 ? <Empty title="No previous trips">Completed or cancelled pools will appear here.</Empty>
        : <div className="history-list">{pools.map((pool) =>
          <PoolView key={pool.id} pool={pool} areas={areas} />)}
          {more && <button className="secondary" onClick={() => void load(pools.length)}>Load more trips</button>}
        </div>}
  </main>;
}
