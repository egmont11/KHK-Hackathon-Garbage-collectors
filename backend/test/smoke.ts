/**
 * End-to-end smoke test: starts the API in memory mode with a 3 s check-in and walks
 * through onboarding → check-in → leaderboard → stats. Run with `npm test`.
 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const port = 3999;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", CHECKIN_SECONDS: "3", LOG_LEVEL: "warn", DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", DEMO_SEED: "0" },
  stdio: ["ignore", "inherit", "inherit"],
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function api(path: string, init: RequestInit & { token?: string; json?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.json !== undefined || init.method === "POST") headers["content-type"] = "application/json";
  const res = await fetch(base + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.method === "POST" ? "" : undefined });
  return { status: res.status, body: await res.json() as any };
}

try {
  for (let i = 0; ; i++) {
    try { if ((await fetch(`${base}/health`)).ok) break; } catch { /* not up yet */ }
    if (i > 50) throw new Error("server did not start");
    await sleep(200);
  }
  const health = await api("/health");
  assert.ok(health.body.poi_count > 1000, "POI catalog loaded");

  const poiList = await api("/api/poi?lite=1&group=pamatky&min_points=20");
  const poi = poiList.body.features[0];
  assert.ok(poi, "filter returns POIs");
  const [lon, lat] = poi.geometry.coordinates;

  assert.equal((await api("/api/players", { method: "POST", json: { name: "", team: "lesy" } })).status, 400);
  const player = await api("/api/players", { method: "POST", json: { name: "Tester", team: "lesy" } });
  assert.equal(player.status, 201);
  const token = player.body.token;

  const far = await api("/api/checkins/start", { method: "POST", token, json: { poi_id: poi.properties.id, lat: lat + 0.01, lon, accuracy_m: 10 } });
  assert.equal(far.body.valid, false);
  assert.equal(far.body.reason, "OUT_OF_RANGE");

  const start = await api("/api/checkins/start", { method: "POST", token, json: { poi_id: poi.properties.id, lat, lon, accuracy_m: 10 } });
  assert.equal(start.status, 201);
  const id = start.body.checkin_id;
  assert.equal((await api(`/api/checkins/${id}/finish`, { method: "POST", token })).body.error.code, "CHECKIN_INCOMPLETE");
  let ping: any;
  for (let i = 0; i < 4; i++) { await sleep(1100); ping = (await api(`/api/checkins/${id}/ping`, { method: "POST", token, json: { lat: lat + 0.0001, lon, accuracy_m: 12 } })).body; }
  assert.equal(ping.can_finish, true);
  const finish = await api(`/api/checkins/${id}/finish`, { method: "POST", token });
  assert.equal(finish.status, 200);
  assert.ok(finish.body.awarded_points >= poi.properties.points);

  const again = await api("/api/checkins/start", { method: "POST", token, json: { poi_id: poi.properties.id, lat, lon, accuracy_m: 10 } });
  assert.equal(again.body.error.code, "ALREADY_VISITED");

  const teams = await api("/api/teams");
  assert.equal(teams.body.find((t: any) => t.team === "lesy").score, finish.body.awarded_points);
  const me = await api("/api/players/me", { token });
  assert.equal(me.body.visited.length, 1);
  const stats = await api("/api/stats/poi?season=current");
  assert.equal(stats.body.total_visits, 1);
  assert.equal(stats.body.top_pois[0].poi_id, poi.properties.id);
  const events = await api("/api/events/active");
  assert.ok(Array.isArray(events.body) && events.body.length > 0, "quick time events");
  const dashboard = await fetch(`${base}/dashboard`);
  assert.ok((await dashboard.text()).includes("dashboard kraje"));
  console.log("✔ smoke test passed");
} catch (error) {
  console.error("✘ smoke test failed:", error);
  process.exitCode = 1;
} finally {
  server.kill();
}
