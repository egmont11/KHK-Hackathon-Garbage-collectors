import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { config, teams, type TeamId } from "./config.js";
import { distanceM, validCoordinates } from "./geo.js";
import { publicSeason, SeasonManager } from "./seasons.js";
import { MemoryStore, type Player } from "./store.js";
import type { Checkin, Feature, FeatureCollection, Poi, Stop } from "./types.js";

async function loadPois(): Promise<{ pois: Map<string, Poi>; features: Map<string, Feature> }> {
  const path = resolve(process.cwd(), config.poiFile);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as FeatureCollection;
    if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) throw new Error("soubor není GeoJSON FeatureCollection");
    return {
      pois: new Map(parsed.features.map((feature) => [feature.properties.id, feature.properties])),
      features: new Map(parsed.features.map((feature) => [feature.properties.id, feature])),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      console.warn(`POI data nebyla nalezena (${path}); API poběží s prázdným katalogem.`);
      return { pois: new Map(), features: new Map() };
    }
    throw error;
  }
}

const { pois, features: poiFeatures } = await loadPois();
const store = new MemoryStore(pois);
const seasons = new SeasonManager(store);
const app = Fastify({ logger: true });
await app.register(cors, { origin: true, allowedHeaders: ["content-type", "authorization"] });

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function bearerPlayer(request: FastifyRequest): Player | undefined {
  const header = request.headers.authorization;
  return store.playerForToken(header?.startsWith("Bearer ") ? header.slice(7) : undefined);
}

function poiFeature(poi: Poi): Feature {
  const feature = poiFeatures.get(poi.id);
  if (!feature) throw new Error(`Missing feature for ${poi.id}`);
  return {
    type: "Feature",
    geometry: feature.geometry,
    properties: { ...poi, last_team: store.latestTeam(poi.id), visits: store.visitCount(poi.id) },
  };
}

function pointFor(poiId: string) {
  const coordinates = poiFeatures.get(poiId)?.geometry.coordinates;
  return coordinates ? { lat: coordinates[1], lon: coordinates[0] } : undefined;
}

function parseNumber(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseStop(value: unknown): Stop | null {
  if (!value || typeof value !== "object") return null;
  const stop = value as Partial<Stop>;
  if (typeof stop.name !== "string" || (stop.type !== "bus" && stop.type !== "train")
    || typeof stop.distance_m !== "number" || typeof stop.lat !== "number" || typeof stop.lon !== "number") return null;
  return stop as Stop;
}

app.get("/health", async () => ({ status: "ok", poi_count: pois.size }));

app.get<{ Querystring: { bbox?: string; category?: string; min_points?: string; max_points?: string; near?: string; radius_m?: string } }>("/api/poi", async (request, reply) => {
  const { bbox, category, near, radius_m: radiusRaw } = request.query;
  const minPoints = parseNumber(request.query.min_points);
  const maxPoints = parseNumber(request.query.max_points);
  const radius = parseNumber(radiusRaw);
  let bounds: [number, number, number, number] | undefined;
  if (bbox) {
    const values = bbox.split(",").map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value)) || values[0] > values[2] || values[1] > values[3]) {
      return fail(reply, 400, "INVALID_BBOX", "bbox musí být west,south,east,north.");
    }
    bounds = values as [number, number, number, number];
  }
  let center: { lat: number; lon: number } | undefined;
  if (near) {
    const values = near.split(",").map(Number);
    if (values.length !== 2 || values.some((value) => !Number.isFinite(value)) || values[0] < -90 || values[0] > 90 || values[1] < -180 || values[1] > 180) {
      return fail(reply, 400, "INVALID_NEAR", "near musí být lat,lon.");
    }
    center = { lat: values[0], lon: values[1] };
    if (radius === undefined || radius < 0) return fail(reply, 400, "INVALID_RADIUS", "Při near zadej nezáporné radius_m.");
  }
  const categories = category?.split(",").map((item) => item.trim()).filter(Boolean);
  const features = [...pois.values()].filter((poi) => {
    const coordinates = poiFeatures.get(poi.id)?.geometry.coordinates;
    if (!coordinates || coordinates.length < 2) return false;
    const [lon, lat] = coordinates;
    if (bounds && (lon < bounds[0] || lat < bounds[1] || lon > bounds[2] || lat > bounds[3])) return false;
    if (categories?.length && !categories.includes(poi.category)) return false;
    if (minPoints !== undefined && poi.points < minPoints) return false;
    if (maxPoints !== undefined && poi.points > maxPoints) return false;
    if (center && distanceM(center, { lat, lon }) > radius!) return false;
    return true;
  }).map(poiFeature);
  return { type: "FeatureCollection", features };
});

app.get<{ Params: { id: string } }>("/api/poi/:id", async (request, reply) => {
  const poi = pois.get(request.params.id);
  if (!poi) return fail(reply, 404, "POI_NOT_FOUND", "Místo nebylo nalezeno.");
  const visits = store.visits.filter((visit) => visit.poiId === poi.id);
  const latestVisit = visits.at(-1);
  return {
    ...poi,
    last_team: store.latestTeam(poi.id),
    visits: visits.length,
    last_visited_at: latestVisit ? new Date(latestVisit.at).toISOString() : null,
    nearest_bus_stop: parseStop(poi.nearest_bus_stop) ?? (poi.nearest_stop?.type === "bus" ? poi.nearest_stop : null),
    nearest_train_stop: parseStop(poi.nearest_train_stop) ?? (poi.nearest_stop?.type === "train" ? poi.nearest_stop : null),
  };
});

app.post<{ Body: { name?: string; team?: string } }>("/api/players", async (request, reply) => {
  const rawName = request.body?.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const team = request.body?.team;
  if (!name || name.length > 40) return fail(reply, 400, "INVALID_NAME", "Jméno musí mít 1 až 40 znaků.");
  if (!team || !Object.hasOwn(teams, team)) return fail(reply, 400, "INVALID_TEAM", "Tým musí být hory, reky, nebo lesy.");
  const player = store.addPlayer(name, team as TeamId);
  return reply.code(201).send({ player_id: player.id, token: player.token });
});

app.post<{ Body: { poi_id?: string; lat?: number; lon?: number; accuracy_m?: number } }>("/api/checkins/start", async (request, reply) => {
  const player = bearerPlayer(request);
  if (!player) return fail(reply, 401, "UNAUTHORIZED", "Chybí nebo je neplatný hráčský token.");
  const { poi_id: poiId, accuracy_m: accuracy } = request.body ?? {};
  const position = request.body && { lat: request.body.lat, lon: request.body.lon };
  if (typeof poiId !== "string" || !position || !validCoordinates(position) || typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0) {
    return fail(reply, 400, "INVALID_CHECKIN", "Zadej poi_id, platnou polohu a accuracy_m.");
  }
  const poi = pois.get(poiId);
  if (!poi) return fail(reply, 404, "POI_NOT_FOUND", "Místo nebylo nalezeno.");
  const season = seasons.current();
  if (store.hasVisited(player.id, poiId, season.id)) return fail(reply, 409, "ALREADY_VISITED", "Toto místo už jste v této sezóně obsadili.");
  const target = pointFor(poiId);
  if (!target || typeof target.lat !== "number" || typeof target.lon !== "number") return fail(reply, 500, "INVALID_POI_COORDINATES", "Místo nemá platné souřadnice.");
  const timestamp = Date.now();
  const inside = distanceM(position, target) <= config.checkinRadiusM && accuracy <= config.maxAccuracyM;
  const checkin: Checkin = {
    id: randomUUID(), playerId: player.id, poiId, seasonId: season.id, startedAt: timestamp,
    finishedAt: null, valid: inside, awardedPoints: 0,
    pings: [{ ...position, accuracy_m: accuracy, ts: timestamp }], streakStartedAt: inside ? timestamp : null,
    lastTeam: null,
  };
  store.checkins.set(checkin.id, checkin);
  return reply.code(201).send({ checkin_id: checkin.id, required_seconds: config.requiredCheckinSeconds });
});

app.post<{ Params: { id: string }; Body: { lat?: number; lon?: number; accuracy_m?: number } }>("/api/checkins/:id/ping", async (request, reply) => {
  const player = bearerPlayer(request);
  if (!player) return fail(reply, 401, "UNAUTHORIZED", "Chybí nebo je neplatný hráčský token.");
  const checkin = store.checkins.get(request.params.id);
  if (!checkin || checkin.playerId !== player.id) return fail(reply, 404, "CHECKIN_NOT_FOUND", "Check-in nebyl nalezen.");
  if (checkin.finishedAt) return fail(reply, 409, "CHECKIN_FINISHED", "Check-in už byl ukončen.");
  const position = request.body && { lat: request.body.lat, lon: request.body.lon };
  const accuracy = request.body?.accuracy_m;
  if (!position || !validCoordinates(position) || typeof accuracy !== "number" || !Number.isFinite(accuracy) || accuracy < 0) {
    return fail(reply, 400, "INVALID_PING", "Zadej platnou polohu a accuracy_m.");
  }
  const now = Date.now();
  const target = pointFor(checkin.poiId)!;
  const previous = checkin.pings.at(-1);
  let inRange = distanceM(position, target) <= config.checkinRadiusM && accuracy <= config.maxAccuracyM;
  if (previous) {
    const seconds = (now - previous.ts) / 1000;
    if (seconds <= 0) return fail(reply, 400, "PING_TOO_SOON", "Počkej před dalším pingem.");
    if (seconds > config.maxPingGapSeconds) checkin.streakStartedAt = null;
    const speedKmh = distanceM(previous, position) / seconds * 3.6;
    if (speedKmh >= config.maxSpeedKmh) inRange = false;
  }
  checkin.pings.push({ ...position, accuracy_m: accuracy, ts: now });
  if (!inRange) checkin.streakStartedAt = null;
  else if (checkin.streakStartedAt === null) checkin.streakStartedAt = now;
  checkin.valid = inRange;
  return { elapsed_s: checkin.streakStartedAt === null ? 0 : Math.floor((now - checkin.streakStartedAt) / 1000), valid: inRange };
});

app.post<{ Params: { id: string } }>("/api/checkins/:id/finish", async (request, reply) => {
  const player = bearerPlayer(request);
  if (!player) return fail(reply, 401, "UNAUTHORIZED", "Chybí nebo je neplatný hráčský token.");
  const checkin = store.checkins.get(request.params.id);
  if (!checkin || checkin.playerId !== player.id) return fail(reply, 404, "CHECKIN_NOT_FOUND", "Check-in nebyl nalezen.");
  if (checkin.finishedAt) return fail(reply, 409, "CHECKIN_FINISHED", "Check-in už byl ukončen.");
  const now = Date.now();
  const lastPing = checkin.pings.at(-1);
  if (checkin.streakStartedAt === null || !lastPing || (now - lastPing.ts) / 1000 > config.maxPingGapSeconds
    || (now - checkin.streakStartedAt) / 1000 < config.requiredCheckinSeconds) {
    return fail(reply, 409, "CHECKIN_INCOMPLETE", `Check-in ještě nesplnil souvislých ${config.requiredCheckinSeconds} sekund. Pokračujte v posílání polohy.`);
  }
  const season = seasons.current(now);
  if (season.id !== checkin.seasonId) return fail(reply, 409, "SEASON_CHANGED", "Sezóna se během check-inu změnila. Začněte znovu.");
  if (store.hasVisited(player.id, checkin.poiId, season.id)) return fail(reply, 409, "ALREADY_VISITED", "Toto místo už jste v této sezóně obsadili.");
  const poi = pois.get(checkin.poiId)!;
  const points = store.award(player, checkin, poi);
  return { awarded_points: points, team_score: store.ranking(season.id).find((row) => row.team === player.team)?.score ?? points };
});

app.get("/api/teams", async () => {
  const season = seasons.current();
  const memberCounts = new Map<TeamId, number>();
  for (const player of store.players.values()) memberCounts.set(player.team, (memberCounts.get(player.team) ?? 0) + 1);
  return store.ranking(season.id).map(({ team, score }) => ({ team, score, members: memberCounts.get(team) ?? 0 }));
});

app.get("/api/seasons/current", async () => publicSeason(seasons.current()));
app.get("/api/seasons/history", async () => seasons.history());
app.get("/api/events/active", async () => []);

app.get<{ Querystring: { from?: string; to?: string } }>("/api/stats/poi", async (request, reply) => {
  const from = request.query.from ? Date.parse(request.query.from) : -Infinity;
  const to = request.query.to ? Date.parse(request.query.to) : Infinity;
  if (!Number.isFinite(from) && from !== -Infinity || !Number.isFinite(to) && to !== Infinity || from > to) {
    return fail(reply, 400, "INVALID_DATE_RANGE", "from a to musí být platné datumy v ISO formátu.");
  }
  const visits = store.visits.filter((visit) => visit.at >= from && visit.at <= to);
  const byPoi = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byOrp = new Map<string, number>();
  const byHour = new Map<string, number>();
  for (const visit of visits) {
    byPoi.set(visit.poiId, (byPoi.get(visit.poiId) ?? 0) + 1);
    byCategory.set(visit.category, (byCategory.get(visit.category) ?? 0) + 1);
    if (visit.orpCode) byOrp.set(visit.orpCode, (byOrp.get(visit.orpCode) ?? 0) + 1);
    const hour = new Date(visit.at).toISOString().slice(0, 13) + ":00:00Z";
    byHour.set(hour, (byHour.get(hour) ?? 0) + 1);
  }
  const pairs = (counts: Map<string, number>) => [...counts].map(([key, count]) => ({ key, count }));
  return { total_visits: visits.length, by_poi: pairs(byPoi), by_category: pairs(byCategory), by_orp: pairs(byOrp), by_hour: pairs(byHour) };
});

setInterval(() => store.prunePings(Date.now() - config.pingRetentionHours * 60 * 60 * 1000), 60 * 60 * 1000).unref();

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
