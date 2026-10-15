# Matěj – backend and game: status

Scope taken from [ROZDELENI.md](../ROZDELENI.md) (Backend + hra) and the role C / dashboard parts of [AGENTS.md](../AGENTS.md). Details of every endpoint are in [README.md](README.md).

✅ done · 🟡 partly done · ❌ not done · ⏸ postponed · – decided against

## MVP

| Responsibility | Status | Notes |
|---|---|---|
| API over `poi.geojson` | ✅ | `/api/poi` with filters (bbox, category, group, points, distance, nearest stop within N m, `lite=1`), `/api/poi/:id` with stops and IDOS link, `/api/categories` |
| Database | ✅ | PostgreSQL via `DATABASE_URL`; tables from AGENTS.md plus `admins`; schema applied on startup. Works in memory without a DB |
| Teams and players | ✅ | Hory / Řeky / Lesy, `POST /api/players` → token, `/api/players/me`, `/api/teams` with members |
| Check-in with GPS check | ✅ | 100 m radius, accuracy ≤ 50 m, ping at least every 15 s, ≥ 60 s unbroken, speed < 30 km/h, once per player per POI per season |
| Points | ✅ | POI `points` (from Karel's scoring), × event multiplier |
| Seasons | ✅ | Calendar quarter, lazy rollover (no cron), history of winners, `DEMO_SEASON_SECONDS` for short demo seasons, restart-safe with DB |
| `/api/stats` | ✅ | `/api/stats/poi`: by POI, category, group, ORP, hour, day, hour of day, team; top POIs; heatmap points |
| Privacy | ✅ | Stats store only POI, time, team and points; no routes; location pings deleted after 24 h |
| Region dashboard – heatmap | ✅ | `/dashboard`: heatmap with top places and bonus places |
| Region dashboard – charts | ✅ | KPIs, visits per day, by hour of day, by category, by ORP, top 15 table, period filter, refreshes every 10 s |
| Stats behind admin login | ✅ | Built-in `admin`, password printed on first start, forced change on first login, admin management, CSV export, "end season" button |
| Demo data | ✅ | `npm run demo` seeds ~800 made-up visits (memory mode only) |
| Automated test | ✅ | `npm test`: onboarding → check-in → leaderboard → admin → stats → season end |

## Stretch goals

| Responsibility | Status | Notes |
|---|---|---|
| Quick time events (working name) – weekly | ✅ | 3 random bonus places at least 50 km apart, ×2, Monday to Monday; shown on the map and dashboard |
| Quick time events – daily | ✅ | One category per day (e.g. lookout towers) is worth ×1.4 at every place of that category |
| Events from cultural events with the region's patronage (layer 4) | – | Decided: not doing it |
| Team battles over a POI | ✅ | Cosmetic only: the team with the most check-ins this season owns the place (map colour); on a tie the holder keeps it. `owner_team` on every POI, "Území týmů" layer on the dashboard |
| "Most players from one team" bonus | – | Decided: not a separate feature, team battles cover it |
| Badges | ✅ | 14 badges (+2 tiers), cosmetic, per season, archived in the player's profile; `/api/players/me`, `new_badges` on finish |
| Hiking and cycling trails | ⏸ | Skipped for now, may come back later |
| Dashboard comparison with official data | – | Decided: the dashboard shows only data collected from players |
| Dashboard: visits by category / ORP over time | ✅ | "Vývoj v čase": check-ins per day for a chosen category or ORP, days with that category's daily bonus highlighted |

## Shared with Karel – pitch and demo

| Responsibility | Status | Notes |
|---|---|---|
| Demo scenario | ❌ | Suggested backend settings: `CHECKIN_SECONDS=10`, `DEMO_SEASON_SECONDS=300`, `npm run demo` |
| Frontend connected to the API | ❌ | Karel's part. Stats now need an admin token (`POST /api/admin/login`), or he can just link to `/dashboard` |
| Run on a team member's machine | ❌ | Tested only in the cloud sandbox (Node 22 + PostgreSQL 16), not yet on Windows |
| Hosting for the demo | ❌ | Not set up |
| Bug fixes during the demo | – | Ongoing |

## Known limitations

| Item | Status | Notes |
|---|---|---|
| Admin sessions in memory | 🟡 | A server restart logs admins out |
| Running check-ins in memory | 🟡 | Unfinished check-ins are dropped on restart (by design) |
| Season boundaries in UTC | 🟡 | A quarter starts at 01:00/02:00 Prague time, not midnight |
| Bad ORP codes in `poi.geojson` | 🟡 | About 100 POIs have an invalid `orp_code`; the dashboard shows them as "Neurčeno". Needs a fix in `build_poi.py` (Karel) |
