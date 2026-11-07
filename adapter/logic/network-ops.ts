import { isIP } from "node:net";

/** One configured network device (adapter native config). */
export interface NetworkDevice {
  id: string;
  name: string;
  host: string;
  mac?: string;
  interval: number;
  timeout: number;
  /** 0 = ICMP ping; > 0 = TCP connect to this port. */
  port: number;
}

export type NetworkStatus = "online" | "offline" | "unknown";

/** One device's live presence, persisted in its JSON state. */
export interface NetworkPresence {
  online: boolean;
  status: NetworkStatus;
  /** Consecutive failed probes (for the offline debounce). */
  failures: number;
  lastConnected: number;
  lastDisconnected: number;
  lastSeen: number;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** IPv4 or hostname; no shell metacharacters, no leading dash. */
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const MAC = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function numberIn(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

/** A safe device entry, or null. Values are clamped to their bounds. */
export function validNetworkDevice(value: unknown): NetworkDevice | null {
  if (!record(value)) return null;
  const id = typeof value.id === "string" ? value.id : "";
  if (!ID.test(id)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name || name.length > 64) return null;
  const host = typeof value.host === "string" ? value.host.trim() : "";
  if (!host || host.length > 253) return null;
  if (isIP(host) === 0 && !HOST.test(host)) return null;
  let mac: string | undefined;
  if (value.mac !== undefined && value.mac !== "") {
    if (typeof value.mac !== "string" || !MAC.test(value.mac)) return null;
    mac = value.mac.toLowerCase();
  }
  return {
    id,
    name,
    host,
    ...(mac ? { mac } : {}),
    interval: numberIn(value.interval, 10, 3600, 60),
    timeout: numberIn(value.timeout, 1, 30, 2),
    port: numberIn(value.port, 0, 65535, 0),
  };
}

/** The valid entries of a native config array; duplicate ids keep the first. */
export function validNetworkDevices(value: unknown): NetworkDevice[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const devices: NetworkDevice[] = [];
  for (const entry of value) {
    const device = validNetworkDevice(entry);
    if (!device || seen.has(device.id)) continue;
    seen.add(device.id);
    devices.push(device);
  }
  return devices;
}

export function initialPresence(): NetworkPresence {
  return {
    online: false,
    status: "unknown",
    failures: 0,
    lastConnected: 0,
    lastDisconnected: 0,
    lastSeen: 0,
  };
}

/** Apply one probe result, with the offline debounce and timestamps. */
export function nextPresence(
  previous: NetworkPresence,
  online: boolean,
  now: number,
  failuresBeforeOffline = 2,
): NetworkPresence {
  if (online) {
    return {
      online: true,
      status: "online",
      failures: 0,
      lastConnected: previous.online ? previous.lastConnected : now,
      lastDisconnected: previous.lastDisconnected,
      lastSeen: now,
    };
  }
  const failures = previous.failures + 1;
  if (failures < Math.max(1, failuresBeforeOffline)) {
    return { ...previous, failures };
  }
  return {
    online: false,
    status: "offline",
    failures,
    lastConnected: previous.lastConnected,
    lastDisconnected: previous.online ? now : previous.lastDisconnected,
    lastSeen: previous.lastSeen,
  };
}

/** The stable JSON contract the template reads, plus `failures` for restarts. */
export function presenceJsonValue(presence: NetworkPresence) {
  return {
    online: presence.online,
    status: presence.status,
    failures: presence.failures,
    lastConnected: presence.lastConnected,
    lastDisconnected: presence.lastDisconnected,
    lastSeen: presence.lastSeen,
  };
}

/** Parse a persisted JSON state; null when it is not a presence object. */
export function presenceFromJson(raw: unknown): NetworkPresence | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!record(value)) return null;
  const status: NetworkStatus =
    value.status === "online" ||
    value.status === "offline" ||
    value.status === "unknown"
      ? value.status
      : "unknown";
  const number = (field: string) =>
    typeof value[field] === "number" && Number.isFinite(value[field])
      ? (value[field] as number)
      : 0;
  return {
    online: value.online === true,
    status,
    failures: Math.max(0, Math.round(number("failures"))),
    lastConnected: number("lastConnected"),
    lastDisconnected: number("lastDisconnected"),
    lastSeen: number("lastSeen"),
  };
}
