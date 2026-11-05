import { validDeviceId } from "./logic/phone-ops";

export interface PushSubscriptionRecord {
  deviceId: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  name?: string;
  ts: number;
}

export interface PushPayload {
  title: string;
  body: string;
  level: "info" | "warn" | "error";
  tag?: string;
  url?: string;
  showBody?: boolean;
}

const TITLE_MAX = 80;
const BODY_MAX = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return null;
  return trimmed;
}

function optionalText(value: unknown, max: number): string | undefined {
  if (value === undefined || value === null) return undefined;
  return text(value, max) ?? undefined;
}

export function validPushSubscription(
  value: unknown,
): PushSubscriptionRecord | null {
  if (!isRecord(value)) return null;
  const deviceId = validDeviceId(value.deviceId);
  const endpoint = text(value.endpoint, 2048);
  if (!deviceId || !endpoint || !endpoint.startsWith("https://")) return null;
  if (!isRecord(value.keys)) return null;
  const p256dh = text(value.keys.p256dh, 512);
  const auth = text(value.keys.auth, 512);
  if (!p256dh || !auth) return null;
  const ts =
    typeof value.ts === "number" && Number.isFinite(value.ts)
      ? value.ts
      : Date.now();
  const name = optionalText(value.name, 64);
  return {
    deviceId,
    endpoint,
    keys: { p256dh, auth },
    ...(name ? { name } : {}),
    ts,
  };
}

export function validPushPayload(value: unknown): PushPayload | null {
  if (!isRecord(value)) return null;
  const title = text(value.title, TITLE_MAX);
  if (!title) return null;
  const rawBody = typeof value.body === "string" ? value.body.trim() : "";
  if (rawBody.length > BODY_MAX) return null;
  const rawLevel = value.level;
  const level =
    rawLevel === "warn" || rawLevel === "warning"
      ? "warn"
      : rawLevel === "error"
        ? "error"
        : "info";
  const tag = optionalText(value.tag, 64);
  const url = optionalText(value.url, 512);
  return {
    title,
    body: rawBody,
    level,
    ...(tag ? { tag } : {}),
    ...(url ? { url } : {}),
    ...(value.showBody === true ? { showBody: true } : {}),
  };
}

export function shouldDropSubscription(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}
