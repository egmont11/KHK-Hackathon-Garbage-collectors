import { randomUUID } from "node:crypto";
import type { Checkin, Poi, TeamId } from "./types.js";

export type Player = { id: string; name: string; team: TeamId; token: string; createdAt: number };
export type Season = { id: string; startsAt: number; endsAt: number };
export type Visit = { poiId: string; category: string; orpCode: string | null; team: TeamId; at: number };
export type SeasonResult = { season_id: string; starts_at: string; ends_at: string; ranking: { team: TeamId; score: number }[] };

export class MemoryStore {
  readonly players = new Map<string, Player>();
  readonly checkins = new Map<string, Checkin>();
  readonly scores = new Map<string, Map<TeamId, number>>();
  readonly visits: Visit[] = [];
  readonly history: SeasonResult[] = [];
  private readonly used = new Set<string>();

  constructor(readonly pois: Map<string, Poi>) {}

  addPlayer(name: string, team: TeamId): Player {
    const player = { id: randomUUID(), name, team, token: randomUUID(), createdAt: Date.now() };
    this.players.set(player.id, player);
    return player;
  }

  playerForToken(token?: string): Player | undefined {
    if (!token) return undefined;
    return [...this.players.values()].find((player) => player.token === token);
  }

  hasVisited(playerId: string, poiId: string, seasonId: string): boolean {
    return this.used.has(`${seasonId}:${playerId}:${poiId}`);
  }

  award(player: Player, checkin: Checkin, poi: Poi): number {
    this.used.add(`${checkin.seasonId}:${player.id}:${poi.id}`);
    const points = poi.points;
    const scores = this.scores.get(checkin.seasonId) ?? new Map<TeamId, number>();
    scores.set(player.team, (scores.get(player.team) ?? 0) + points);
    this.scores.set(checkin.seasonId, scores);
    this.visits.push({ poiId: poi.id, category: poi.category, orpCode: poi.orp_code ?? null, team: player.team, at: Date.now() });
    checkin.awardedPoints = points;
    checkin.finishedAt = Date.now();
    checkin.valid = true;
    return points;
  }

  latestTeam(poiId: string): string | null {
    return [...this.visits].reverse().find((visit) => visit.poiId === poiId)?.team ?? null;
  }

  visitCount(poiId: string): number {
    return this.visits.filter((visit) => visit.poiId === poiId).length;
  }

  ranking(seasonId: string): { team: TeamId; score: number }[] {
    const scores = this.scores.get(seasonId);
    return (["hory", "reky", "lesy"] as TeamId[]).map((team) => ({ team, score: scores?.get(team) ?? 0 }));
  }

  prunePings(cutoff: number): void {
    for (const checkin of this.checkins.values()) checkin.pings = checkin.pings.filter((ping) => ping.ts >= cutoff);
  }
}
