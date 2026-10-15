import { randomUUID } from "node:crypto";
import type { MemoryStore, Season } from "./store.js";
import { config } from "./config.js";

/** Seasons roll over lazily on read/write (no cron). 1 season = calendar quarter, or DEMO_SEASON_SECONDS. */
export class SeasonManager {
  private active: Season;

  constructor(private store: MemoryStore, now = Date.now()) {
    const resume = store.resumeSeason;
    const resumable = resume && (config.demoSeasonSeconds === null) === !resume.id.startsWith("demo-");
    this.active = resumable ? resume : this.makeSeason(now);
  }

  current(now = Date.now()): Season {
    while (now >= this.active.endsAt) {
      this.store.history.push({
        season_id: this.active.id,
        starts_at: new Date(this.active.startsAt).toISOString(),
        ends_at: new Date(this.active.endsAt).toISOString(),
        ranking: this.store.ranking(this.active.id),
      });
      // In demo mode, skip empty seasons that passed while nobody was looking.
      const next = config.demoSeasonSeconds !== null && now - this.active.endsAt > config.demoSeasonSeconds * 1000 ? now : this.active.endsAt;
      this.active = this.makeSeason(next);
    }
    return this.active;
  }

  history() {
    return [...this.store.history].reverse();
  }

  private makeSeason(start: number): Season {
    if (config.demoSeasonSeconds !== null) {
      return { id: `demo-${randomUUID().slice(0, 8)}`, startsAt: start, endsAt: start + config.demoSeasonSeconds * 1000 };
    }
    const date = new Date(start);
    const quarter = Math.floor(date.getUTCMonth() / 3);
    const startsAt = Date.UTC(date.getUTCFullYear(), quarter * 3, 1);
    const endsAt = Date.UTC(date.getUTCFullYear(), quarter * 3 + 3, 1);
    return { id: `${date.getUTCFullYear()}-Q${quarter + 1}`, startsAt, endsAt };
  }
}

export function publicSeason(season: Season, now = Date.now()) {
  return {
    season_id: season.id,
    starts_at: new Date(season.startsAt).toISOString(),
    ends_at: new Date(season.endsAt).toISOString(),
    remaining_s: Math.max(0, Math.round((season.endsAt - now) / 1000)),
  };
}
