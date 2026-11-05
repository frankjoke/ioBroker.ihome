import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { isLocalBroker } from "$lib/stores/connection.svelte";
import {
  homeFromSystemConfig,
  normalizeConnection,
  type PhoneConnection,
  type PhoneHome,
  type PhoneLocation,
} from "$logic/phone-ops";

const STORAGE_KEY = "__VISUAL__:phone";
const HEARTBEAT_MS = 60_000;
const DEFAULT_NAME = "This phone";

export interface PhoneSettings {
  deviceId: string;
  name: string;
  enabled: boolean;
  paused: boolean;
  home?: PhoneHome;
}

export interface PhoneStatus {
  atHome: boolean | null;
  homeSource: "local" | "geofence" | "none";
  location: PhoneLocation | null;
  locationText: string;
  mapUrl: string;
  distance: number | null;
  online: boolean;
  connection: PhoneConnection;
  local: boolean;
  permission: "granted" | "denied" | "prompt" | "unsupported";
  lastSeen: number;
}

export const phone = $state<PhoneSettings & { status: PhoneStatus }>({
  deviceId: "",
  name: DEFAULT_NAME,
  enabled: false,
  paused: false,
  status: {
    atHome: null,
    homeSource: "none",
    location: null,
    locationText: "Unknown",
    mapUrl: "",
    distance: null,
    online: true,
    connection: "unknown",
    local: false,
    permission: "prompt",
    lastSeen: 0,
  },
});

let initialized = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let listeners = false;

function newDeviceId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `phone-${Math.random().toString(36).slice(2, 12)}`;
  }
}

function readSettings(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const value = raw ? JSON.parse(raw) : null;
    if (value && typeof value === "object") {
      phone.deviceId =
        typeof value.deviceId === "string" && value.deviceId
          ? value.deviceId
          : newDeviceId();
      phone.name =
        typeof value.name === "string" && value.name.trim()
          ? value.name.trim()
          : DEFAULT_NAME;
      phone.enabled = value.enabled === true;
      phone.paused = value.paused === true;
      if (value.home && typeof value.home === "object") {
        phone.home = value.home;
      }
    }
  } catch {
    // corrupt storage: start fresh
  }
  if (!phone.deviceId) phone.deviceId = newDeviceId();
}

function saveSettings(): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        deviceId: phone.deviceId,
        name: phone.name,
        enabled: phone.enabled,
        paused: phone.paused,
        home: phone.home,
      }),
    );
  } catch {
    // private mode: keep the in-memory settings
  }
}

function send(command: string, data: Record<string, unknown>): void {
  if (!ioBroker.connected) return;
  void ioBroker
    .sendTo(ioBroker.namespace, "phone", data)
    .catch((error: unknown) => console.warn("phone:", error));
}

function baseData(): Record<string, unknown> {
  return {
    enabled: true,
    online: navigator.onLine,
    connection: normalizeConnection((navigator as any).connection),
    local: isLocalBroker(),
    permission: phone.status.permission,
    atHome: phone.status.atHome,
    homeSource: phone.status.homeSource,
    location: phone.status.location,
    locationText: phone.status.locationText,
    mapUrl: phone.status.mapUrl,
    distance: phone.status.distance,
    lastSeen: Date.now(),
  };
}

/** Report the cheap fields; geolocation is handled by requestPhoneLocation. */
export function reportPhone(): void {
  if (!phone.enabled || phone.paused) return;
  phone.status.online = navigator.onLine;
  phone.status.connection = normalizeConnection((navigator as any).connection);
  phone.status.local = isLocalBroker();
  phone.status.lastSeen = Date.now();
  send("update", {
    action: "update",
    deviceId: phone.deviceId,
    data: baseData(),
  });
}

function registerPhone(): void {
  send("register", {
    action: "register",
    deviceId: phone.deviceId,
    name: phone.name,
    enabled: phone.enabled,
  });
  if (phone.home) {
    send("home", { action: "home", home: phone.home });
  }
}

function startPhone(): void {
  registerPhone();
  reportPhone();
  if (heartbeat) clearInterval(heartbeat);
  heartbeat = setInterval(reportPhone, HEARTBEAT_MS);
}

function stopPhone(): void {
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
}

function attachListeners(): void {
  if (listeners || typeof window === "undefined") return;
  listeners = true;
  window.addEventListener("online", reportPhone);
  window.addEventListener("offline", reportPhone);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reportPhone();
  });
}

export function initPhone(): void {
  if (initialized) return;
  initialized = true;
  readSettings();
  saveSettings();
  phone.status.online = navigator.onLine;
  phone.status.connection = normalizeConnection((navigator as any).connection);
  phone.status.local = isLocalBroker();
  phone.status.permission = navigator.geolocation ? "prompt" : "unsupported";
  attachListeners();
  if (phone.enabled && !phone.paused) startPhone();
}

export function setPhoneEnabled(enabled: boolean): void {
  phone.enabled = enabled;
  saveSettings();
  if (enabled && !phone.paused) startPhone();
  else {
    stopPhone();
    send("update", {
      action: "update",
      deviceId: phone.deviceId,
      data: { enabled },
    });
  }
}

export function setPhoneName(name: string): void {
  const next = name.trim().slice(0, 64);
  if (!next) return;
  phone.name = next;
  saveSettings();
  send("update", {
    action: "update",
    deviceId: phone.deviceId,
    data: { name: next },
  });
}

export function setPhoneHome(home: PhoneHome | null): void {
  phone.home = home ?? undefined;
  saveSettings();
  if (home) send("home", { action: "home", home });
}

export function pausePhone(paused: boolean): void {
  phone.paused = paused;
  saveSettings();
  if (paused) stopPhone();
  else if (phone.enabled) startPhone();
}

export function homePoint(): PhoneHome | null {
  return phone.home ?? homeFromSystemConfig(ioBroker.systemConfig);
}

/** Task 4 implements the geolocation flow; the card calls this. */
export async function requestPhoneLocation(): Promise<void> {
  if (!navigator.geolocation) {
    phone.status.permission = "unsupported";
    return;
  }
  phone.status.permission = "prompt";
}
