import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { config } from "./config.js";
import { distanceM } from "./geo.js";
import type { Coordinates, Poi } from "./types.js";

/**
 * Questy:
 * - weekly (týmový): pár míst aspoň WEEKLY_MIN_DISTANCE_KM od sebe, stejná pro všechny; vyhrává tým,
 *   jehož nejvíc hráčů místo během týdne zabralo (vyhodnocení v server.ts, odměna WEEKLY_QUEST_POINTS),
 * - daily (osobní): každý hráč má svou kategorii míst na den; první zabrané místo té kategorie ×1.4.
 * Picks are deterministic per round, so restarts and multiple instances agree without a scheduler.
 * When both apply to one POI, the higher multiplier wins (they don't stack).
 */

export type WeeklyEvent = { id: string; type: "weekly_poi"; poiId: string; multiplier: number; startsAt: number; endsAt: number };
export type DailyEvent = { id: string; type: "daily_quest"; category: string; multiplier: number; startsAt: number; endsAt: number };
export type QuickEvent = WeeklyEvent | DailyEvent;
export type Bonus = { multiplier: number; event: QuickEvent | null };

/** Categories eligible for the daily bonus (×1.4 at every place of the category). */
export const dailyBonusCategories = [
  "rozhledny", "hrady", "zamky", "pevnosti", "muzea", "priroda", "cirkevni", "technicke", "architektura", "historicke",
  "zidovske", "zvony", "pivovary", "potraviny", "remesla", "lanovky", "koupani", "divadla", "cyklovylety",
];

/** Places that make poor weekly destinations (hotels, libraries, info desks). */
const weeklyExcludedCategories = new Set(["sluzby", "knihovny", "infocentra", "kempy", "lazne", "solne_jeskyne"]);

/** Monday 2024-01-01, local midnight. Rounds are counted in Prague local time from here. */
const EPOCH_LOCAL = Date.UTC(2024, 0, 1);

function pragueOffsetMs(at: number): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return local - Math.floor(at / 1000) * 1000;
}

/** Round index and its UTC bounds; full days are aligned to Prague midnight, demo rounds to UTC. */
function roundAt(now: number, lengthS: number) {
  const length = lengthS * 1000;
  const aligned = lengthS % 86400 === 0;
  const local = aligned ? now + pragueOffsetMs(now) : now;
  const index = Math.floor((local - EPOCH_LOCAL) / length);
  const toUtc = (localMs: number) => aligned ? localMs - pragueOffsetMs(localMs - pragueOffsetMs(localMs)) : localMs;
  return { index, startsAt: toUtc(EPOCH_LOCAL + index * length), endsAt: toUtc(EPOCH_LOCAL + (index + 1) * length) };
}

function seededRandom(seed: string) {
  let state = createHash("sha1").update(seed).digest().readUInt32LE(0);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function uuidFrom(seed: string) {
  const hex = createHash("sha1").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export class EventManager {
  private weeklyCache: { round: number; events: WeeklyEvent[] } | null = null;
  private readonly weeklyCandidates: (Poi & Coordinates)[];
  private readonly dailyCategories: string[];
  readonly categoryLabels = new Map<string, string>();
  readonly categoryCounts = new Map<string, number>();

  constructor(pois: Iterable<Poi>, pointFor: (poiId: string) => Coordinates | undefined, private readonly pool?: Pool) {
    const all = [...pois].sort((a, b) => a.id.localeCompare(b.id));
    for (const poi of all) {
      this.categoryCounts.set(poi.category, (this.categoryCounts.get(poi.category) ?? 0) + 1);
      this.categoryLabels.set(poi.category, poi.category_label ?? poi.category);
    }
    this.weeklyCandidates = all
      .filter((poi) => poi.group !== "sluzby" && !weeklyExcludedCategories.has(poi.category))
      .flatMap((poi) => { const point = pointFor(poi.id); return point ? [{ ...poi, ...point }] : []; });
    // A daily bonus category needs enough places that most players have one within reach.
    this.dailyCategories = dailyBonusCategories.filter((category) => (this.categoryCounts.get(category) ?? 0) >= 10);
  }

  weekly(now = Date.now()): WeeklyEvent[] {
    if (!config.eventsEnabled || !this.weeklyCandidates.length || config.weeklyEventCount <= 0) return [];
    const round = roundAt(now, config.weeklyPeriodSeconds);
    if (this.weeklyCache?.round === round.index) return this.weeklyCache.events;
    const order = shuffled(this.weeklyCandidates, seededRandom(`krajanek-weekly-${round.index}-${config.weeklyPeriodSeconds}`));
    // Greedy pick with the minimum spacing; relax it only if the catalog can't satisfy it.
    let chosen: (Poi & Coordinates)[] = [];
    for (let minKm = config.weeklyMinDistanceKm; ; minKm *= 0.8) {
      chosen = [];
      for (const poi of order) {
        if (chosen.every((other) => distanceM(poi, other) >= minKm * 1000)) chosen.push(poi);
        if (chosen.length === config.weeklyEventCount) break;
      }
      if (chosen.length === Math.min(config.weeklyEventCount, order.length) || minKm < 0.1) break;
    }
    const events = chosen.map((poi): WeeklyEvent => ({
      id: uuidFrom(`weekly:${round.index}:${config.weeklyPeriodSeconds}:${poi.id}`), type: "weekly_poi", poiId: poi.id,
      multiplier: config.weeklyMultiplier, startsAt: round.startsAt, endsAt: round.endsAt,
    }));
    this.weeklyCache = { round: round.index, events };
    void this.persist(events);
    return events;
  }

  /** Globální denní bonus už není, denní quest je osobní (viz dailyFor). Zůstává kvůli statistikám/demo datům. */
  daily(_now = Date.now()): DailyEvent | null {
    return null;
  }

  /** Hranice týdenního kola, ve kterém leží `at`. */
  weeklyRound(at = Date.now()) {
    return roundAt(at, config.weeklyPeriodSeconds);
  }

  active(now = Date.now()): QuickEvent[] {
    return this.weekly(now);
  }

  /** Osobní denní quest hráče: kategorie odvozená z hráče a dne (stejná po restartu). */
  dailyFor(playerId: string, now = Date.now()): DailyEvent | null {
    if (!config.eventsEnabled || !this.dailyCategories.length) return null;
    const round = roundAt(now, config.dailyPeriodSeconds);
    const rand = seededRandom(`krajanek-daily-${round.index}-${config.dailyPeriodSeconds}-${playerId}`);
    const category = this.dailyCategories[Math.floor(rand() * this.dailyCategories.length)];
    return {
      id: uuidFrom(`daily:${round.index}:${config.dailyPeriodSeconds}:${playerId}`), type: "daily_quest", category,
      multiplier: config.dailyMultiplier, startsAt: round.startsAt, endsAt: round.endsAt,
    };
  }

  /** Týdenní quest na tomto místě (bez násobku), nebo osobní denní quest hráče (×1.4, jen dokud není splněný). */
  bonusFor(poi: Poi, now = Date.now(), daily: DailyEvent | null = null): Bonus {
    if (daily && daily.category === poi.category) return { multiplier: daily.multiplier, event: daily };
    const weekly = this.weekly(now).find((event) => event.poiId === poi.id);
    return weekly ? { multiplier: weekly.multiplier, event: weekly } : { multiplier: 1, event: null };
  }

  private async persist(events: QuickEvent[]) {
    if (!this.pool) return;
    try {
      for (const event of events) await this.pool.query(
        `INSERT INTO events (id, type, poi_id, category, starts_at, ends_at, multiplier) VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO NOTHING`,
        [event.id, event.type, event.type === "weekly_poi" ? event.poiId : null, event.type === "daily_quest" ? event.category : null,
          new Date(event.startsAt).toISOString(), new Date(event.endsAt).toISOString(), event.multiplier],
      );
    } catch (error) {
      console.warn("Nepodařilo se uložit eventy:", error);
    }
  }
}
