import type { ToastLevel } from "$lib/stores/toasts.svelte";

export interface MessageEntry {
  seq: number;
  ts: number;
  from: string;
  severity: string;
  message: string;
  /** Seconds; 0 keeps the toast until it is closed. */
  timeout?: number;
}

export interface MessagePage {
  seq: number;
  entries: MessageEntry[];
}

function isEntry(value: unknown): value is MessageEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.seq === "number" &&
    typeof entry.message === "string" &&
    typeof entry.severity === "string"
  );
}

/** Parse the adapter's `info.messages` JSON; junk is ignored, never thrown. */
export function parseMessagePage(raw: unknown): MessagePage | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const page = value as { seq?: unknown; entries?: unknown };
    if (typeof page.seq !== "number" || !Array.isArray(page.entries))
      return null;
    return {
      seq: page.seq,
      entries: page.entries.filter(isEntry),
    };
  } catch {
    return null;
  }
}

export function messageLevel(severity: string): ToastLevel {
  if (severity === "error") return "error";
  if (severity === "warn") return "warning";
  return "info";
}

export function messageToastOptions(entry: MessageEntry): {
  level: ToastLevel;
  sticky: boolean;
  timeout?: number;
} {
  const timeout = entry.timeout;
  return {
    level: messageLevel(entry.severity),
    sticky: timeout === 0,
    timeout:
      typeof timeout === "number" && timeout > 0 ? timeout * 1000 : undefined,
  };
}
