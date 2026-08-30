CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  relationship text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  license_plate text,
  driver_name text,
  model text,
  color text
);
CREATE TABLE IF NOT EXISTS journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pickup text NOT NULL,
  destination text NOT NULL,
  pickup_place_id text,
  destination_place_id text,
  pickup_latitude double precision NOT NULL,
  pickup_longitude double precision NOT NULL,
  destination_latitude double precision NOT NULL,
  destination_longitude double precision NOT NULL,
  selected_route_id text,
  route_distance_meters double precision NOT NULL,
  route_duration_seconds double precision NOT NULL,
  status text NOT NULL DEFAULT 'PLANNED',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS journey_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  route_id text NOT NULL,
  points_json text NOT NULL,
  distance_meters double precision NOT NULL,
  duration_seconds double precision NOT NULL,
  traffic text,
  safety_status text NOT NULL DEFAULT 'PENDING',
  safety_score double precision,
  risk_level text NOT NULL DEFAULT 'UNKNOWN'
);
CREATE TABLE IF NOT EXISTS location_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  recorded_at timestamptz NOT NULL,
  accuracy_meters double precision,
  speed_meters_per_second double precision
);
CREATE TABLE IF NOT EXISTS emergency_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  type text NOT NULL,
  message text NOT NULL,
  latitude double precision,
  longitude double precision,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS route_deviation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  classification text NOT NULL,
  distance_meters double precision NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS stationary_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  duration_seconds integer NOT NULL,
  classification text NOT NULL,
  is_emergency boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS journeys_user_created_idx ON journeys(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS locations_journey_recorded_idx ON location_points(journey_id, recorded_at DESC);