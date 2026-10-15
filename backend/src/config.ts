export const config = {
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 3001),
  poiFile: process.env.POI_FILE ?? "../data/poi.geojson",
  checkinRadiusM: 100,
  maxAccuracyM: 50,
  requiredCheckinSeconds: Number(process.env.CHECKIN_SECONDS ?? 60),
  maxPingGapSeconds: 15,
  maxSpeedKmh: 30,
  pingRetentionHours: 24,
  // Set to a small number (for example 300) for a short demo season.
  demoSeasonSeconds: process.env.DEMO_SEASON_SECONDS ? Number(process.env.DEMO_SEASON_SECONDS) : null,
} as const;

export const teams = {
  hory: { name: "Hory", color: "#D7263D" },
  reky: { name: "Řeky", color: "#1E63B5" },
  lesy: { name: "Lesy", color: "#2E8B3E" },
} as const;

export type TeamId = keyof typeof teams;
