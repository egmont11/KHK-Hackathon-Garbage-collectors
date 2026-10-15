# Turisťák backend

REST API for the MVP, implemented with Fastify and TypeScript. It loads the shared POI GeoJSON from `data/poi.geojson` at startup. If that file has not been generated yet, the API starts with an empty catalog and reports `poi_count: 0` from `/health`.

## Run

```powershell
cd backend
npm install
npm run dev
```

The API listens on port `3001`. Set `POI_FILE`, `PORT`, `HOST`, `CHECKIN_SECONDS`, or `DEMO_SEASON_SECONDS` to override defaults. A demo season can be shortened with `DEMO_SEASON_SECONDS=300`.

## Authentication

`POST /api/players` returns a bearer token. Pass it as `Authorization: Bearer <token>` to all check-in endpoints. Visit statistics contain only POI, team, and timestamp aggregates; location pings are retained only for check-in validation and pruned after 24 hours.

## Implementation status

The current store is in-memory for quick mock API and demo integration. It resets on process restart. Replace `MemoryStore` with the PostgreSQL repository before using this as a persistent service. Active event listing currently returns an empty array; event generation is stretch scope.
