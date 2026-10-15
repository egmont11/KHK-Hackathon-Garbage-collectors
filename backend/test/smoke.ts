/**
 * End-to-end smoke test: starts the API in memory mode with a 3 s check-in and walks
 * through onboarding → check-in → leaderboard → stats. Run with `npm test`.
 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";

const port = 3999;
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", CHECKIN_SECONDS: "3", LOG_LEVEL: "warn", DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", DEMO_SEED: "0", ADMIN_PASSWORD: "Vychozi-heslo1", ADMIN_RESET: "1", ADMIN_MUST_CHANGE: "1" },
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
  assert.ok(finish.body.new_badges.some((b: any) => b.id === "prvni-krok"), "first check-in earns První krok");

  const again = await api("/api/checkins/start", { method: "POST", token, json: { poi_id: poi.properties.id, lat, lon, accuracy_m: 10 } });
  assert.equal(again.body.error.code, "ALREADY_VISITED");

  const teams = await api("/api/teams");
  assert.equal(teams.body.find((t: any) => t.team === "lesy").score, finish.body.awarded_points);
  const me = await api("/api/players/me", { token });
  assert.equal(me.body.visited.length, 1);
  // Statistics are admin-only; the built-in admin must change the initial password first.
  assert.equal((await api("/api/stats/poi")).status, 401);
  assert.equal((await api("/api/admin/login", { method: "POST", json: { username: "admin", password: "wrong" } })).status, 401);
  const login = await api("/api/admin/login", { method: "POST", json: { username: "admin", password: "Vychozi-heslo1" } });
  assert.equal(login.status, 200);
  assert.equal(login.body.must_change_password, true);
  let admin = login.body.token;
  assert.equal((await api("/api/stats/poi", { token: admin })).body.error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.equal((await api("/api/admin/password", { method: "POST", token: admin, json: { current_password: "Vychozi-heslo1", new_password: "short" } })).status, 400);
  const changed = await api("/api/admin/password", { method: "POST", token: admin, json: { current_password: "Vychozi-heslo1", new_password: "Nove-heslo-2026" } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.must_change_password, false);
  assert.equal((await api("/api/admin/login", { method: "POST", json: { username: "admin", password: "Vychozi-heslo1" } })).status, 401);
  admin = (await api("/api/admin/login", { method: "POST", json: { username: "admin", password: "Nove-heslo-2026" } })).body.token;
  const created = await api("/api/admin/admins", { method: "POST", token: admin, json: { username: "kraj.analytik" } });
  assert.equal(created.status, 201);
  assert.ok(created.body.initial_password && created.body.must_change_password);
  assert.equal((await api("/api/admin/admins", { token: admin })).body.length, 2);

  const stats = await api("/api/stats/poi?season=current", { token: admin });
  assert.equal(stats.body.total_visits, 1);
  assert.equal(stats.body.top_pois[0].poi_id, poi.properties.id);
  const players = await api("/api/admin/players", { token: admin });
  assert.equal(players.body[0].season_points, finish.body.awarded_points);
  const csv = await fetch(`${base}/api/admin/export/visits.csv`, { headers: { authorization: `Bearer ${admin}` } });
  assert.equal((await csv.text()).trim().split("\r\n").length, 2, "CSV has header + 1 visit");
  assert.equal((await api("/api/dashboard", { token: admin })).status, 200);
  const ended = await api("/api/admin/seasons/end", { method: "POST", token: admin });
  assert.equal(ended.body.ranking.find((r: any) => r.team === "lesy").score, finish.body.awarded_points);
  assert.notEqual(ended.body.current.season_id, ended.body.ended);
  assert.equal((await api("/api/teams")).body.find((t: any) => t.team === "lesy").score, 0, "new season starts from zero");
  assert.equal((await api("/api/seasons/history")).body[0].season_id, ended.body.ended);
  // Badges reset with the season but stay archived in the profile.
  const profile = (await api("/api/players/me", { token })).body;
  assert.ok(profile.badges.every((b: any) => !b.earned), "new season starts without badges");
  assert.equal(profile.badge_archive[0].season_id, ended.body.ended);
  assert.ok(profile.badge_archive[0].badges.some((b: any) => b.id === "prvni-krok"));
  const timeline = await api(`/api/admin/stats/timeline?dimension=category&key=${poi.properties.category}`, { token: admin });
  assert.equal(timeline.body.days.reduce((sum: number, d: any) => sum + d.count, 0), 1);
  assert.equal((await api("/api/admin/logout", { method: "POST", token: admin })).status, 200);
  assert.equal((await api("/api/admin/me", { token: admin })).status, 401);

  // Team battles (cosmetic): most check-ins this season owns the place; on a tie the holder keeps it.
  async function checkInAs(team: string, target: any) {
    const t = (await api("/api/players", { method: "POST", json: { name: `Hráč ${team}`, team } })).body.token;
    const [tLon, tLat] = target.geometry.coordinates;
    const st = (await api("/api/checkins/start", { method: "POST", token: t, json: { poi_id: target.properties.id, lat: tLat, lon: tLon, accuracy_m: 10 } })).body;
    for (let i = 0; i < 4; i++) { await sleep(1100); await api(`/api/checkins/${st.checkin_id}/ping`, { method: "POST", token: t, json: { lat: tLat, lon: tLon, accuracy_m: 10 } }); }
    assert.equal((await api(`/api/checkins/${st.checkin_id}/finish`, { method: "POST", token: t })).status, 200);
  }
  const battlePoi = poiList.body.features[1];
  const ownerOf = async () => (await api(`/api/poi/${encodeURIComponent(battlePoi.properties.id)}`)).body.owner_team;
  assert.equal(await ownerOf(), null);
  await checkInAs("hory", battlePoi);
  assert.equal(await ownerOf(), "hory");
  await checkInAs("reky", battlePoi);
  assert.equal(await ownerOf(), "hory", "tie: holder keeps the place");
  await checkInAs("reky", battlePoi);
  assert.equal(await ownerOf(), "reky", "more check-ins take it over");
  const owned = (await api("/api/poi?lite=1&owner=reky")).body.features.map((f: any) => f.properties.id);
  assert.ok(owned.includes(battlePoi.properties.id));
  assert.ok((await api("/api/teams")).body.find((t: any) => t.team === "reky").owned_pois >= 1);

  // Quick time events: 3 weekly bonus places ≥ 50 km apart (×2) and one daily category challenge (×1.4).
  const events = (await api("/api/events/active")).body;
  assert.equal(events.weekly.length, 3);
  assert.ok(events.weekly.every((e: any) => e.multiplier === 2));
  const km = (a: any, b: any) => { const r = Math.PI / 180, h = Math.sin((b.lat - a.lat) * r / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin((b.lon - a.lon) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(h)); };
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(km(events.weekly[i], events.weekly[j]) >= 50, "weekly places 50 km apart");
  assert.equal(events.daily.type, "daily_category");
  assert.equal(events.daily.multiplier, 1.4);

  // A check-in at a place of the daily category earns ×1.4.
  const weeklyIds = new Set(events.weekly.map((e: any) => e.poi_id));
  const dailyPoi = (await api(`/api/poi?lite=1&category=${events.daily.category}`)).body.features.find((f: any) => !weeklyIds.has(f.properties.id));
  assert.equal(dailyPoi.properties.event_type, "daily_category");
  const [dLon, dLat] = dailyPoi.geometry.coordinates;
  const dStart = await api("/api/checkins/start", { method: "POST", token, json: { poi_id: dailyPoi.properties.id, lat: dLat, lon: dLon, accuracy_m: 10 } });
  assert.equal(dStart.body.multiplier, 1.4);
  for (let i = 0; i < 4; i++) { await sleep(1100); await api(`/api/checkins/${dStart.body.checkin_id}/ping`, { method: "POST", token, json: { lat: dLat, lon: dLon, accuracy_m: 10 } }); }
  const dFinish = await api(`/api/checkins/${dStart.body.checkin_id}/finish`, { method: "POST", token });
  assert.equal(dFinish.body.awarded_points, Math.round(dailyPoi.properties.points * 1.4));
  assert.equal(dFinish.body.event_type, "daily_category");

  // And at a weekly bonus place ×2.
  const weekly = events.weekly[0];
  const wStart = await api("/api/checkins/start", { method: "POST", token, json: { poi_id: weekly.poi_id, lat: weekly.lat, lon: weekly.lon, accuracy_m: 10 } });
  for (let i = 0; i < 4; i++) { await sleep(1100); await api(`/api/checkins/${wStart.body.checkin_id}/ping`, { method: "POST", token, json: { lat: weekly.lat, lon: weekly.lon, accuracy_m: 10 } }); }
  const wFinish = await api(`/api/checkins/${wStart.body.checkin_id}/finish`, { method: "POST", token });
  assert.equal(wFinish.body.awarded_points, weekly.bonus_points);
  const dashboard = await fetch(`${base}/dashboard`);
  assert.ok((await dashboard.text()).includes("dashboard kraje"));
  console.log("✔ smoke test passed");
} catch (error) {
  console.error("✘ smoke test failed:", error);
  process.exitCode = 1;
} finally {
  server.kill();
}
