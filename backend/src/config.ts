const num = (value: string | undefined, fallback: number) => {
  const parsed = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(parsed) ? parsed : fallback;
};

// --demo is isolated in memory, with a shorter check-in and synthetic visits.
// Proměnné prostředí mají vždy přednost.
const demoMode = process.argv.includes("--demo");
const production = process.env.NODE_ENV === "production";
if (demoMode && (production || process.env.DATABASE_URL || process.env.PGHOST)) throw new Error("Demo requires an isolated in-memory development server.");
const positive = (key: string, fallback: number) => {
  const value = num(process.env[key], fallback);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} must be a positive integer`);
  return value;
};
const demoSeasonSeconds = process.env.DEMO_SEASON_SECONDS ? num(process.env.DEMO_SEASON_SECONDS, 0) || null : null;

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  demoMode,
  production,
  trustedProxies: process.env.TRUSTED_PROXIES?.split(",").map((value) => value.trim()).filter(Boolean) ?? [],
  corsOrigins: process.env.CORS_ORIGINS?.split(",").map((value) => value.trim()).filter(Boolean) ?? [],
  requireHttps: production,
  playerSessionHours: positive("PLAYER_SESSION_HOURS", 24 * 7),
  maxPlayers: positive("MAX_PLAYERS", 10_000),
  registrationLimit: positive("REGISTRATIONS_PER_HOUR", 5),
  adminPasswordFile: process.env.ADMIN_PASSWORD_FILE ?? ".admin-initial-password",
  port: num(process.env.PORT, 3001),
  poiFile: process.env.POI_FILE ?? "../data/poi.geojson",
  checkinRadiusM: num(process.env.CHECKIN_RADIUS_M, 100),
  maxAccuracyM: num(process.env.MAX_ACCURACY_M, 50),
  requiredCheckinSeconds: num(process.env.CHECKIN_SECONDS, demoMode ? 10 : 60),
  maxPingGapSeconds: 15,
  maxSpeedKmh: 30,
  pingRetentionHours: 24,
  /** Unfinished check-ins older than this are dropped from memory. */
  staleCheckinMinutes: 60,
  // Set to a small number (for example 300) for a short demo season.
  demoSeasonSeconds,
  /**
   * Quick time events (working name). Weekly: N bonus POIs, the same for everyone, at least
   * `weeklyMinDistanceKm` apart. Daily: one category challenge ("visit a lookout tower").
   * Rounds start at midnight Europe/Prague (weekly on Mondays). In demo-season mode they
   * are shortened so they rotate during the pitch.
   */
  eventsEnabled: process.env.EVENTS !== "0",
  weeklyEventCount: num(process.env.WEEKLY_EVENT_COUNT, 3),
  weeklyMultiplier: num(process.env.WEEKLY_MULTIPLIER, 1),
  /** Týdenní týmový quest: tým, jehož nejvíc hráčů místo během týdne zabralo, dostane tolik bodů. */
  weeklyQuestReward: num(process.env.WEEKLY_QUEST_POINTS, 200),
  weeklyMinDistanceKm: num(process.env.WEEKLY_MIN_DISTANCE_KM, 50),
  weeklyPeriodSeconds: num(process.env.WEEKLY_EVENT_SECONDS, demoSeasonSeconds ? Math.max(60, Math.round(demoSeasonSeconds / 2)) : 7 * 86400),
  dailyMultiplier: num(process.env.DAILY_MULTIPLIER, 1.4),
  dailyPeriodSeconds: num(process.env.DAILY_EVENT_SECONDS, demoSeasonSeconds ? Math.max(30, Math.round(demoSeasonSeconds / 6)) : 86400),
  /** Generate synthetic visits for the region dashboard (memory mode only). */
  demoSeedVisits: num(process.env.DEMO_SEED, demoMode ? 800 : 0),
  /** Built-in administrator for the region dashboard / statistics. */
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminInitialPassword: process.env.ADMIN_PASSWORD || null,
  /** ADMIN_RESET=1 resets the built-in admin's password on startup (lost password). */
  adminReset: process.env.ADMIN_RESET === "1",
  /** ADMIN_MUST_CHANGE=0 skips the forced password change (handy for repeated in-memory demos). */
  adminMustChange: process.env.ADMIN_MUST_CHANGE !== "0",
  adminSessionHours: num(process.env.ADMIN_SESSION_HOURS, 12),
  adminMinPasswordLength: 10,
} as const;

if (production && (config.requiredCheckinSeconds < 60 || config.checkinRadiusM > 100 || config.maxAccuracyM > 50 || config.demoSeasonSeconds !== null || config.demoSeedVisits > 0)) {
  throw new Error("Production game rules cannot enable demo shortcuts");
}

export const teams = {
  hory: { name: "Hory", color: "#C2412F" },
  reky: { name: "Řeky", color: "#2F5D9E" },
  lesy: { name: "Lesy", color: "#4A7A3A" },
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
