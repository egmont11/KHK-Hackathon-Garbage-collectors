# Turisťák backend

REST API + region dashboard, Fastify + TypeScript. Loads `data/poi.geojson` at startup (missing file → empty catalog, `/health` reports `poi_count: 0`).

## Run

```powershell
cd backend
npm install
npm run demo     # in-memory, 800 synthetic visits so the dashboard and leaderboard look alive
npm run dev      # in-memory, empty, auto-reload
npm test         # end-to-end smoke test (onboarding → check-in → leaderboard → stats)
```

- API: `http://localhost:3001/api/...`
- Region dashboard: `http://localhost:3001/dashboard` (add `?api=http://host:3001` to point it elsewhere)

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3001`, `0.0.0.0` | listen address |
| `POI_FILE` | `../data/poi.geojson` | POI catalog |
| `DATABASE_URL` | – | PostgreSQL; without it everything lives in memory |
| `CHECKIN_SECONDS` | `60` | required continuous time at a POI (use `10` for the pitch) |
| `CHECKIN_RADIUS_M`, `MAX_ACCURACY_M` | `100`, `50` | check-in geofence and minimum GPS accuracy |
| `DEMO_SEASON_SECONDS` | – | short seasons for the demo (e.g. `300`); default = calendar quarter |
| `EVENT_PERIOD_SECONDS` | 1 week (⅓ of demo season) | length of one quick-time-event round |
| `EVENTS_PER_PERIOD` | `3` | bonus POIs per round; `EVENTS=0` disables events |
| `DEMO_SEED` | `0` (`800` with `--demo`) | synthetic visits, memory mode only |

PowerShell example: `$env:CHECKIN_SECONDS=10; $env:DEMO_SEASON_SECONDS=300; npm run demo`

With `DATABASE_URL` the service applies `schema.sql` on startup, restores players, scores, visits and season history, finalizes seasons that ended while it was down, resumes the running season, and drops unfinished check-ins.

## API

All errors are `{"error": {"code", "message"}}`. Check-in endpoints need `Authorization: Bearer <token>` from `POST /api/players`.

| Endpoint | Notes |
|---|---|
| `GET /api/poi` | GeoJSON. Filters: `bbox=w,s,e,n`, `category=a,b`, `group=a,b`, `min_points`, `max_points`, `near=lat,lon` (+ optional `radius_m`; adds `distance_m`, sorted by distance), `max_stop_m` (stop within N m). `lite=1` returns only id/name/category/group/municipality/points/is_nkp (much smaller payload). Live props: `last_team`, `visits`, `event_multiplier`. |
| `GET /api/poi/:id` | Detail + `lat`, `lon`, `last_team`, `visits`, `last_visited_at`, `nearest_bus_stop`, `nearest_train_stop`, `idos_url`, `event`. |
| `GET /api/categories` | Groups and categories with labels and counts (for the filter UI). |
| `POST /api/players` `{name, team}` | → `{player_id, token, name, team}` |
| `GET /api/players/me` | → name, team, `season_points`, `visited[]` in the current season. |
| `POST /api/checkins/start` `{poi_id, lat, lon, accuracy_m}` | → `{checkin_id, required_seconds, valid, distance_m, radius_m, max_ping_gap_s, points, multiplier, reason}` |
| `POST /api/checkins/:id/ping` `{lat, lon, accuracy_m}` | every ~5 s → `{elapsed_s, remaining_s, valid, can_finish, distance_m, reason}`; `reason` is `OUT_OF_RANGE`, `LOW_ACCURACY` or `TOO_FAST`. |
| `POST /api/checkins/:id/finish` | empty body OK → `{awarded_points, base_points, multiplier, team, team_score}` |
| `GET /api/teams` | `[{team, name, color, score, members}]` for the current season |
| `GET /api/seasons/current` | `{season_id, starts_at, ends_at, remaining_s}` |
| `GET /api/seasons/history` | finished seasons, newest first |
| `GET /api/events/active` | quick time events: `{poi_id, poi_name, multiplier, base_points, bonus_points, lat, lon, ends_at, …}` |
| `GET /api/stats/poi?from=&to=&season=current&top=` | anonymous aggregates: totals, coverage, `by_poi`, `by_category`, `by_group`, `by_orp`, `by_hour`, `by_day`, `by_hour_of_day`, `by_team`, `top_pois`, `heatmap` (`[lat, lon, count]`) |
| `GET /api/dashboard` | season + teams + history + events + stats in one call |

## Game rules implemented

- Check-in: each ping ≤ 100 m from the POI with accuracy ≤ 50 m, pings at most 15 s apart, ≥ 60 s between the first and last valid ping of an unbroken streak, speed between pings < 30 km/h (movement within reported GPS accuracy is ignored), one award per player per POI per season. Starting a new check-in abandons the player's previous unfinished one.
- Seasons roll over lazily on requests (no cron); the final ranking is stored in history.
- Quick time events: each round picks bonus POIs (×2, sometimes ×3) from different groups, deterministically per round, so restarts agree. The multiplier active at check-in start is honoured even if the round ends mid check-in.
- Privacy: statistics hold only POI, team, points and time. Location pings are kept for check-in validation and deleted after 24 h; no routes are stored.

## Known data issue (for `build_poi.py`)

About 100 POIs have an `orp_code` that is not a 4-digit ORP code (municipality codes like `574538`, NUTS codes like `CZ0525`, or `#N/A`). The dashboard groups them under "Neurčeno".
