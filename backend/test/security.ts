import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdtemp, stat, rm } from "node:fs/promises";
import { Script } from "node:vm";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { config } from "../src/config.js";
import { AdminStore, hashPassword } from "../src/auth.js";
import { MemoryStore } from "../src/store.js";
import { WindowLimiter, csvCell, tokenHash } from "../src/security.js";
import type { Checkin } from "../src/types.js";

async function fixture(env: Record<string, string> = {}) {
  const socket = createServer();
  await new Promise<void>((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    env: { ...process.env, NODE_ENV: "test", HOST: "127.0.0.1", PORT: String(port),
      DATABASE_URL: "", PGHOST: "", DEMO_SEED: "0", LOG_LEVEL: "silent", ADMIN_RESET: "0",
      ADMIN_PASSWORD: "SecurityFixture123", ADMIN_MUST_CHANGE: "0", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (b) => { output += b; });
  child.stderr.on("data", (b) => { output += b; });
  const base = `http://127.0.0.1:${port}`;
  const api = async (path: string, body?: unknown, token?: string, headers: Record<string, string> = {}) => {
    const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
      signal: AbortSignal.timeout(10_000), headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text();
    let json: any; try { json = JSON.parse(text); } catch { json = null; }
    return { status: response.status, body: json, text, headers: response.headers };
  };
  try {
    for (let i = 0; ; i++) {
      if (child.exitCode !== null) throw new Error(`Fixture exited: ${output}`);
      try { if ((await api("/health")).status === 200) break; } catch { /* booting */ }
      if (i > 100) throw new Error("Fixture did not start");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) { child.kill(); throw error; }
  return { api, base, output: () => output, close: () => child.kill() };
}

test("old-password logins cannot survive a concurrent password rotation", async () => {
  const store = new AdminStore();
  for (let i = 0; i < 4; i++) {
    const admin = await store.create(`race-${i}`, "OriginalSecret123", false);
    const kept = store.newSession(admin).token;
    const rotation = store.setPassword(admin, "ReplacementSecret456", false).then(() => {
      store.revokeOtherSessions(admin.id, kept, admin.passwordHash);
    });
    const attempts = Array.from({ length: 8 }, () => store.login(admin.username, "OriginalSecret123"));
    await rotation;
    for (const session of await Promise.all(attempts)) {
      if (session) assert.equal(await store.adminForToken(session.token), undefined);
    }
    assert.ok(await store.adminForToken(kept));
    assert.equal(await store.login(admin.username, "OriginalSecret123"), null);
  }
});

test("PostgreSQL migration, session digests, cross-instance admin revocation and abandoned check-ins", async () => {
  const db = new PGlite();
  const query = async (sql: string, params: unknown[] = []) => {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const pool = { query, connect: async () => ({ query, release() {} }) } as unknown as Pool;
  try {
    // Simulate an existing installation with a plaintext legacy token before migration.
    await db.exec("CREATE TABLE players(id uuid PRIMARY KEY, name text NOT NULL, team text NOT NULL, token text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now())");
    const legacyId = randomUUID();
    await db.query("INSERT INTO players(id,name,team,token) VALUES($1,'Legacy','hory','old-plaintext-token')", [legacyId]);
    const schema = await readFile(new URL("../schema.sql", import.meta.url), "utf8");
    await db.exec(schema);
    await db.exec(schema); // Idempotent and does not invalidate newly issued digests.
    assert.equal((await db.query<{ token: string }>("SELECT token FROM players WHERE id=$1", [legacyId])).rows[0].token, `revoked:${legacyId}`);
    const players = new MemoryStore(new Map(), pool);
    await players.initialize();
    const player = await players.addPlayer("DatabaseTester", "lesy", await hashPassword("PlayerPassword123"));
    const token = await players.issuePlayerToken(player);
    const stored = (await db.query<{ token: string }>("SELECT token FROM players WHERE id=$1", [player.id])).rows[0].token;
    await db.exec(schema);
    assert.notEqual(stored, token);
    assert.equal(stored, tokenHash(token));
    assert.ok(await players.playerForToken(token));
    const peerPlayers = new MemoryStore(new Map(), pool);
    await peerPlayers.initialize();
    assert.ok(await peerPlayers.playerForToken(token));
    await players.revokePlayerToken(token);
    assert.equal(await peerPlayers.playerForToken(token), undefined);
    const renewed = await players.issuePlayerToken(player);
    await db.query("UPDATE players SET token_expires_at=now()-interval '1 second' WHERE id=$1", [player.id]);
    assert.equal(await players.playerForToken(renewed), undefined);

    const first = new AdminStore(pool), second = new AdminStore(pool);
    const admin = await first.create("database-admin", "OldDatabaseSecret123", false);
    const peerLogin = (await second.login(admin.username, "OldDatabaseSecret123"))!;
    assert.ok(await second.adminForToken(peerLogin.token));
    await first.setPassword(admin, "NewDatabaseSecret456", false);
    assert.equal(await second.adminForToken(peerLogin.token), undefined);
    assert.equal(await second.login(admin.username, "OldDatabaseSecret123"), null);
    const newLogin = (await second.login(admin.username, "NewDatabaseSecret456"))!;
    await first.remove(admin.id);
    assert.equal(await second.adminForToken(newLogin.token), undefined);

    const season = { id: "security-season", startsAt: Date.now() - 10_000, endsAt: Date.now() + 86_400_000 };
    await players.ensureSeasons(season, []);
    const makeCheckin = (): Checkin => ({ id: randomUUID(), playerId: player.id, poiId: "test:1", seasonId: season.id,
      startedAt: Date.now() - 7_200_000, finishedAt: null, valid: false, awardedPoints: 0,
      pings: [], streakStartedAt: null, lastTeam: null });
    const ping = { lat: 50, lon: 16, accuracy_m: 10, ts: Date.now() - 7_200_000 };
    await players.recordCheckinStart(makeCheckin(), ping);
    await players.recordCheckinStart(makeCheckin(), ping);
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM checkins WHERE finished_at IS NULL")).rows[0].count, 1);
    await players.prune(Date.now() - 86_400_000, Date.now() - 3_600_000);
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM checkins WHERE finished_at IS NULL")).rows[0].count, 0);
    assert.equal((await db.query<{ count: number }>("SELECT count(*)::int AS count FROM pings")).rows[0].count, 0);
    // A stale peer cache cannot bypass the database-wide capacity check.
    await db.query("INSERT INTO players(id,name,team,token) SELECT md5('capacity-'||n)::uuid, 'Capacity'||n, 'hory', 'revoked:capacity-'||n FROM generate_series(1,$1::int) n", [config.maxPlayers - 2]);
    await assert.rejects(() => peerPlayers.addPlayer("BeyondDatabaseCapacity", "lesy"), (error: any) => error.code === "PLAYER_CAPACITY");
  } finally { await db.close(); }
});

test("parallel login and registration are bounded; unrelated usernames remain usable; logout revokes", async () => {
  const f = await fixture();
  try {
    const logins = await Promise.all(Array.from({ length: 16 }, () => f.api("/api/admin/login", { username: "unknown", password: "wrong" })));
    assert.equal(logins.filter((row) => row.status === 401).length, 5);
    assert.equal(logins.filter((row) => row.status === 429).length, 11);
    assert.equal((await f.api("/api/admin/login", { username: "admin", password: "SecurityFixture123" })).status, 200);
    const registrations = await Promise.all(Array.from({ length: 16 }, (_, i) => f.api("/api/players", { name: `Limited-${i}`, team: "hory", password: "PlayerPassword123" })));
    const accepted = registrations.filter((row) => row.status === 201);
    assert.equal(accepted.length, 5);
    assert.equal(registrations.filter((row) => row.status === 429).length, 11);
    const player = accepted[0].body;
    const login = await f.api("/api/players/login", { name: player.name, password: "PlayerPassword123" });
    assert.equal(login.status, 200);
    assert.notEqual(login.body.token, player.token);
    assert.equal((await f.api("/api/players/me", undefined, player.token)).status, 401);
    assert.equal((await f.api("/api/players/logout", {}, login.body.token)).status, 200);
    assert.equal((await f.api("/api/players/me", undefined, login.body.token)).status, 401);
    const page = await f.api("/dashboard?api=https://attacker.invalid");
    assert.ok(page.text.includes('const API = "";'));
    assert.ok(page.text.includes("tip.textContent = html"));
    assert.ok(!page.headers.has("access-control-allow-origin"));
    assert.equal(page.headers.get("x-frame-options"), "DENY");
    const script = /<script>([\s\S]*?)<\/script>/.exec(page.text)![1];
    const digest = createHash("sha256").update(script).digest("base64");
    assert.ok(page.headers.get("content-security-policy")?.includes(`'sha256-${digest}'`));
    const poi = (await f.api("/api/poi?lite=1")).body.features[0];
    assert.equal((await f.api(`/api/poi/${encodeURIComponent(poi.properties.id)}`)).body.last_visited_at, null);
    const origin = await f.api("/health", undefined, undefined, { origin: "https://attacker.invalid" });
    assert.equal(origin.headers.get("access-control-allow-origin"), null);
    const demo = await f.api("/api/checkins/start", { poi_id: poi.properties.id, lat: poi.geometry.coordinates[1], lon: poi.geometry.coordinates[0], accuracy_m: 0 }, accepted[1].body.token, { "x-krajanek-demo": "1" });
    assert.equal(demo.status, 403);
  } finally { f.close(); }
});

test("same-name concurrent registrations have only one winner and total capacity is bounded", async () => {
  const f = await fixture({ REGISTRATIONS_PER_HOUR: "50", MAX_PLAYERS: "2" });
  try {
    const registrations = await Promise.all(Array.from({ length: 8 }, () => f.api("/api/players", { name: "SameName", team: "lesy", password: "PlayerPassword123" })));
    assert.equal(registrations.filter((r) => r.status === 201).length, 1);
    assert.equal(registrations.filter((r) => r.status === 409).length, 7);
    assert.equal((await f.api("/api/players", { name: "OtherName", team: "lesy", password: "PlayerPassword123" })).status, 201);
    assert.equal((await f.api("/api/players", { name: "OverCapacity", team: "lesy", password: "PlayerPassword123" })).status, 503);
  } finally { f.close(); }
});

test("production rejects plain HTTP and spoofed forwarding headers from untrusted peers", async () => {
  const f = await fixture({ NODE_ENV: "production", TRUSTED_PROXIES: "" });
  try {
    assert.equal((await f.api("/dashboard", undefined, undefined, { "x-forwarded-proto": "https" })).status, 426);
    assert.equal((await f.api("/health")).status, 200);
  } finally { f.close(); }
  const trusted = await fixture({ NODE_ENV: "production", TRUSTED_PROXIES: "127.0.0.1" });
  try {
    assert.equal((await trusted.api("/dashboard", undefined, undefined, { "x-forwarded-proto": "https" })).status, 200);
  } finally { trusted.close(); }
});

test("generated bootstrap password is private and never appears in logs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "krajanek-bootstrap-"));
  const path = join(dir, "initial-password");
  const f = await fixture({ ADMIN_PASSWORD: "", ADMIN_PASSWORD_FILE: path });
  try {
    const password = (await readFile(path, "utf8")).trim();
    assert.ok(password.length >= 10);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    assert.ok(!f.output().includes(password));
    assert.equal((await f.api("/api/admin/login", { username: "admin", password })).status, 200);
  } finally { f.close(); await rm(dir, { recursive: true, force: true }); }
});

test("CSV neutralizes formulas including whitespace prefixes and CR separators", () => {
  for (const input of ["=1+1", "+1", "-1", "@SUM(A1)", " \t=1+1", "\ttext", "\rtext", "\ntext"]) assert.ok(csvCell(input).startsWith("'") || csvCell(input).startsWith('"\''));
  assert.equal(csvCell("Hradec Králové"), "Hradec Králové");
  assert.equal(csvCell('a;"b"'), '"a;""b"""');
});

test("limiter never evicts active entries when its key capacity is exhausted", () => {
  const limit = new WindowLimiter(1);
  assert.equal(limit.take("first", 1, 60_000, 1000), 0);
  assert.ok(limit.take("other", 1, 60_000, 1000) > 0);
  assert.ok(limit.take("first", 1, 60_000, 1000) > 0);
  assert.equal(limit.take("other", 1, 60_000, 61_001), 0);
});


test("dashboard credentials stay on origin and tooltip payload remains text", async () => {
  const html = await readFile(new URL("../public/dashboard.html", import.meta.url), "utf8");
  const apiLine = html.split("\n").find((line) => line.startsWith("const API ="))!;
  const sessionCode = html.slice(html.indexOf("let token = null, me = null;"), html.indexOf("async function apiJson"));
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const scope = {
    location: { search: "?api=https://attacker.invalid" },
    sessionStorage: { getItem: () => "synthetic-session", setItem() {}, removeItem() {} },
    fetch: async (url: string, options: { headers: Record<string, string> }) => { calls.push({ url, headers: options.headers }); return { status: 200 }; },
  };
  await new Script(apiLine + "\n" + sessionCode + '\napi("/api/admin/login", {method:"POST",body:"{}"})').runInNewContext(scope);
  assert.equal(calls[0].url, "/api/admin/login");
  assert.equal(calls[0].headers.authorization, "Bearer synthetic-session");
  const tip = { textContent: "", innerHTML: "original", style: {} };
  const showTip = html.split("\n").find((line) => line.startsWith("function showTip("))!;
  const payload = '<img src=x onerror="throw Error(1)">';
  new Script(showTip + "\nshowTip({clientX:0,clientY:0}, payload)").runInNewContext({ tip, payload });
  assert.equal(tip.textContent, payload);
  assert.equal(tip.innerHTML, "original");
});

test("weak bootstrap credentials and persistent/production demo startup are refused", async () => {
  await assert.rejects(() => fixture({ ADMIN_PASSWORD: "admin" }), /Invalid initial admin password/);
  for (const env of [{ NODE_ENV: "production", DATABASE_URL: "", PGHOST: "" }, { NODE_ENV: "test", DATABASE_URL: "postgres://invalid", PGHOST: "" }]) {
    const run = spawnSync(process.execPath, ["--import", "tsx", "src/server.ts", "--demo"], { env: { ...process.env, ...env }, timeout: 10_000, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /Demo requires an isolated in-memory development server/);
  }
});
