import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { config } from "./config.js";
import type { Poi } from "./types.js";

export type QuickEvent = {
  id: string;
  type: "bonus_poi";
  poi_id: string;
  multiplier: number;
  startsAt: number;
  endsAt: number;
};

/** Monday 2024-01-01 00:00 UTC, so weekly rounds start on Mondays. */
const EPOCH = Date.UTC(2024, 0, 1);

function seededRandom(seed: string) {
  let state = createHash("sha1").update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuidFrom(seed: string) {
  const hex = createHash("sha1").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Quick time events: every round (a week, or a fraction of a demo season) a few POIs
 * become bonus POIs worth 2–3× points. Picks are deterministic per round, so restarts
 * and multiple instances agree without any scheduler.
 */
export class EventManager {
  private cache: { round: number; events: QuickEvent[] } | null = null;
  private readonly candidates: Poi[];

  constructor(pois: Iterable<Poi>, private readonly pool?: Pool) {
    // Prefer places worth visiting but not the most crowded ones, sorted for determinism.
    this.candidates = [...pois].filter((poi) => poi.group !== "sluzby").sort((a, b) => a.id.localeCompare(b.id));
  }

  active(now = Date.now()): QuickEvent[] {
    if (!config.eventsEnabled || !this.candidates.length) return [];
    const length = config.eventPeriodSeconds * 1000;
    const round = Math.floor((now - EPOCH) / length);
    if (this.cache?.round === round) return this.cache.events;
    const rand = seededRandom(`turistak-round-${round}-${length}`);
    const startsAt = EPOCH + round * length;
    const events: QuickEvent[] = [];
    const usedGroups = new Set<string>();
    for (let attempt = 0; attempt < 200 && events.length < config.eventsPerPeriod; attempt++) {
      const poi = this.candidates[Math.floor(rand() * this.candidates.length)];
      const group = poi.group ?? "ostatni";
      if (usedGroups.has(group) || events.some((event) => event.poi_id === poi.id)) continue;
      usedGroups.add(group);
      events.push({
        id: uuidFrom(`${round}:${length}:${poi.id}`),
        type: "bonus_poi",
        poi_id: poi.id,
        multiplier: rand() < 0.3 ? 3 : 2,
        startsAt,
        endsAt: startsAt + length,
      });
    }
    this.cache = { round, events };
    void this.persist(events);
    return events;
  }

  multiplierFor(poiId: string, now = Date.now()): number {
    return this.active(now).find((event) => event.poi_id === poiId)?.multiplier ?? 1;
  }

  private async persist(events: QuickEvent[]) {
    if (!this.pool) return;
    try {
      for (const event of events) await this.pool.query(
        `INSERT INTO events (id, type, poi_id, starts_at, ends_at, multiplier) VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO NOTHING`,
        [event.id, event.type, event.poi_id, new Date(event.startsAt).toISOString(), new Date(event.endsAt).toISOString(), event.multiplier],
      );
    } catch (error) {
      console.warn("Nepodařilo se uložit eventy:", error);
    }
  }
}
