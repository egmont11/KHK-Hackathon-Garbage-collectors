import type { Poi } from "./types.js";
import type { PlayerVisit } from "./store.js";

/**
 * Badges: cosmetic (no points), earned per season. When a season ends they stay in the
 * player's profile as an archive, and the new season starts with none.
 */
type Context = { visits: PlayerVisit[]; pois: Map<string, Poi> };
type BadgeDefinition = {
  id: string;
  name: string;
  description: string;
  target: number;
  progress: (context: Context) => number;
};

const visitedPois = ({ visits, pois }: Context) => visits.map((visit) => pois.get(visit.poiId)).filter((poi): poi is Poi => Boolean(poi));
const inCategories = (...categories: string[]) => (context: Context) => visitedPois(context).filter((poi) => categories.includes(poi.category)).length;
const pragueHour = (at: number) => Number(new Date(at).toLocaleString("en-GB", { timeZone: "Europe/Prague", hour: "2-digit", hourCycle: "h23" }));

export const badgeDefinitions: BadgeDefinition[] = [
  { id: "prvni-krok", name: "První krok", description: "První check-in v sezóně", target: 1, progress: ({ visits }) => visits.length },
  { id: "objevitel", name: "Objevitel", description: "Navštiv 5 míst", target: 5, progress: ({ visits }) => visits.length },
  { id: "cestovatel", name: "Cestovatel", description: "Navštiv 15 míst", target: 15, progress: ({ visits }) => visits.length },
  { id: "dobyvatel", name: "Dobyvatel", description: "Navštiv 40 míst", target: 40, progress: ({ visits }) => visits.length },
  { id: "hradni-pan", name: "Hradní pán", description: "Navštiv 3 hrady nebo zámky", target: 3, progress: inCategories("hrady", "zamky") },
  { id: "vyhled", name: "Výhled!", description: "Navštiv 3 rozhledny nebo vyhlídky", target: 3, progress: inCategories("rozhledny") },
  { id: "historik", name: "Historik!", description: "Navštiv 3 muzea nebo galerie", target: 3, progress: inCategories("muzea") },
  { id: "poutni-cesta", name: "Poutní cesta", description: "Navštiv 3 církevní památky", target: 3, progress: inCategories("cirkevni") },
  { id: "sladek", name: "Sládek", description: "Navštiv 3 pivovary", target: 3, progress: inCategories("pivovary") },
  { id: "strazce-dedictvi", name: "Strážce dědictví", description: "Navštiv národní kulturní památku", target: 1, progress: (context) => visitedPois(context).filter((poi) => poi.is_nkp).length },
  {
    id: "krizem-krazem", name: "Křížem krážem", description: "Navštiv místa v 5 různých správních obvodech (ORP)", target: 5,
    progress: (context) => new Set(visitedPois(context).map((poi) => poi.orp_code).filter((code) => typeof code === "string" && /^52\d\d$/.test(code))).size,
  },
  {
    id: "dobrodruh", name: "Dobrodruh", description: "Navštiv 3 místa dál než 2 km od zastávky", target: 3,
    progress: (context) => visitedPois(context).filter((poi) => (poi.nearest_stop?.distance_m ?? 0) > 2000).length,
  },
  { id: "lovec-bonusu", name: "Lovec bonusů", description: "Navštiv 3 týdenní bonusová místa", target: 3, progress: ({ visits }) => visits.filter((visit) => visit.eventType === "weekly_poi").length },
  { id: "bet", name: "Bet?", description: "Získej denní bonus 5×", target: 5, progress: ({ visits }) => visits.filter((visit) => visit.eventType === "daily_category").length },
  { id: "prevrat", name: "Převrat", description: "Přeber místo pro svůj tým", target: 1, progress: ({ visits }) => visits.filter((visit) => visit.tookOver).length },
  { id: "ranni-ptace", name: "Ranní ptáče", description: "Check-in před 8:00", target: 1, progress: ({ visits }) => visits.filter((visit) => pragueHour(visit.at) < 8).length },
];

export type BadgeState = { id: string; name: string; description: string; target: number; progress: number; earned: boolean };

export function badgesFor(visits: PlayerVisit[], pois: Map<string, Poi>): BadgeState[] {
  return badgeDefinitions.map(({ progress, ...badge }) => {
    const value = progress({ visits, pois });
    return { ...badge, progress: Math.min(value, badge.target), earned: value >= badge.target };
  });
}

/** Badges earned by the last visit (compared to the visits before it). */
export function newlyEarned(visits: PlayerVisit[], pois: Map<string, Poi>): BadgeState[] {
  const before = new Set(badgesFor(visits.slice(0, -1), pois).filter((badge) => badge.earned).map((badge) => badge.id));
  return badgesFor(visits, pois).filter((badge) => badge.earned && !before.has(badge.id));
}
