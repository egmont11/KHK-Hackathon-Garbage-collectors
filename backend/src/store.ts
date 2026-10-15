import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { teamIds } from "./config.js";
import type { Checkin, Poi, TeamId } from "./types.js";

/** Team battle at one place in one season: check-ins (owner) and points (topTeam) per team. */
type Ownership = { counts: Record<TeamId, number>; owner: TeamId; points: Record<TeamId, number>; topTeam: TeamId };

export type Player = { id: string; name: string; team: TeamId; token: string; createdAt: number };
export type Season = { id: string; startsAt: number; endsAt: number };
/** Anonymous visit record used for statistics: no player id, no route. */
export type Visit = { poiId: string; category: string; group: string; orpCode: string | null; team: TeamId; points: number; at: number; seasonId: string };
/** One check-in of one player, used for their profile and badges. */
export type PlayerVisit = { poiId: string; points: number; at: number; eventType: string | null; tookOver: boolean };
export type SeasonResult = { season_id: string; starts_at: string; ends_at: string; ranking: { team: TeamId; score: number }[] };

export class MemoryStore {
  readonly players = new Map<string, Player>();
  readonly checkins = new Map<string, Checkin>();
  readonly scores = new Map<string, Map<TeamId, number>>();
  readonly visits: Visit[] = [];
  readonly history: SeasonResult[] = [];
  /** Season still running according to PostgreSQL, so a restart resumes it. */
  resumeSeason: Season | null = null;
  private readonly used = new Set<string>();
  private readonly byToken = new Map<string, Player>();
  private readonly visitCounts = new Map<string, number>();
  private readonly lastVisit = new Map<string, { team: TeamId; at: number }>();
  /**
   * Team battles (cosmetic): seasonId -> poiId -> check-ins per team and the owning team.
   * The team with the most check-ins this season owns the place; on a tie the holder keeps it.
   * Since a player can check in at a place once per season, this is "most different players".
   */
  private readonly ownership = new Map<string, Map<string, Ownership>>();
  /** seasonId -> playerId -> visited POI ids */
  private readonly playerVisits = new Map<string, Map<string, PlayerVisit[]>>();

  constructor(readonly pois: Map<string, Poi>, readonly pool?: Pool) {}

  async initialize(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query("DELETE FROM checkins WHERE finished_at IS NULL");
    await this.prunePingsInDb();
    const players = await this.pool.query("SELECT id, name, team, token, created_at FROM players");
    for (const row of players.rows) this.indexPlayer({
      id: row.id, name: row.name, team: row.team as TeamId, token: row.token, createdAt: new Date(row.created_at).getTime(),
    });
    const scores = await this.pool.query("SELECT season_id, team, score FROM team_scores");
    for (const row of scores.rows) {
      const seasonScores = this.scores.get(row.season_id) ?? new Map<TeamId, number>();
      seasonScores.set(row.team as TeamId, Number(row.score));
      this.scores.set(row.season_id, seasonScores);
    }
    const visits = await this.pool.query(`
      SELECT c.id, c.player_id, c.poi_id, c.season_id, c.started_at, c.finished_at,
             c.awarded_points, c.event_type, p.team
      FROM checkins c JOIN players p ON p.id = c.player_id
      WHERE c.valid = true AND c.finished_at IS NOT NULL
      ORDER BY c.finished_at
    `);
    for (const row of visits.rows) {
      const poi = this.pois.get(row.poi_id);
      if (!poi) continue;
      const finishedAt = new Date(row.finished_at).getTime();
      this.recordVisit(row.player_id, row.team as TeamId, poi, row.season_id, Number(row.awarded_points), finishedAt, row.event_type ?? null);
      this.checkins.set(row.id, {
        id: row.id, playerId: row.player_id, poiId: row.poi_id, seasonId: row.season_id,
        startedAt: new Date(row.started_at).getTime(), finishedAt, valid: true,
        awardedPoints: Number(row.awarded_points), pings: [], streakStartedAt: null, lastTeam: row.team,
      });
    }
    // Seasons that ended while the server was down still need their final ranking.
    await this.pool.query(`
      UPDATE seasons s SET ranking = (
        SELECT jsonb_agg(jsonb_build_object('team', t.team, 'score', COALESCE(ts.score, 0)) ORDER BY t.ord)
        FROM (VALUES ('hory', 1), ('reky', 2), ('lesy', 3)) AS t(team, ord)
        LEFT JOIN team_scores ts ON ts.season_id = s.id AND ts.team = t.team
      )
      WHERE s.ranking IS NULL AND s.ends_at <= now()
    `);
    const running = await this.pool.query("SELECT id, starts_at, ends_at FROM seasons WHERE ends_at > now() AND starts_at <= now() ORDER BY starts_at DESC LIMIT 1");
    if (running.rows[0]) this.resumeSeason = {
      id: running.rows[0].id, startsAt: new Date(running.rows[0].starts_at).getTime(), endsAt: new Date(running.rows[0].ends_at).getTime(),
    };
    const history = await this.pool.query("SELECT id, starts_at, ends_at, ranking FROM seasons WHERE ranking IS NOT NULL ORDER BY starts_at ASC");
    for (const row of history.rows) this.history.push({
      season_id: row.id,
      starts_at: new Date(row.starts_at).toISOString(),
      ends_at: new Date(row.ends_at).toISOString(),
      ranking: row.ranking,
    });
  }

  private syncedSeasonKey = "";

  /** Persists finished seasons and the current one. Cheap no-op unless something changed. */
  async ensureSeasons(current: Season, history: SeasonResult[]): Promise<void> {
    if (!this.pool) return;
    const key = `${current.id}:${history.length}`;
    if (key === this.syncedSeasonKey) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const old of history) {
        await client.query(`
          INSERT INTO seasons (id, starts_at, ends_at, ranking) VALUES ($1, $2, $3, $4)
          ON CONFLICT (id) DO UPDATE SET ranking = EXCLUDED.ranking, ends_at = EXCLUDED.ends_at
        `, [old.season_id, old.starts_at, old.ends_at, JSON.stringify(old.ranking)]);
      }
      await client.query(`
        INSERT INTO seasons (id, starts_at, ends_at) VALUES ($1, $2, $3)
        ON CONFLICT (id) DO NOTHING
      `, [current.id, new Date(current.startsAt).toISOString(), new Date(current.endsAt).toISOString()]);
      await client.query("COMMIT");
      this.syncedSeasonKey = key;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private indexPlayer(player: Player) {
    this.players.set(player.id, player);
    this.byToken.set(player.token, player);
  }

  async addPlayer(name: string, team: TeamId): Promise<Player> {
    const player = { id: randomUUID(), name, team, token: randomUUID(), createdAt: Date.now() };
    if (this.pool) await this.pool.query(
      "INSERT INTO players (id, name, team, token, created_at) VALUES ($1, $2, $3, $4, $5)",
      [player.id, player.name, player.team, player.token, new Date(player.createdAt).toISOString()],
    );
    this.indexPlayer(player);
    return player;
  }

  async recordCheckinStart(checkin: Checkin, firstPing: Checkin["pings"][number]): Promise<void> {
    if (!this.pool) return;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO checkins (id, player_id, poi_id, season_id, started_at) VALUES ($1, $2, $3, $4, $5)",
        [checkin.id, checkin.playerId, checkin.poiId, checkin.seasonId, new Date(checkin.startedAt).toISOString()],
      );
      await client.query(
        "INSERT INTO pings (checkin_id, ts, lat, lon, accuracy_m) VALUES ($1, $2, $3, $4, $5)",
        [checkin.id, new Date(firstPing.ts).toISOString(), firstPing.lat, firstPing.lon, firstPing.accuracy_m],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async recordPing(checkinId: string, ping: Checkin["pings"][number]): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(
      "INSERT INTO pings (checkin_id, ts, lat, lon, accuracy_m) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
      [checkinId, new Date(ping.ts).toISOString(), ping.lat, ping.lon, ping.accuracy_m],
    );
  }

  playerForToken(token?: string): Player | undefined {
    return token ? this.byToken.get(token) : undefined;
  }

  hasVisited(playerId: string, poiId: string, seasonId: string): boolean {
    return this.used.has(`${seasonId}:${playerId}:${poiId}`);
  }

  visitedBy(playerId: string, seasonId: string): PlayerVisit[] {
    return this.playerVisits.get(seasonId)?.get(playerId) ?? [];
  }

  /** Seasons in which the player checked in at least once (for the badge archive). */
  seasonsOf(playerId: string): string[] {
    return [...this.playerVisits].filter(([, players]) => players.has(playerId)).map(([seasonId]) => seasonId);
  }

  private recordVisit(playerId: string, team: TeamId, poi: Poi, seasonId: string, points: number, at: number, eventType: string | null = null): PlayerVisit {
    this.used.add(`${seasonId}:${playerId}:${poi.id}`);
    this.visits.push({
      poiId: poi.id, category: poi.category, group: poi.group ?? "ostatni", orpCode: poi.orp_code ?? null,
      team, points, at, seasonId,
    });
    this.visitCounts.set(poi.id, (this.visitCounts.get(poi.id) ?? 0) + 1);
    const last = this.lastVisit.get(poi.id);
    if (!last || last.at <= at) this.lastVisit.set(poi.id, { team, at });
    const seasonOwnership = this.ownership.get(seasonId) ?? new Map();
    const entry: Ownership = seasonOwnership.get(poi.id) ?? { counts: { hory: 0, reky: 0, lesy: 0 }, owner: team, points: { hory: 0, reky: 0, lesy: 0 }, topTeam: team };
    const previousOwner = entry.counts[entry.owner] > 0 ? entry.owner : null;
    entry.counts[team]++;
    if (entry.counts[team] > entry.counts[entry.owner]) entry.owner = team;
    const tookOver = previousOwner !== null && previousOwner !== team && entry.owner === team;
    // Most points at the place this season (bonuses count); on a tie the leading team keeps it.
    entry.points[team] += points;
    if (entry.points[team] > entry.points[entry.topTeam]) entry.topTeam = team;
    seasonOwnership.set(poi.id, entry);
    this.ownership.set(seasonId, seasonOwnership);
    const season = this.playerVisits.get(seasonId) ?? new Map();
    const list = season.get(playerId) ?? [];
    const visit: PlayerVisit = { poiId: poi.id, points, at, eventType, tookOver };
    list.push(visit);
    season.set(playerId, list);
    this.playerVisits.set(seasonId, season);
    return visit;
  }

  private addScore(seasonId: string, team: TeamId, points: number) {
    const scores = this.scores.get(seasonId) ?? new Map<TeamId, number>();
    scores.set(team, (scores.get(team) ?? 0) + points);
    this.scores.set(seasonId, scores);
  }

  async award(player: Player, checkin: Checkin, poi: Poi, multiplier = 1, eventType: string | null = null): Promise<number> {
    const points = Math.round(poi.points * multiplier);
    const finishedAt = Date.now();
    if (this.pool) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const updated = await client.query(
          "UPDATE checkins SET valid = true, awarded_points = $2, finished_at = $3, event_type = $4 WHERE id = $1 AND finished_at IS NULL RETURNING id",
          [checkin.id, points, new Date(finishedAt).toISOString(), eventType],
        );
        if (updated.rowCount !== 1) throw new Error("Check-in was already awarded or is missing in PostgreSQL.");
        await client.query(`
          INSERT INTO team_scores (season_id, team, score, updated_at) VALUES ($1, $2, $3, $4)
          ON CONFLICT (season_id, team) DO UPDATE
            SET score = team_scores.score + EXCLUDED.score, updated_at = EXCLUDED.updated_at
        `, [checkin.seasonId, player.team, points, new Date(finishedAt).toISOString()]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    }
    this.recordVisit(player.id, player.team, poi, checkin.seasonId, points, finishedAt, eventType);
    this.addScore(checkin.seasonId, player.team, points);
    checkin.awardedPoints = points;
    checkin.finishedAt = finishedAt;
    checkin.valid = true;
    checkin.pings = [];
    return points;
  }

  /** Owning team of a place in a season (null = nobody checked in yet). */
  owner(poiId: string, seasonId: string): Ownership | null {
    return this.ownership.get(seasonId)?.get(poiId) ?? null;
  }

  ownedCounts(seasonId: string): Record<TeamId, number> {
    const result: Record<TeamId, number> = { hory: 0, reky: 0, lesy: 0 };
    for (const entry of this.ownership.get(seasonId)?.values() ?? []) result[entry.owner]++;
    return result;
  }

  latestTeam(poiId: string): TeamId | null {
    return this.lastVisit.get(poiId)?.team ?? null;
  }

  lastVisitedAt(poiId: string): number | null {
    return this.lastVisit.get(poiId)?.at ?? null;
  }

  visitCount(poiId: string): number {
    return this.visitCounts.get(poiId) ?? 0;
  }

  ranking(seasonId: string): { team: TeamId; score: number }[] {
    const scores = this.scores.get(seasonId);
    return teamIds.map((team) => ({ team, score: scores?.get(team) ?? 0 }));
  }

  /** Drops old pings and abandoned check-ins from memory, and old pings from PostgreSQL. */
  async prune(pingCutoff: number, staleCutoff: number): Promise<void> {
    for (const [id, checkin] of this.checkins) {
      if (checkin.finishedAt === null && checkin.startedAt < staleCutoff) { this.checkins.delete(id); continue; }
      checkin.pings = checkin.pings.filter((ping) => ping.ts >= pingCutoff);
    }
    await this.prunePingsInDb();
  }

  private async prunePingsInDb() {
    if (this.pool) await this.pool.query("DELETE FROM pings WHERE ts < now() - interval '24 hours'");
  }

  /**
   * Demo only: fills memory with synthetic players and visits so the region dashboard
   * and leaderboard have something to show. Never written to PostgreSQL.
   */
  seedDemo(count: number, seasonId: string, seasonStart: number, now = Date.now(), bonus?: {
    /** Category with the daily bonus at a given time (players are nudged towards it). */
    dailyCategoryAt: (at: number) => string | null;
    /** Multiplier and event type for a check-in at a place at a given time. */
    bonusAt: (poi: Poi, at: number) => { multiplier: number; eventType: string | null };
  }) {
    const pois = [...this.pois.values()];
    if (!pois.length || count <= 0) return;
    let state = 0x2f6b9e1d;
    const rand = () => { state = (state + 0x6d2b79f5) | 0; let t = Math.imul(state ^ (state >>> 15), 1 | state); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const names = ["Krakonoš", "Turistka", "Vandrák", "Horal", "Poutník", "Bludička", "Toulavka", "Rozhledna", "Šlápota", "Hřebenovka"];
    const demoPlayers: Player[] = [];
    for (let i = 0; i < Math.max(12, Math.round(count / 15)); i++) {
      const team = teamIds[i % 3];
      const player = { id: randomUUID(), name: `${names[i % names.length]} ${i + 1}`, team, token: `demo-${randomUUID()}`, createdAt: now };
      this.players.set(player.id, player);
      demoPlayers.push(player);
    }
    // Popular (low-point) places are visited more, with a cluster bias towards a few hot spots.
    // Rough shape of the region's real attendance (Infogram 2024): nature, castles, ZOO first.
    const appeal: Record<string, number> = {
      hrady: 5, zamky: 5, zoo: 6, zahrady: 3, priroda: 3, rozhledny: 3, pevnosti: 3, lanovky: 3, koupani: 2.5,
      muzea: 2, pivovary: 2, cirkevni: 1.5, nkp: 2, technicke: 1.5, knihovny: 0.25, sluzby: 0.4, kempy: 0.8,
    };
    const weights = pois.map((poi) => (appeal[poi.category] ?? 1) / Math.max(10, poi.points) * (poi.is_nkp ? 2 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const pick = () => { let r = rand() * total; for (let i = 0; i < pois.length; i++) { r -= weights[i]; if (r <= 0) return pois[i]; } return pois.at(-1)!; };
    const byCategory = new Map<string, Poi[]>();
    for (const poi of pois) byCategory.set(poi.category, [...(byCategory.get(poi.category) ?? []), poi]);
    const span = Math.max(1, now - seasonStart);
    const entries: { player: Player; poi: Poi; at: number }[] = [];
    for (let i = 0; i < count; i++) {
      const player = demoPlayers[Math.floor(rand() * demoPlayers.length)];
      // Spread across the current season, daytime hours, busier at weekends.
      let at = seasonStart + rand() * span;
      const day = new Date(at);
      if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6 && rand() < 0.35) {
        const weekend = at + (6 - day.getUTCDay() + (rand() < 0.5 ? 1 : 0)) * 86_400_000;
        if (weekend < now - 86_400_000) at = weekend;
      }
      const date = new Date(at);
      date.setUTCHours(7 + Math.floor((rand() + rand() + rand()) / 3 * 11), Math.floor(rand() * 60));
      at = date.getTime();
      while (at > now - 60_000) at -= 86_400_000;
      if (at < seasonStart) at = seasonStart + rand() * span;
      // Some players go after the day's bonus category, so its effect shows on the dashboard.
      const bonusCategory = bonus?.dailyCategoryAt(at);
      const candidates = bonusCategory ? byCategory.get(bonusCategory) : undefined;
      const poi = candidates?.length && rand() < 0.06 ? candidates[Math.floor(rand() * candidates.length)] : pick();
      entries.push({ player, poi, at });
    }
    entries.sort((a, b) => a.at - b.at);
    for (const { player, poi, at } of entries) {
      if (this.hasVisited(player.id, poi.id, seasonId)) continue;
      const applied = bonus?.bonusAt(poi, at) ?? { multiplier: 1, eventType: null };
      const points = Math.round(poi.points * applied.multiplier);
      this.recordVisit(player.id, player.team, poi, seasonId, points, at, applied.eventType);
      this.addScore(seasonId, player.team, points);
    }
  }
}
