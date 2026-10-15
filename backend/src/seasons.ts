import { randomUUID } from "node:crypto";
import type { MemoryStore } from "./store.js";
import { config } from "./config.js";
import type { TeamId } from "./types.js";

export class SeasonManager {
  private active: { id: string; startsAt: number; endsAt: number };

  constructor(private store: MemoryStore, now = Date.now()) {
    this.active = this.makeSeason(now);
  }

  current(now = Date.now()) {
    while (now >= this.active.endsAt) {
      this.store.history.push({
        season_id: this.active.id,
        starts_at: new Date(this.active.startsAt).toISOString(),
        ends_at: new Date(this.active.endsAt).toISOString(),
        ranking: this.store.ranking(this.active.id),
      });
      this.active = this.makeSeason(this.active.endsAt);
    }
    return this.active;
  }

  history() {
    return [...this.store.history].reverse();
  }

  private makeSeason(start: number) {
    const quarter = Math.floor(new Date(start).getUTCMonth() / 3);
    const startsAt = config.demoSeasonSeconds === null
      ? Date.UTC(new Date(start).getUTCFullYear(), quarter * 3, 1)
      : start;
    const endsAt = config.demoSeasonSeconds === null
      ? Date.UTC(new Date(startsAt).getUTCFullYear(), quarter * 3 + 3, 1)
      : startsAt + config.demoSeasonSeconds * 1000;
    const id = config.demoSeasonSeconds === null
      ? `${new Date(startsAt).getUTCFullYear()}-Q${quarter + 1}`
      : `demo-${randomUUID()}`;
    return { id, startsAt, endsAt };
  }
}

export function publicSeason(season: { id: string; startsAt: number; endsAt: number }) {
  return { season_id: season.id, starts_at: new Date(season.startsAt).toISOString(), ends_at: new Date(season.endsAt).toISOString() };
}

export type RankingTeam = TeamId;
