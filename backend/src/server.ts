import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { config, groupLabels, orpNames, teamIds, teams, type TeamId } from "./config.js";
import { EventManager } from "./events.js";
import { distanceM, validCoordinates } from "./geo.js";
import { publicSeason, SeasonManager } from "./seasons.js";
import { MemoryStore, type Player } from "./store.js";
import type { Checkin, Feature, FeatureCollection, Poi, Stop } from "./types.js";

async function loadPois(): Promise<{ pois: Map<string, Poi>; features: Map<string, Feature> }> {
  const path = resolve(process.cwd(), config.poiFile);
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as FeatureCollection;
    if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) throw new Error("soubor není GeoJSON FeatureCollection");
    const valid = parsed.features.filter((feature) => feature?.properties?.id && Array.isArray(feature.geometry?.coordinates)
      && Number.isFinite(feature.geometry.coordinates[0]) && Number.isFinite(feature.geometry.coordinates[1]));
    return {
      pois: new Map(valid.map((feature) => [feature.properties.id, feature.properties])),
      features: new Map(valid.map((feature) => [feature.properties.id, feature])),
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
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : undefined;
if (pool) {
  const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
  await pool.query(schema);
}
const store = new MemoryStore(pois, pool);
await store.initialize();
const seasons = new SeasonManager(store);
const events = new EventManager(pois.values(), pool);
if (config.demoSeedVisits > 0) {
  if (pool) console.warn("DEMO_SEED se s DATABASE_URL ignoruje (syntetická data se do DB nezapisují).");
  else {
    const season = seasons.current();
    store.seedDemo(config.demoSeedVisits, season.id, Math.max(season.startsAt, Date.now() - 30 * 86400000));
  }
}
/** Bonus multiplier that was active when a check-in started (honoured if the event ends mid check-in). */
const startMultipliers = new Map<string, number>();

const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
await app.register(cors, { origin: true, allowedHeaders: ["content-type", "authorization"] });
if (pool) app.addHook("onClose", async () => { await pool.end(); });

// Accept POSTs with `content-type: application/json` and an empty body (e.g. /finish from fetch()).
app.removeContentTypeParser("application/json");
app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
  const text = typeof body === "string" ? body.trim() : "";
  if (!text) return done(null, {});
  try { done(null, JSON.parse(text)); } catch {
    const error = new Error("Tělo požadavku není platný JSON.") as Error & { statusCode: number; code: string };
    error.statusCode = 400; error.code = "INVALID_JSON";
    done(error, undefined);
  }
});

app.setErrorHandler((error: Error & { statusCode?: number; code?: string }, request, reply) => {
  const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
  if (status >= 500) request.log.error(error);
  reply.code(status).send({ error: { code: status >= 500 ? "INTERNAL_ERROR" : error.code ?? "BAD_REQUEST", message: status >= 500 ? "Něco se pokazilo na serveru." : error.message } });
});
app.setNotFoundHandler((_request, reply) => fail(reply, 404, "NOT_FOUND", "Endpoint neexistuje."));

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function bearerPlayer(request: FastifyRequest): Player | undefined {
  const header = request.headers.authorization;
  return store.playerForToken(header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined);
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

function idosUrl(poi: Poi): string | null {
  if (typeof poi.idos_url === "string" && poi.idos_url) return poi.idos_url;
  const stop = parseStop(poi.nearest_stop);
  return stop ? `https://idos.cz/vlakyautobusy/spojeni/?f=&t=${encodeURIComponent(stop.name)}` : null;
}

/** Live state merged into POI properties. */
function liveState(poi: Poi) {
  const multiplier = events.multiplierFor(poi.id);
  return {
    last_team: store.latestTeam(poi.id),
    visits: store.visitCount(poi.id),
    event_multiplier: multiplier > 1 ? multiplier : null,
  };
}

function publicEvent(event: ReturnType<typeof events.active>[number]) {
  const poi = pois.get(event.poi_id);
  const point = pointFor(event.poi_id);
  return {
    id: event.id, type: event.type, poi_id: event.poi_id, multiplier: event.multiplier,
    starts_at: new Date(event.startsAt).toISOString(), ends_at: new Date(event.endsAt).toISOString(),
    poi_name: poi?.name ?? null, category_label: poi?.category_label ?? poi?.category ?? null,
    municipality: poi?.municipality ?? null, lat: point?.lat ?? null, lon: point?.lon ?? null,
    base_points: poi?.points ?? 0, bonus_points: Math.round((poi?.points ?? 0) * event.multiplier),
  };
}

async function syncSeason() {
  const current = seasons.current();
  await store.ensureSeasons(current, store.history);
  return current;
}

function teamTable(seasonId: string) {
  const memberCounts = new Map<TeamId, number>();
  for (const player of store.players.values()) memberCounts.set(player.team, (memberCounts.get(player.team) ?? 0) + 1);
  return store.ranking(seasonId).map(({ team, score }) => ({
    team, name: teams[team].name, color: teams[team].color, score, members: memberCounts.get(team) ?? 0,
  }));
}

app.get("/health", async () => ({ status: "ok", poi_count: pois.size, persistence: pool ? "postgres" : "memory" }));

const liteFields = ["id", "name", "category", "category_label", "group", "municipality", "points", "is_nkp"] as const;

app.get<{ Querystring: { bbox?: string; category?: string; group?: string; min_points?: string; max_points?: string; near?: string; radius_m?: string; max_stop_m?: string; lite?: string } }>("/api/poi", async (request, reply) => {
  const { bbox, category, group, near, radius_m: radiusRaw } = request.query;
  const minPoints = parseNumber(request.query.min_points);
  const maxPoints = parseNumber(request.query.max_points);
  const maxStop = parseNumber(request.query.max_stop_m);
  const radius = parseNumber(radiusRaw);
  const lite = request.query.lite === "1" || request.query.lite === "true";
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
    if (radius !== undefined && radius < 0) return fail(reply, 400, "INVALID_RADIUS", "radius_m musí být nezáporné.");
  }
  const categories = category?.split(",").map((item) => item.trim()).filter(Boolean);
  const groups = group?.split(",").map((item) => item.trim()).filter(Boolean);
  const features: Feature[] = [];
  for (const poi of pois.values()) {
    const feature = poiFeatures.get(poi.id)!;
    const [lon, lat] = feature.geometry.coordinates;
    if (bounds && (lon < bounds[0] || lat < bounds[1] || lon > bounds[2] || lat > bounds[3])) continue;
    if (categories?.length && !categories.includes(poi.category)) continue;
    if (groups?.length && !groups.includes(poi.group ?? "ostatni")) continue;
    if (minPoints !== undefined && poi.points < minPoints) continue;
    if (maxPoints !== undefined && poi.points > maxPoints) continue;
    if (maxStop !== undefined && !((parseStop(poi.nearest_stop)?.distance_m ?? Infinity) <= maxStop)) continue;
    let distance: number | undefined;
    if (center) {
      distance = Math.round(distanceM(center, { lat, lon }));
      if (radius !== undefined && distance > radius) continue;
    }
    const base = lite ? Object.fromEntries(liteFields.map((key) => [key, poi[key] ?? null])) as Poi : poi;
    features.push({
      type: "Feature",
      geometry: feature.geometry,
      properties: { ...base, ...liveState(poi), ...(distance !== undefined ? { distance_m: distance } : {}) },
    });
  }
  if (center) features.sort((a, b) => (a.properties.distance_m as number) - (b.properties.distance_m as number));
  return { type: "FeatureCollection", features };
});

app.get("/api/categories", async () => {
  const byCategory = new Map<string, { category: string; label: string; group: string; count: number }>();
  for (const poi of pois.values()) {
    const entry = byCategory.get(poi.category) ?? { category: poi.category, label: poi.category_label ?? poi.category, group: poi.group ?? "ostatni", count: 0 };
    entry.count++;
    byCategory.set(poi.category, entry);
  }
  return {
    groups: Object.entries(groupLabels).map(([group, label]) => ({ group, label })),
    categories: [...byCategory.values()].sort((a, b) => a.label.localeCompare(b.label, "cs")),
  };
});

app.get<{ Params: { id: string } }>("/api/poi/:id", async (request, reply) => {
  const poi = pois.get(request.params.id);
  if (!poi) return fail(reply, 404, "POI_NOT_FOUND", "Místo nebylo nalezeno.");
  const lastAt = store.lastVisitedAt(poi.id);
  const event = events.active().find((item) => item.poi_id === poi.id);
  const point = pointFor(poi.id)!;
  return {
    ...poi,
    lat: point.lat,
    lon: point.lon,
    ...liveState(poi),
    last_visited_at: lastAt ? new Date(lastAt).toISOString() : null,
    nearest_bus_stop: parseStop(poi.nearest_bus_stop) ?? parseStop(poi.nearest_bus) ?? (poi.nearest_stop?.type === "bus" ? poi.nearest_stop : null),
    nearest_train_stop: parseStop(poi.nearest_train_stop) ?? parseStop(poi.nearest_train) ?? (poi.nearest_stop?.type === "train" ? poi.nearest_stop : null),
    idos_url: idosUrl(poi),
    event: event ? publicEvent(event) : null,
  };
});

app.post<{ Body: { name?: string; team?: string } }>("/api/players", async (request, reply) => {
  const rawName = request.body?.name;
  const name = typeof rawName === "string" ? rawName.trim() : "";
  const team = request.body?.team;
  if (!name || name.length > 40) return fail(reply, 400, "INVALID_NAME", "Jméno musí mít 1 až 40 znaků.");
  if (typeof team !== "string" || !Object.hasOwn(teams, team)) return fail(reply, 400, "INVALID_TEAM", "Tým musí být hory, reky, nebo lesy.");
  const player = await store.addPlayer(name, team as TeamId);
  return reply.code(201).send({ player_id: player.id, token: player.token, name: player.name, team: player.team });
});

app.get("/api/players/me", async (request, reply) => {
  const player = bearerPlayer(request);
  if (!player) return fail(reply, 401, "UNAUTHORIZED", "Chybí nebo je neplatný hráčský token.");
  const season = await syncSeason();
  const visited = store.visitedBy(player.id, season.id);
  return {
    player_id: player.id, name: player.name, team: player.team,
    season_id: season.id,
    season_points: visited.reduce((sum, visit) => sum + visit.points, 0),
    visited: visited.map((visit) => ({ poi_id: visit.poiId, points: visit.points, at: new Date(visit.at).toISOString() })),
  };
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
  const season = await syncSeason();
  if (store.hasVisited(player.id, poiId, season.id)) return fail(reply, 409, "ALREADY_VISITED", "Toto místo už jste v této sezóně obsadili.");
  const target = pointFor(poiId)!;
  const timestamp = Date.now();
  const distance = distanceM(position, target);
  const inside = distance <= config.checkinRadiusM && accuracy <= config.maxAccuracyM;
  // One running check-in per player: starting a new one abandons the previous.
  for (const [id, other] of store.checkins) if (other.playerId === player.id && other.finishedAt === null) { store.checkins.delete(id); startMultipliers.delete(id); }
  const checkin: Checkin = {
    id: randomUUID(), playerId: player.id, poiId, seasonId: season.id, startedAt: timestamp,
    finishedAt: null, valid: inside, awardedPoints: 0,
    pings: [{ ...position, accuracy_m: accuracy, ts: timestamp }], streakStartedAt: inside ? timestamp : null,
    lastTeam: null,
  };
  await store.recordCheckinStart(checkin, checkin.pings[0]);
  store.checkins.set(checkin.id, checkin);
  const multiplier = events.multiplierFor(poiId, timestamp);
  if (multiplier > 1) startMultipliers.set(checkin.id, multiplier);
  return reply.code(201).send({
    checkin_id: checkin.id, required_seconds: config.requiredCheckinSeconds,
    valid: inside, distance_m: Math.round(distance), radius_m: config.checkinRadiusM,
    max_ping_gap_s: config.maxPingGapSeconds, points: Math.round(poi.points * multiplier), multiplier,
    reason: inside ? null : accuracy > config.maxAccuracyM ? "LOW_ACCURACY" : "OUT_OF_RANGE",
  });
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
  const distance = distanceM(position, target);
  let reason: string | null = null;
  if (accuracy > config.maxAccuracyM) reason = "LOW_ACCURACY";
  else if (distance > config.checkinRadiusM) reason = "OUT_OF_RANGE";
  if (previous) {
    const seconds = (now - previous.ts) / 1000;
    if (seconds < 1) return fail(reply, 429, "PING_TOO_SOON", "Počkej před dalším pingem.");
    if (seconds > config.maxPingGapSeconds) { checkin.streakStartedAt = null; reason ??= "PING_GAP"; }
    // GPS jitter tolerance: ignore movement within the reported accuracy.
    const moved = Math.max(0, distanceM(previous, position) - Math.max(previous.accuracy_m, accuracy));
    if (moved / seconds * 3.6 >= config.maxSpeedKmh) reason = "TOO_FAST";
  }
  const inRange = reason === null || reason === "PING_GAP";
  const ping = { ...position, accuracy_m: accuracy, ts: now };
  await store.recordPing(checkin.id, ping);
  checkin.pings.push(ping);
  if (checkin.pings.length > 200) checkin.pings.splice(0, checkin.pings.length - 200);
  if (!inRange) checkin.streakStartedAt = null;
  else if (checkin.streakStartedAt === null) checkin.streakStartedAt = now;
  checkin.valid = inRange;
  const elapsed = checkin.streakStartedAt === null ? 0 : Math.floor((now - checkin.streakStartedAt) / 1000);
  return {
    elapsed_s: elapsed, valid: inRange, required_seconds: config.requiredCheckinSeconds,
    remaining_s: Math.max(0, config.requiredCheckinSeconds - elapsed), can_finish: inRange && elapsed >= config.requiredCheckinSeconds,
    distance_m: Math.round(distance), reason: inRange ? null : reason,
  };
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
    || (lastPing.ts - checkin.streakStartedAt) / 1000 < config.requiredCheckinSeconds) {
    return fail(reply, 409, "CHECKIN_INCOMPLETE", `Check-in ještě nesplnil souvislých ${config.requiredCheckinSeconds} sekund. Pokračujte v posílání polohy.`);
  }
  const season = await syncSeason();
  if (season.id !== checkin.seasonId) return fail(reply, 409, "SEASON_CHANGED", "Sezóna se během check-inu změnila. Začněte znovu.");
  if (store.hasVisited(player.id, checkin.poiId, season.id)) return fail(reply, 409, "ALREADY_VISITED", "Toto místo už jste v této sezóně obsadili.");
  const poi = pois.get(checkin.poiId)!;
  const multiplier = Math.max(startMultipliers.get(checkin.id) ?? 1, events.multiplierFor(poi.id, now));
  let points: number;
  try {
    points = await store.award(player, checkin, poi, multiplier);
  } catch (error) {
    if ((error as { code?: string }).code === "23505") return fail(reply, 409, "ALREADY_VISITED", "Toto místo už jste v této sezóně obsadili.");
    throw error;
  }
  startMultipliers.delete(checkin.id);
  return {
    awarded_points: points, base_points: poi.points, multiplier, team: player.team,
    team_score: store.ranking(season.id).find((row) => row.team === player.team)?.score ?? points,
  };
});

app.get("/api/teams", async () => teamTable((await syncSeason()).id));

app.get("/api/seasons/current", async () => publicSeason(await syncSeason()));
app.get("/api/seasons/history", async () => { await syncSeason(); return seasons.history(); });
app.get("/api/events/active", async () => events.active().map(publicEvent));

app.get<{ Querystring: { from?: string; to?: string; season?: string; top?: string } }>("/api/stats/poi", async (request, reply) => {
  let from = request.query.from ? Date.parse(request.query.from) : -Infinity;
  const to = request.query.to ? Date.parse(request.query.to) : Infinity;
  if (Number.isNaN(from) || Number.isNaN(to) || from > to) {
    return fail(reply, 400, "INVALID_DATE_RANGE", "from a to musí být platné datumy v ISO formátu.");
  }
  const current = await syncSeason();
  if (request.query.season === "current") from = Math.max(from, current.startsAt);
  const topN = Math.min(200, Math.max(1, parseNumber(request.query.top) ?? 15));
  const visits = store.visits.filter((visit) => visit.at >= from && visit.at <= to);
  const count = <K>(map: Map<K, number>, key: K, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
  const byPoi = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const byGroup = new Map<string, number>();
  const byOrp = new Map<string, number>();
  const byHour = new Map<string, number>();
  const byDay = new Map<string, number>();
  const hourOfDay = new Array<number>(24).fill(0);
  const teamVisits = new Map<TeamId, number>();
  const teamPoints = new Map<TeamId, number>();
  let gemVisits = 0;
  for (const visit of visits) {
    count(byPoi, visit.poiId);
    count(byCategory, visit.category);
    count(byGroup, visit.group);
    count(byOrp, visit.orpCode && orpNames[visit.orpCode] ? visit.orpCode : "other");
    const iso = new Date(visit.at).toISOString();
    count(byHour, iso.slice(0, 13) + ":00:00Z");
    // Local (Prague) calendar day and hour for the dashboard.
    const local = new Date(visit.at).toLocaleString("sv-SE", { timeZone: "Europe/Prague", hour12: false });
    count(byDay, local.slice(0, 10));
    hourOfDay[Number(local.slice(11, 13)) % 24]++;
    count(teamVisits, visit.team);
    count(teamPoints, visit.team, visit.points);
    if ((pois.get(visit.poiId)?.points ?? 0) >= 30) gemVisits++;
  }
  const pairs = (counts: Map<string, number>) => [...counts].map(([key, value]) => ({ key, count: value })).sort((a, b) => b.count - a.count);
  const categoryLabels = new Map([...pois.values()].map((poi) => [poi.category, poi.category_label ?? poi.category]));
  const poiRows = [...byPoi].sort((a, b) => b[1] - a[1]).map(([poiId, visitsCount]) => {
    const poi = pois.get(poiId);
    const point = pointFor(poiId);
    return {
      poi_id: poiId, name: poi?.name ?? poiId, category: poi?.category ?? null, category_label: poi?.category_label ?? null,
      group: poi?.group ?? null, municipality: poi?.municipality ?? null, points: poi?.points ?? 0,
      lat: point?.lat ?? null, lon: point?.lon ?? null, count: visitsCount, last_team: store.latestTeam(poiId),
    };
  });
  // Days with zero visits are filled in so the time series has no gaps.
  const days = [...byDay.keys()].sort();
  const byDayFilled: { key: string; count: number }[] = [];
  if (days.length) {
    for (let day = new Date(`${days[0]}T12:00:00Z`); day.toISOString().slice(0, 10) <= days.at(-1)!; day.setUTCDate(day.getUTCDate() + 1)) {
      const key = day.toISOString().slice(0, 10);
      byDayFilled.push({ key, count: byDay.get(key) ?? 0 });
    }
  }
  return {
    range: { from: Number.isFinite(from) ? new Date(from).toISOString() : null, to: Number.isFinite(to) ? new Date(to).toISOString() : null },
    total_visits: visits.length,
    total_points: visits.reduce((sum, visit) => sum + visit.points, 0),
    unique_pois: byPoi.size,
    poi_total: pois.size,
    coverage_pct: pois.size ? Math.round(byPoi.size / pois.size * 1000) / 10 : 0,
    gem_share_pct: visits.length ? Math.round(gemVisits / visits.length * 1000) / 10 : 0,
    players: store.players.size,
    by_poi: pairs(byPoi),
    by_category: pairs(byCategory).map((row) => ({ ...row, label: categoryLabels.get(row.key) ?? row.key })),
    by_group: pairs(byGroup).map((row) => ({ ...row, label: groupLabels[row.key] ?? row.key })),
    by_orp: pairs(byOrp).map((row) => ({ ...row, label: orpNames[row.key] ?? "Neurčeno" })),
    by_hour: [...byHour].sort().map(([key, value]) => ({ key, count: value })),
    by_day: byDayFilled,
    by_hour_of_day: hourOfDay.map((value, hour) => ({ hour, count: value })),
    by_team: teamIds.map((team) => ({ team, name: teams[team].name, color: teams[team].color, visits: teamVisits.get(team) ?? 0, points: teamPoints.get(team) ?? 0 })),
    top_pois: poiRows.slice(0, topN),
    heatmap: poiRows.filter((row) => row.lat !== null).map((row) => [row.lat, row.lon, row.count]),
  };
});

/** One call for the region dashboard: season, teams, events and stats. */
app.get("/api/dashboard", async (request, reply) => {
  const season = await syncSeason();
  const stats = await app.inject({ method: "GET", url: `/api/stats/poi?${new URLSearchParams(request.query as Record<string, string>)}` });
  if (stats.statusCode !== 200) return reply.code(stats.statusCode).send(stats.json());
  return {
    season: publicSeason(season),
    teams: teamTable(season.id),
    history: seasons.history().slice(0, 5),
    events: events.active().map(publicEvent),
    stats: stats.json(),
  };
});

const dashboardFile = new URL("../public/dashboard.html", import.meta.url);
app.get("/dashboard", async (_request, reply) => {
  reply.type("text/html; charset=utf-8").header("cache-control", "no-cache");
  return readFile(dashboardFile, "utf8");
});
app.get("/", async (_request, reply) => reply.redirect("/dashboard"));

// Map libraries are served locally so the dashboard works on venue Wi-Fi without CDNs.
const vendorFiles: Record<string, { path: string; type: string }> = {
  "leaflet.js": { path: "leaflet/dist/leaflet.js", type: "application/javascript" },
  "leaflet.css": { path: "leaflet/dist/leaflet.css", type: "text/css" },
  "leaflet-heat.js": { path: "leaflet.heat/dist/leaflet-heat.js", type: "application/javascript" },
};
app.get<{ Params: { file: string } }>("/vendor/:file", async (request, reply) => {
  const file = vendorFiles[request.params.file];
  if (!file) return fail(reply, 404, "NOT_FOUND", "Soubor neexistuje.");
  reply.type(`${file.type}; charset=utf-8`).header("cache-control", "public, max-age=86400");
  return readFile(new URL(`../node_modules/${file.path}`, import.meta.url), "utf8");
});

setInterval(() => {
  const now = Date.now();
  store.prune(now - config.pingRetentionHours * 3600_000, now - config.staleCheckinMinutes * 60_000)
    .catch((error) => app.log.warn(error, "pruning failed"));
  for (const id of startMultipliers.keys()) if (!store.checkins.has(id)) startMultipliers.delete(id);
}, 15 * 60 * 1000).unref();

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  await pool?.end();
  process.exit(1);
}
