import type { ReactNode } from 'react';
import { money } from './api';
import type { FareSnapshot } from './api';

export function Notice({ children, kind = 'info' }: { children: ReactNode; kind?: 'info' | 'error' | 'success' }) {
  return <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>;
}

export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return <div className="empty"><span className="empty-icon" aria-hidden="true">↗</span>
    <h3>{title}</h3><p>{children}</p></div>;
}

export function Status({ label, state }: { label: string; state: string }) {
  return <span className={`status status-${state.toLowerCase()}`}>{label}</span>;
}

export function Fare({ snapshot, estimate, due }: {
  snapshot: FareSnapshot | null; estimate: number; due: number | null;
}) {
  return (
    <section className="fare">
      <div className="fare-top">
        <span>{snapshot ? 'Accepted fare' : 'Standalone estimate'}</span>
        <strong>{money(snapshot?.totalPoysha ?? estimate)}</strong>
      </div>
      {snapshot ? <>
        <dl className="fare-lines">
          <div><dt>Base · {snapshot.seatCount} seat{snapshot.seatCount > 1 ? 's' : ''}</dt>
            <dd>{money(snapshot.basePerSeatPoysha * snapshot.seatCount)}</dd></div>
          <div><dt>Zone charge</dt><dd>{money(snapshot.zonePerSeatPoysha * snapshot.seatCount)}</dd></div>
          <div><dt>Pool discount</dt><dd>−{money(snapshot.discountPerSeatPoysha * snapshot.seatCount)}</dd></div>
          <div className="fare-due"><dt>Cash due</dt><dd>{money(due ?? snapshot.totalPoysha)}</dd></div>
        </dl>
        <small>Pricing version {snapshot.pricingVersion} · Cash payment</small>
      </> : <p className="muted">Final fare is set when Jashim accepts the pool. Cash payment.</p>}
    </section>
  );
}

export function Timeline({ events }: { events: Array<{ id: string; toState: string; occurredAt: string }> }) {
  return <ol className="timeline">{events.map((event) =>
    <li key={event.id}><strong>{event.toState.replaceAll('_', ' ')}</strong>
      <span>{new Date(event.occurredAt).toLocaleString()}</span></li>)}</ol>;
}
