export interface PushPayload {
  title: string;
  body: string;
  level: "info" | "warn" | "error";
  tag?: string;
  url?: string;
  showBody?: boolean;
}

export interface PushNotificationOptions {
  body: string;
  tag?: string;
  requireInteraction: boolean;
  data: { url: string };
}

const TITLE_MAX = 80;
const BODY_MAX = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function optionalText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

export function parsePushMessage(data: unknown): PushPayload | null {
  if (!isRecord(data)) return null;
  const title = optionalText(data.title, TITLE_MAX);
  if (!title) return null;
  const body = typeof data.body === "string" ? data.body.trim() : "";
  if (body.length > BODY_MAX) return null;
  const rawLevel = data.level;
  const level =
    rawLevel === "warn" || rawLevel === "warning"
      ? "warn"
      : rawLevel === "error"
        ? "error"
        : "info";
  const tag = optionalText(data.tag, 64);
  const url = optionalText(data.url, 512);
  return {
    title,
    body,
    level,
    ...(tag ? { tag } : {}),
    ...(url ? { url } : {}),
    ...(data.showBody === true ? { showBody: true } : {}),
  };
}

/** Generic lock-screen text unless the user opted into the full body. */
export function notificationTitle(message: PushPayload): string {
  return message.showBody ? message.title : "iHome";
}

export function notificationOptions(
  message: PushPayload,
): PushNotificationOptions {
  return {
    body: message.showBody ? message.body : "New notification",
    tag: message.tag,
    requireInteraction: message.level === "error",
    data: { url: message.url ?? "" },
  };
}

/** Resolve a notification target inside the app; other origins fall back. */
export function notificationTarget(
  url: string | undefined,
  scope: string,
): string {
  const base = new URL(scope);
  const target = new URL((url ?? "").replace(/^\/+/, ""), base);
  return target.origin === base.origin ? target.href : base.href;
}

export function base64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}
