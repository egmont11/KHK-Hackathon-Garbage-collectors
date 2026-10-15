-- PostgreSQL schema for replacing the in-memory demo store.
CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  team text NOT NULL CHECK (team IN ('hory', 'reky', 'lesy')),
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Player accounts: name + password (scrypt). Older players without a password can't log in elsewhere.
ALTER TABLE players ADD COLUMN IF NOT EXISTS password_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS players_login_name ON players (lower(name)) WHERE password_hash IS NOT NULL;

-- Odměny týdenních týmových questů (id = quest, jednou za kolo).
CREATE TABLE IF NOT EXISTS quest_awards (
  id text PRIMARY KEY,
  season_id text NOT NULL,
  team text NOT NULL CHECK (team IN ('hory', 'reky', 'lesy')),
  points integer NOT NULL,
  awarded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seasons (
  id text PRIMARY KEY,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  ranking jsonb,
  CHECK (ends_at > starts_at)
);
ALTER TABLE seasons ADD COLUMN IF NOT EXISTS ranking jsonb;

CREATE TABLE IF NOT EXISTS checkins (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id),
  poi_id text NOT NULL,
  season_id text NOT NULL REFERENCES seasons(id),
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  valid boolean NOT NULL DEFAULT false,
  awarded_points integer NOT NULL DEFAULT 0 CHECK (awarded_points >= 0)
);
CREATE INDEX IF NOT EXISTS checkins_poi_idx ON checkins (poi_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS checkins_season_idx ON checkins (season_id, player_id);
CREATE UNIQUE INDEX IF NOT EXISTS checkins_one_award_per_player_poi_season
  ON checkins (player_id, poi_id, season_id) WHERE finished_at IS NOT NULL AND valid;

CREATE TABLE IF NOT EXISTS pings (
  checkin_id uuid NOT NULL REFERENCES checkins(id) ON DELETE CASCADE,
  ts timestamptz NOT NULL,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lon double precision NOT NULL CHECK (lon BETWEEN -180 AND 180),
  accuracy_m double precision NOT NULL CHECK (accuracy_m >= 0),
  PRIMARY KEY (checkin_id, ts)
);
CREATE INDEX IF NOT EXISTS pings_ts_idx ON pings (ts);

CREATE TABLE IF NOT EXISTS team_scores (
  season_id text NOT NULL REFERENCES seasons(id),
  team text NOT NULL CHECK (team IN ('hory', 'reky', 'lesy')),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, team)
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  type text NOT NULL,
  poi_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  multiplier numeric(4, 2) NOT NULL DEFAULT 1 CHECK (multiplier >= 1),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS admins (
  id uuid PRIMARY KEY,
  username text NOT NULL UNIQUE CHECK (char_length(username) BETWEEN 3 AND 40),
  password_hash text NOT NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  password_changed_at timestamptz
);

-- Quick time events: weekly bonus POIs (poi_id) and daily category challenges (category).
ALTER TABLE events ALTER COLUMN poi_id DROP NOT NULL;
ALTER TABLE events ADD COLUMN IF NOT EXISTS category text;

-- Which quick time event (if any) applied to a check-in; used for badges.
ALTER TABLE checkins ADD COLUMN IF NOT EXISTS event_type text;
