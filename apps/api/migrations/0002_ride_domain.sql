CREATE TABLE areas (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z0-9-]+$'),
  name text NOT NULL UNIQUE CHECK (length(btrim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE route_fares (
  id uuid PRIMARY KEY,
  origin_area_id uuid NOT NULL REFERENCES areas(id),
  destination_area_id uuid NOT NULL REFERENCES areas(id),
  pricing_version integer NOT NULL CHECK (pricing_version > 0),
  base_per_seat_poysha integer NOT NULL CHECK (base_per_seat_poysha >= 0),
  zone_charge_poysha integer NOT NULL CHECK (zone_charge_poysha >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (origin_area_id, destination_area_id, pricing_version),
  CHECK (origin_area_id <> destination_area_id)
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY,
  driver_user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  capacity_seats integer NOT NULL CHECK (capacity_seats > 0),
  is_online boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ride_requests (
  id uuid PRIMARY KEY,
  passenger_user_id uuid NOT NULL REFERENCES users(id),
  pickup_area_id uuid NOT NULL REFERENCES areas(id),
  destination_area_id uuid NOT NULL REFERENCES areas(id),
  seats_requested integer NOT NULL CHECK (seats_requested BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'REQUESTED' CHECK (status IN
    ('REQUESTED', 'MATCHED', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED')),
  estimated_fare_poysha integer NOT NULL CHECK (estimated_fare_poysha >= 0),
  pricing_version integer NOT NULL CHECK (pricing_version > 0),
  payment_method text NOT NULL DEFAULT 'CASH' CHECK (payment_method = 'CASH'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (pickup_area_id <> destination_area_id),
  CHECK ((status = 'CANCELLED') = (cancelled_at IS NOT NULL))
);

CREATE UNIQUE INDEX ride_requests_one_active_passenger_idx ON ride_requests (passenger_user_id)
  WHERE status NOT IN ('COMPLETED', 'CANCELLED');
CREATE INDEX ride_requests_passenger_history_idx ON ride_requests (passenger_user_id, created_at DESC, id DESC);
CREATE INDEX ride_requests_waiting_idx ON ride_requests (created_at, id) WHERE status = 'REQUESTED';

-- Pool reference and pool events will be added with the pool tables in Phase 4.
CREATE TABLE ride_events (
  id uuid PRIMARY KEY,
  ride_request_id uuid NOT NULL REFERENCES ride_requests(id),
  actor_user_id uuid REFERENCES users(id),
  from_state text CHECK (from_state IS NULL OR from_state IN
    ('REQUESTED', 'MATCHED', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED')),
  to_state text NOT NULL CHECK (to_state IN
    ('REQUESTED', 'MATCHED', 'ACCEPTED', 'DRIVER_ARRIVED', 'STARTED', 'COMPLETED', 'CANCELLED')),
  reason text NOT NULL CHECK (length(btrim(reason)) > 0),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ride_events_request_time_idx ON ride_events (ride_request_id, occurred_at, id);
