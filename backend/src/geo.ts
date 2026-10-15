import type { Coordinates } from "./types.js";

const earthRadiusM = 6_371_000;
export function distanceM(a: Coordinates, b: Coordinates): number {
  const rad = (degrees: number) => degrees * Math.PI / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earthRadiusM * Math.asin(Math.sqrt(h));
}

export function validCoordinates(value: unknown): value is Coordinates {
  if (!value || typeof value !== "object") return false;
  const { lat, lon } = value as Record<string, unknown>;
  return typeof lat === "number" && Number.isFinite(lat) && lat >= -90 && lat <= 90
    && typeof lon === "number" && Number.isFinite(lon) && lon >= -180 && lon <= 180;
}
