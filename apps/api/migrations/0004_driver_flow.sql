CREATE TABLE fare_snapshots (
  id uuid PRIMARY KEY,
  ride_request_id uuid NOT NULL UNIQUE REFERENCES ride_requests(id),
  pricing_version integer NOT NULL CHECK (pricing_version > 0),
  seat_count integer NOT NULL CHECK (seat_count BETWEEN 1 AND 3),
  base_per_seat_poysha integer NOT NULL CHECK (base_per_seat_poysha >= 0),
  zone_per_seat_poysha integer NOT NULL CHECK (zone_per_seat_poysha >= 0),
  discount_per_seat_poysha integer NOT NULL CHECK (discount_per_seat_poysha >= 0),
  total_poysha integer NOT NULL CHECK (total_poysha >= 0),
  committed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (discount_per_seat_poysha <= zone_per_seat_poysha),
  CHECK (total_poysha = seat_count *
    (base_per_seat_poysha + zone_per_seat_poysha - discount_per_seat_poysha))
);

-- Historical accepted prices cannot be changed or removed by application writes.
CREATE FUNCTION reject_fare_snapshot_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'fare snapshots are immutable';
END;
$$;
CREATE TRIGGER fare_snapshots_immutable BEFORE UPDATE OR DELETE ON fare_snapshots
  FOR EACH ROW EXECUTE FUNCTION reject_fare_snapshot_change();
