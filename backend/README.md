# Krajánek backend

REST API + region dashboard, Fastify + TypeScript. What's done and what isn't: [STATUS.md](STATUS.md). Loads `data/poi.geojson` at startup (missing file → empty catalog, `/health` reports `poi_count: 0`).

## Run

```powershell
cd backend
npm install
npm run demo     # in-memory, 800 synthetic visits, 10 s check-in, private admin bootstrap file
npm run dev      # in-memory, empty, auto-reload
npm test         # end-to-end smoke test (onboarding → check-in → leaderboard → stats)
```

- API: `http://localhost:3001/api/...`
- Region dashboard: `http://localhost:3001/dashboard` (admin login; API is always same-origin)

### Admin account

On first start the server creates the built-in `admin`. Set a strong `ADMIN_PASSWORD` (required in production). Local development without it writes a random password to `.admin-initial-password` with mode 0600; the password is never logged. The local credential file is reused across in-memory restarts and must stay private. Every configured initial password is validated, including when `ADMIN_MUST_CHANGE=0` is explicitly set.

The first login requires a password change (at least 10 characters, letters and digits). `ADMIN_RESET=1` performs a deliberate one-time reset; remove it after use. Production refuses an existing legacy `admin/admin` account until that reset is performed with a strong secret.

Admin sessions expire after 12 hours by default. They bind to the password hash used during login; password changes and deletion invalidate sessions on other backend instances as well. Authentication always reads current admin state from PostgreSQL when configured.

### Environment

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3001`, `127.0.0.1` | listen address |
| `POI_FILE` | `../data/poi.geojson` | POI catalog |
| `DATABASE_URL` | – | PostgreSQL; without it everything lives in memory |
| `CHECKIN_SECONDS` | `60` | required continuous time at a POI (use `10` for the pitch) |
| `CHECKIN_RADIUS_M`, `MAX_ACCURACY_M` | `100`, `50` | check-in geofence and minimum GPS accuracy |
| `DEMO_SEASON_SECONDS` | – | short seasons for the demo (e.g. `300`); default = calendar quarter |
| `WEEKLY_EVENT_COUNT`, `WEEKLY_MULTIPLIER`, `WEEKLY_MIN_DISTANCE_KM` | `3`, `2`, `50` | weekly bonus places |
| `DAILY_MULTIPLIER` | `1.4` | daily bonus category |
| `WEEKLY_EVENT_SECONDS`, `DAILY_EVENT_SECONDS` | 1 week, 1 day (½ and ⅙ of a demo season) | round lengths; full days start at midnight Prague time, weeks on Monday. `EVENTS=0` disables events |
| `ADMIN_USERNAME` | `admin` | built-in admin login |
| `ADMIN_PASSWORD` | random private local file; required in production | initial admin password |
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
| `GET /api/poi` | GeoJSON. Filters: `bbox=w,s,e,n`, `category=a,b`, `group=a,b`, `min_points`, `max_points`, `near=lat,lon` (+ optional `radius_m`; adds `distance_m`, sorted by distance), `max_stop_m` (stop within N m). `lite=1` returns only id/name/category/group/municipality/points/is_nkp (much smaller payload). `bonus=1` returns only places with an active bonus; `owner=hory,reky,lesy,none` filters by owning team. Live props: `owner_team` (use this for the marker colour), `team_checkins` `{hory, reky, lesy}`, `team_points` `{hory, reky, lesy}` (points earned at the place this season), `top_team` (most points; tie keeps the leader), `last_team`, `visits`, `event_multiplier`, `event_type`, `bonus_points`. |
| `GET /api/poi/:id` | Detail + `lat`, `lon`, `last_team`, `visits`, `last_visited_at` (always null publicly), `nearest_bus_stop`, `nearest_train_stop`, `idos_url`, `event`. |
| `GET /api/categories` | Groups and categories with labels and counts (for the filter UI). |
| `POST /api/players` `{name, team, password}` | → `{player_id, token, name, team}`. Name unique (case-insensitive) → `409 NAME_TAKEN`; password ≥ 6 chars (scrypt hash) |
| `POST /api/players/login` `{name, password}` | → `{player_id, token, name, team}` (same token as at registration). Wrong → `401 INVALID_CREDENTIALS`; 5 failures per IP → locked for 1 min (`429`) |
| `GET /api/players/me` | → name, team, `season_points`, `visited[]` in the current season, `badges` (all badges with `progress`/`target`/`earned`), `badge_archive` (earned badges of earlier seasons). |
| `GET /api/badges` | badge definitions `{id, name, description, target}` |
| `POST /api/checkins/start` `{poi_id, lat, lon, accuracy_m}` | → `{checkin_id, required_seconds, valid, distance_m, radius_m, max_ping_gap_s, points, multiplier, reason}` |
| `POST /api/checkins/:id/ping` `{lat, lon, accuracy_m}` | every ~5 s → `{elapsed_s, remaining_s, valid, can_finish, distance_m, reason}`; `reason` is `OUT_OF_RANGE`, `LOW_ACCURACY` or `TOO_FAST`. |
| `POST /api/checkins/:id/finish` | empty body OK → `{awarded_points, base_points, multiplier, team, team_score}` |
| `GET /api/teams` | `[{team, name, color, score, members, owned_pois}]` for the current season |
| `GET /api/players/top?limit=10` | top players of the current season: `[{player_id, name, team, points, places}]` |
| `GET /api/seasons/current` | `{season_id, starts_at, ends_at, remaining_s}` |
| `GET /api/seasons/history` | finished seasons, newest first |
| `GET /api/events/active` | `{weekly: [{poi_id, poi_name, …, reward, players: {hory, reky, lesy}, leader}], daily: {category, category_label, multiplier, completed, …} (personal, needs player token, else null), last_week: [{poi_id, poi_name, reward, players, leader}]}`. Weekly team quests: the team with most players claiming the place during the week wins `reward` (default 200) for the season, settled lazily after the week; ties go to the team that got there first. Daily quest is personal: first place of the category that day ×1.4 |

### Admin (region staff)

| Endpoint | Notes |
|---|---|
| `POST /api/admin/login` `{username, password}` | → `{token, expires_at, username, must_change_password}`. 5 attempts per IP + username per minute, reserved before hashing (`429`). |
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

## Security and deployment

See [security-fixes.md](../docs/security-fixes.md) for the audit mapping and residual GPS / human identity limitations.

- `NODE_ENV=production` rejects HTTP except `/health`. Forwarding headers are accepted only from explicit `TRUSTED_PROXIES` addresses/CIDRs; do not use a blanket trust setting on a public backend. `CORS_ORIGINS` is an explicit comma-separated allowlist, empty by default.
- `npm run demo` refuses PostgreSQL and production mode. Clickable frontend `?demo=1` uses a separate browser mock and separate local storage; it never submits to the real API. Production builds ignore demo/mock query parameters unless explicitly built with `VITE_DEMO=1`.
- Registration: `REGISTRATIONS_PER_HOUR=5` per IP; `MAX_PLAYERS=10000` total. General API limit 300/min/IP, map limit 60/min/IP, check-in starts 10/min/player. All limits reserve synchronously before asynchronous work and use a bounded key store; hashing has at most 16 in-flight jobs. Limits are per process; the game store still requires one serving backend instance for coherent in-memory game state.
- Player tokens contain 256 random bits. Only SHA-256 digests are stored; `PLAYER_SESSION_HOURS=168` controls expiry. Each successful login rotates the token (one active token per player). `POST /api/players/logout` revokes it server-side. Clients must keep the newly returned token.
- Schema migration expires legacy plaintext player tokens without deleting players, hashes, scores or history. Existing players log in again. Legacy players created without passwords cannot log in and require an operator-supported account recovery decision.
- Abandoned check-ins are deleted from PostgreSQL during replacement and cleanup, with their pings cascading. Public POI detail keeps `last_visited_at: null`; private profile and administrative exports retain necessary timestamps. Public team aggregates can still reveal changes under polling.
- The dashboard ignores `?api`, uses a hash-based CSP, denies framing, and renders tooltip labels as text. CSV exports neutralize spreadsheet formula prefixes.
