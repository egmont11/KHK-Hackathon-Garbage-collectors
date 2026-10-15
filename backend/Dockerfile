# Backend Krajánek (Fastify + TypeScript přes tsx). Build context = kořen repa (kvůli data/).
FROM node:22-alpine
WORKDIR /app/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend/ ./
COPY data/poi.geojson /app/data/poi.geojson
ENV HOST=0.0.0.0 PORT=3001 POI_FILE=/app/data/poi.geojson
EXPOSE 3001
USER node
CMD ["node", "--import", "tsx", "src/server.ts"]
