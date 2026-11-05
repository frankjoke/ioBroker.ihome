export interface PhoneLocation {
  lat: number;
  lon: number;
  accuracy?: number;
  ts: number;
}

export interface PhoneHome {
  lat: number;
  lon: number;
  radius: number;
}

export type PhoneConnection = "wifi" | "cellular" | "ethernet" | "unknown";

export interface PhoneDecision {
  atHome: boolean | null;
  homeSource: "local" | "geofence" | "none";
  location: PhoneLocation | null;
}

const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const EARTH_RADIUS_M = 6_371_000;
const DEFAULT_RADIUS_M = 150;
const MAX_RADIUS_M = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function validDeviceId(value: unknown): string | null {
  return typeof value === "string" && DEVICE_ID.test(value) && value !== "home"
    ? value
    : null;
}

export function validPhoneName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= 64 ? name : null;
}

export function validLocation(value: unknown): PhoneLocation | null {
  if (!isRecord(value)) return null;
  const lat = finite(value.lat);
  const lon = finite(value.lon);
  const ts = finite(value.ts);
  if (lat === null || lon === null || ts === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  const accuracy =
    value.accuracy === undefined ? undefined : finite(value.accuracy);
  if (accuracy === null || (accuracy !== undefined && accuracy < 0))
    return null;
  return { lat, lon, accuracy, ts };
}

export function validHome(value: unknown): PhoneHome | null {
  if (!isRecord(value)) return null;
  const lat = finite(value.lat);
  const lon = finite(value.lon);
  const radius = finite(value.radius);
  if (lat === null || lon === null || radius === null) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180 || radius <= 0) {
    return null;
  }
  return { lat, lon, radius: Math.min(radius, MAX_RADIUS_M) };
}

export function distanceMeters(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
): number {
  const toRad = (degrees: number): number => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isAtHome(location: PhoneLocation, home: PhoneHome): boolean {
  return distanceMeters(location, home) <= home.radius;
}

export function phoneDecision(
  location: PhoneLocation | null,
  home: PhoneHome | null,
): PhoneDecision {
  if (!location) return { atHome: null, homeSource: "none", location: null };
  if (!home) return { atHome: null, homeSource: "none", location };
  return isAtHome(location, home)
    ? { atHome: true, homeSource: "geofence", location: null }
    : { atHome: false, homeSource: "geofence", location };
}

export function locationText(
  location: PhoneLocation | null,
  atHome: boolean | null,
): string {
  if (atHome === true) return "At home";
  if (!location) return "Unknown";
  return `${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`;
}

export function mapUrl(location: PhoneLocation | null): string {
  if (!location) return "";
  const { lat, lon } = location;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=16/${lat}/${lon}`;
}

export function normalizeConnection(value: unknown): PhoneConnection {
  if (!isRecord(value) || typeof value.type !== "string") return "unknown";
  const type = value.type.toLowerCase();
  if (type.includes("wifi")) return "wifi";
  if (type.includes("ethernet") || type === "lan") return "ethernet";
  if (
    type.includes("cell") ||
    type.includes("mobile") ||
    /^[2345]g$/.test(type)
  ) {
    return "cellular";
  }
  return "unknown";
}

export function homeFromSystemConfig(config: unknown): PhoneHome | null {
  if (!isRecord(config) || !isRecord(config.common)) return null;
  const lat = finite(config.common.latitude);
  const lon = finite(config.common.longitude);
  if (lat === null || lon === null) return null;
  if (lat === 0 && lon === 0) return null;
  return validHome({ lat, lon, radius: DEFAULT_RADIUS_M });
}
