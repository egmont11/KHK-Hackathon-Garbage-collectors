# Frontend Krajánek: statický build (PWA) servírovaný Caddy, které předává /api a dashboard na backend.
# Build context = kořen repa (vite.config.js přibaluje ../data/*.geojson).
FROM node:22-alpine AS build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
# --include=dev: vite je v devDependencies
RUN npm ci --include=dev --no-audit --no-fund
COPY frontend/ ./
COPY data/poi.geojson data/stops.geojson /app/data/
RUN npx vite build

FROM caddy:2.8-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/frontend/dist /srv
