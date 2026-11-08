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

export interface VapidKeyPair {
  publicKey: string;
  privateKey: string;
  generated: boolean;
}

function validVapidKey(value: unknown, bytes: number): string | null {
  if (typeof value !== "string") return null;
  const key = value.trim();
  if (!/^[A-Za-z0-9\-_]+$/.test(key)) return null;
  try {
    return Buffer.from(key, "base64url").length === bytes ? key : null;
  } catch {
    return null;
  }
}

/** Keep a valid pair; generate a fresh one when either key is missing or bad. */
export function ensureVapidKeys(
  publicKey: unknown,
  privateKey: unknown,
  generate: () => { publicKey: string; privateKey: string },
): VapidKeyPair | null {
  const pub = validVapidKey(publicKey, 65);
  const priv = validVapidKey(privateKey, 32);
  if (pub && priv)
    return { publicKey: pub, privateKey: priv, generated: false };
  try {
    const next = generate();
    const nextPub = validVapidKey(next.publicKey, 65);
    const nextPriv = validVapidKey(next.privateKey, 32);
    return nextPub && nextPriv
      ? { publicKey: nextPub, privateKey: nextPriv, generated: true }
      : null;
  } catch {
    return null;
  }
}

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

export function normalizePushPayload(value: unknown): PushPayload {
  const record = isRecord(value) ? value : {};
  const title =
    (typeof record.title === "string" ? record.title.trim() : "").slice(
      0,
      TITLE_MAX,
    ) || "iHome";
  const body = (
    typeof record.body === "string" ? record.body.trim() : ""
  ).slice(0, BODY_MAX);
  const rawLevel = record.level;
  const level =
    rawLevel === "warn" || rawLevel === "warning"
      ? "warn"
      : rawLevel === "error"
        ? "error"
        : "info";
  const tag = optionalText(record.tag, 64);
  const url = optionalText(record.url, 512);
  return {
    title,
    body,
    level,
    ...(tag ? { tag } : {}),
    ...(url ? { url } : {}),
    ...(record.showBody === true ? { showBody: true } : {}),
  };
}

/**
 * A written text state as a push message: one line is the body under the app
 * title; with two or more lines the first is the title and the rest the body.
 */
export function pushStatePayload(value: unknown): PushPayload | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  const hasTitle = lines.length > 1;
  const title = hasTitle ? lines[0].trim() : "";
  const body = hasTitle ? lines.slice(1).join("\n").trim() : text;
  return normalizePushPayload({ title: title || "iHome", body });
}

export function upsertPushSubscription(
  subscriptions: PushSubscriptionRecord[],
  record: PushSubscriptionRecord,
): PushSubscriptionRecord[] {
  return [
    ...subscriptions.filter(
      (entry) =>
        entry.deviceId !== record.deviceId &&
        entry.endpoint !== record.endpoint,
    ),
    record,
  ];
}

export function removePushSubscription(
  subscriptions: PushSubscriptionRecord[],
  deviceId: string,
): PushSubscriptionRecord[] {
  return subscriptions.filter((entry) => entry.deviceId !== deviceId);
}

export interface PushSendError {
  deviceId: string;
  statusCode: number;
  error: string;
}

export interface PushSendResult {
  sent: number;
  removed: number;
  subscriptions: PushSubscriptionRecord[];
  errors: PushSendError[];
}

export async function sendPushes(
  subscriptions: PushSubscriptionRecord[],
  payload: PushPayload,
  send: (entry: PushSubscriptionRecord) => Promise<unknown>,
): Promise<PushSendResult> {
  const kept: PushSubscriptionRecord[] = [];
  const errors: PushSendError[] = [];
  let sent = 0;
  let removed = 0;
  for (const entry of subscriptions) {
    try {
      await send(entry);
      sent += 1;
      kept.push(entry);
    } catch (error) {
      const statusCode =
        isRecord(error) && typeof error.statusCode === "number"
          ? error.statusCode
          : 0;
      if (shouldDropSubscription(statusCode)) {
        removed += 1;
      } else {
        kept.push(entry);
        errors.push({
          deviceId: entry.deviceId,
          statusCode,
          error: String(error),
        });
      }
    }
  }
  return { sent, removed, subscriptions: kept, errors };
}

export function shouldDropSubscription(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 410;
}
