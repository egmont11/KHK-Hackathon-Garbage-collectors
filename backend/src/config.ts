const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
};

const demoSeasonSeconds = process.env.DEMO_SEASON_SECONDS ? num(process.env.DEMO_SEASON_SECONDS, 0) || null : null;

export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: num(process.env.PORT, 3001),
  poiFile: process.env.POI_FILE ?? "../data/poi.geojson",
  checkinRadiusM: num(process.env.CHECKIN_RADIUS_M, 100),
  maxAccuracyM: num(process.env.MAX_ACCURACY_M, 50),
  requiredCheckinSeconds: num(process.env.CHECKIN_SECONDS, 60),
  maxPingGapSeconds: 15,
  maxSpeedKmh: 30,
  pingRetentionHours: 24,
  /** Unfinished check-ins older than this are dropped from memory. */
  staleCheckinMinutes: 60,
  // Set to a small number (for example 300) for a short demo season.
  demoSeasonSeconds,
  /** Quick time events: length of one event round and how many bonus POIs it has. */
  eventPeriodSeconds: num(process.env.EVENT_PERIOD_SECONDS, demoSeasonSeconds ? Math.max(60, Math.round(demoSeasonSeconds / 3)) : 7 * 24 * 3600),
  eventsPerPeriod: num(process.env.EVENTS_PER_PERIOD, 3),
  eventsEnabled: process.env.EVENTS !== "0",
  /** Generate synthetic visits for the region dashboard (memory mode only). */
  demoSeedVisits: num(process.env.DEMO_SEED, process.argv.includes("--demo") ? 800 : 0),
} as const;

export const teams = {
  hory: { name: "Hory", color: "#D7263D" },
  reky: { name: "Řeky", color: "#1E63B5" },
  lesy: { name: "Lesy", color: "#2E8B3E" },
} as const;

export type TeamId = keyof typeof teams;
export const teamIds = Object.keys(teams) as TeamId[];

/** ORP (obce s rozšířenou působností) of Královéhradecký kraj. */
export const orpNames: Record<string, string> = {
  "5201": "Broumov", "5202": "Dobruška", "5203": "Dvůr Králové nad Labem", "5204": "Hořice",
  "5205": "Hradec Králové", "5206": "Jaroměř", "5207": "Jičín", "5208": "Kostelec nad Orlicí",
  "5209": "Náchod", "5210": "Nová Paka", "5211": "Nové Město nad Metují", "5212": "Nový Bydžov",
  "5213": "Rychnov nad Kněžnou", "5214": "Trutnov", "5215": "Vrchlabí",
};

export const groupLabels: Record<string, string> = {
  pamatky: "Památky", priroda: "Příroda", kultura: "Kultura", sport: "Sport",
  gastro: "Gastro a řemesla", sluzby: "Služby", ostatni: "Ostatní",
};
