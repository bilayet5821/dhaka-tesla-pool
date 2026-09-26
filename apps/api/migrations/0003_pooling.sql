CREATE TABLE pools (
  id uuid PRIMARY KEY,
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  pickup_area_id uuid NOT NULL REFERENCES areas(id),
  status text NOT NULL CHECK (status IN
    ('OPEN', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_at timestamptz,
  arrived_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX pools_one_active_vehicle_idx ON pools (vehicle_id)
  WHERE status NOT IN ('COMPLETED', 'CANCELLED');
CREATE INDEX pools_open_order_idx ON pools (created_at, id) WHERE status = 'OPEN';

CREATE TABLE pool_memberships (
  id uuid PRIMARY KEY,
  pool_id uuid NOT NULL REFERENCES pools(id),
  ride_request_id uuid NOT NULL UNIQUE REFERENCES ride_requests(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  CHECK (released_at IS NULL OR released_at >= joined_at)
);
CREATE INDEX pool_memberships_active_pool_idx ON pool_memberships (pool_id, ride_request_id)
  WHERE released_at IS NULL;

ALTER TABLE ride_events ALTER COLUMN ride_request_id DROP NOT NULL;
ALTER TABLE ride_events ADD COLUMN pool_id uuid REFERENCES pools(id);
ALTER TABLE ride_events ADD COLUMN entity_type text NOT NULL DEFAULT 'REQUEST'
  CHECK (entity_type IN ('REQUEST', 'POOL'));
ALTER TABLE ride_events ADD CONSTRAINT ride_events_exactly_one_entity CHECK (
  (entity_type = 'REQUEST' AND ride_request_id IS NOT NULL AND pool_id IS NULL)
  OR (entity_type = 'POOL' AND pool_id IS NOT NULL AND ride_request_id IS NULL)
);
ALTER TABLE ride_events DROP CONSTRAINT ride_events_from_state_check;
ALTER TABLE ride_events DROP CONSTRAINT ride_events_to_state_check;
ALTER TABLE ride_events ADD CONSTRAINT ride_events_states_match_entity CHECK (
  (entity_type = 'REQUEST'
    AND (from_state IS NULL OR from_state IN
      ('REQUESTED', 'MATCHED', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'))
    AND to_state IN
      ('REQUESTED', 'MATCHED', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED'))
  OR (entity_type = 'POOL'
    AND (from_state IS NULL OR from_state IN
      ('OPEN', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
    AND to_state IN
      ('OPEN', 'ACCEPTED', 'ARRIVED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'))
);
CREATE INDEX ride_events_pool_time_idx ON ride_events (pool_id, occurred_at, id)
  WHERE pool_id IS NOT NULL;
