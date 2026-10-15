# Turisťák backend

REST API + region dashboard, Fastify + TypeScript. What's done and what isn't: [STATUS.md](STATUS.md). Loads `data/poi.geojson` at startup (missing file → empty catalog, `/health` reports `poi_count: 0`).

## Run

```powershell
cd backend
npm install
npm run demo     # in-memory, 800 synthetic visits so the dashboard and leaderboard look alive
npm run dev      # in-memory, empty, auto-reload
npm test         # end-to-end smoke test (onboarding → check-in → leaderboard → stats)
```

- API: `http://localhost:3001/api/...`
- Region dashboard: `http://localhost:3001/dashboard` (admin login; add `?api=http://host:3001` to point it elsewhere)

### Admin account

On first start the server creates the built-in admin `admin` with a random password and **prints it to the console once**. The first login forces a password change (min. 10 characters, letters and digits); until then every admin endpoint answers `403 PASSWORD_CHANGE_REQUIRED`. With PostgreSQL the account and its changed password persist; in memory mode a new password is generated on every start.

- Set your own initial password: `ADMIN_PASSWORD=...` (still has to be changed on first login).
- Lost password: start once with `ADMIN_RESET=1` (prints a new one, or uses `ADMIN_PASSWORD`).
- Repeated in-memory demo without the forced change: `ADMIN_PASSWORD=... ADMIN_MUST_CHANGE=0`.

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3001`, `0.0.0.0` | listen address |
| `POI_FILE` | `../data/poi.geojson` | POI catalog |
| `DATABASE_URL` | – | PostgreSQL; without it everything lives in memory |
| `CHECKIN_SECONDS` | `60` | required continuous time at a POI (use `10` for the pitch) |
| `CHECKIN_RADIUS_M`, `MAX_ACCURACY_M` | `100`, `50` | check-in geofence and minimum GPS accuracy |
| `DEMO_SEASON_SECONDS` | – | short seasons for the demo (e.g. `300`); default = calendar quarter |
| `WEEKLY_EVENT_COUNT`, `WEEKLY_MULTIPLIER`, `WEEKLY_MIN_DISTANCE_KM` | `3`, `2`, `50` | weekly bonus places |
| `DAILY_MULTIPLIER` | `1.4` | daily bonus category |
| `WEEKLY_EVENT_SECONDS`, `DAILY_EVENT_SECONDS` | 1 week, 1 day (½ and ⅙ of a demo season) | round lengths; full days start at midnight Prague time, weeks on Monday. `EVENTS=0` disables events |
| `ADMIN_USERNAME` | `admin` | built-in admin login |
| `ADMIN_PASSWORD` | random, printed | initial admin password |
| `ADMIN_RESET`, `ADMIN_MUST_CHANGE` | `0`, `1` | reset the built-in admin's password on start; require password change after first login |
| `ADMIN_SESSION_HOURS` | `12` | admin session lifetime (sessions live in memory, a restart logs admins out) |
| `DEMO_SEED` | `0` (`800` with `--demo`) | synthetic visits, memory mode only |

PowerShell example: `$env:CHECKIN_SECONDS=10; $env:DEMO_SEASON_SECONDS=300; npm run demo`

With `DATABASE_URL` the service applies `schema.sql` on startup, restores players, scores, visits and season history, finalizes seasons that ended while it was down, resumes the running season, and drops unfinished check-ins.

## API

All errors are `{"error": {"code", "message"}}`. Check-in endpoints need `Authorization: Bearer <token>` from `POST /api/players`. Admin endpoints need `Authorization: Bearer <token>` from `POST /api/admin/login` (a different token). Everything for players (map, leaderboard, seasons, events) stays public; only statistics and administration are behind admin login.

### Public / player

| Endpoint | Notes |
|---|---|
| `GET /api/poi` | GeoJSON. Filters: `bbox=w,s,e,n`, `category=a,b`, `group=a,b`, `min_points`, `max_points`, `near=lat,lon` (+ optional `radius_m`; adds `distance_m`, sorted by distance), `max_stop_m` (stop within N m). `lite=1` returns only id/name/category/group/municipality/points/is_nkp (much smaller payload). `bonus=1` returns only places with an active bonus; `owner=hory,reky,lesy,none` filters by owning team. Live props: `owner_team` (use this for the marker colour), `team_checkins` `{hory, reky, lesy}`, `last_team`, `visits`, `event_multiplier`, `event_type`, `bonus_points`. |
| `GET /api/poi/:id` | Detail + `lat`, `lon`, `last_team`, `visits`, `last_visited_at`, `nearest_bus_stop`, `nearest_train_stop`, `idos_url`, `event`. |
| `GET /api/categories` | Groups and categories with labels and counts (for the filter UI). |
| `POST /api/players` `{name, team}` | → `{player_id, token, name, team}` |
| `GET /api/players/me` | → name, team, `season_points`, `visited[]` in the current season, `badges` (all badges with `progress`/`target`/`earned`), `badge_archive` (earned badges of earlier seasons). |
| `GET /api/badges` | badge definitions `{id, name, description, target}` |
| `POST /api/checkins/start` `{poi_id, lat, lon, accuracy_m}` | → `{checkin_id, required_seconds, valid, distance_m, radius_m, max_ping_gap_s, points, multiplier, reason}` |
| `POST /api/checkins/:id/ping` `{lat, lon, accuracy_m}` | every ~5 s → `{elapsed_s, remaining_s, valid, can_finish, distance_m, reason}`; `reason` is `OUT_OF_RANGE`, `LOW_ACCURACY` or `TOO_FAST`. |
| `POST /api/checkins/:id/finish` | empty body OK → `{awarded_points, base_points, multiplier, team, team_score}` |
| `GET /api/teams` | `[{team, name, color, score, members, owned_pois}]` for the current season |
| `GET /api/seasons/current` | `{season_id, starts_at, ends_at, remaining_s}` |
| `GET /api/seasons/history` | finished seasons, newest first |
| `GET /api/events/active` | `{weekly: [{poi_id, poi_name, category_label, municipality, lat, lon, multiplier, base_points, bonus_points, starts_at, ends_at}], daily: {title, category, category_label, poi_count, multiplier, starts_at, ends_at}}` |

### Admin (region staff)

| Endpoint | Notes |
|---|---|
| `POST /api/admin/login` `{username, password}` | → `{token, expires_at, username, must_change_password}`. 5 failed attempts per IP → locked for 1 min (`429`). |
| `POST /api/admin/password` `{current_password, new_password}` | allowed while a change is required; logs out the admin's other sessions |
| `GET /api/admin/me`, `POST /api/admin/logout` | |
| `GET /api/stats/poi?from=&to=&season=current&top=` (alias `/api/admin/stats`) | where people go: totals, coverage, `by_poi`, `by_category`, `by_group`, `by_orp`, `by_hour`, `by_day`, `by_hour_of_day`, `by_team`, `top_pois`, `heatmap` (`[lat, lon, count]`) |
| `GET /api/dashboard` | season + teams + history + events + stats in one call |
| `GET /api/admin/export/visits.csv?from=&to=&season=current` | anonymous visit log (time, season, POI, category, municipality, ORP, team, points, lat/lon); `;`-separated with BOM for Czech Excel |
| `GET /api/admin/stats/timeline?dimension=category\|orp&key=&from=&to=&season=current` | check-ins per day for one category or ORP; for categories, days with that category's daily bonus are flagged (`bonus`), plus averages for bonus vs. other days. Default key = today's bonus category |
| `GET /api/admin/players` | players with season visits, points and badge count |
| `GET/POST /api/admin/admins`, `DELETE /api/admin/admins/:id` | manage admins; a new admin gets a generated `initial_password` (or the one you pass) and must change it on first login |
| `POST /api/admin/seasons/end` | ends the current season now (ranking goes to history) and starts a new one, e.g. `2026-Q4-2` for the rest of the quarter |

## Game rules implemented

- Check-in: each ping ≤ 100 m from the POI with accuracy ≤ 50 m, pings at most 15 s apart, ≥ 60 s between the first and last valid ping of an unbroken streak, speed between pings < 30 km/h (movement within reported GPS accuracy is ignored), one award per player per POI per season. Starting a new check-in abandons the player's previous unfinished one.
- Team battles (cosmetic only, no points): a place belongs to the team with the most check-ins there this season. On a tie the current owner keeps it. Since a player can check in at a place once per season, this means "most different players". Ownership resets with the season.
- Seasons roll over lazily on requests (no cron); the final ranking is stored in history.
- Quick time events (working name), the same for every player:
  - **Weekly:** 3 random bonus places at least 50 km apart, ×2, Monday to Monday. Hotels, libraries, info centres, camps, spas and salt caves are never picked.
  - **Daily:** one category of places (e.g. lookout towers) is worth ×1.4 at every place of that category, midnight to midnight. Picked from a curated list of categories with at least 10 places; never the same two days in a row.
- Badges: cosmetic (no points), earned per season, archived in the player's profile when the season ends. The finish response lists `new_badges`.

  | Badge | Requirement (per season) |
  |---|---|
  | První krok | first check-in |
  | Objevitel / Cestovatel / Dobyvatel | 5 / 15 / 40 places |
  | Hradní pán | 3 castles or chateaux |
  | Výhled! | 3 lookout towers or viewpoints |
  | Historik! | 3 museums or galleries |
  | Poutní cesta | 3 church monuments |
  | Sládek | 3 breweries |
  | Strážce dědictví | a national cultural monument (NKP) |
  | Křížem krážem | places in 5 different ORP districts |
  | Dobrodruh | 3 places more than 2 km from the nearest stop |
  | Lovec bonusů | 3 weekly bonus places |
  | Bet? | 5 check-ins with the daily bonus |
  | Převrat | your check-in took a place over for your team |
  | Ranní ptáče | a check-in before 8:00 |
  - Picks are deterministic per round, so restarts agree. If both apply to one place, the higher multiplier wins (they don't stack). The bonus active when a check-in starts is honoured even if the round ends mid check-in.
- Privacy: statistics hold only POI, team, points and time. Location pings are kept for check-in validation and deleted after 24 h; no routes are stored.

## Known data issue (for `build_poi.py`)

About 100 POIs have an `orp_code` that is not a 4-digit ORP code (municipality codes like `574538`, NUTS codes like `CZ0525`, or `#N/A`). The dashboard groups them under "Neurčeno".
