export interface UiMessage {
  level: "info" | "warn" | "error";
  text: string;
  /** Seconds; 0 keeps the toast until dismissed. */
  timeout?: number;
}

/** `Alarm`, `Warning` or `Info` at the start, then an optional `:`/`-`. */
const PREFIX = /^\s*(alarm|error|warning|warn|info)\b[\s:–-]*([\s\S]*)$/i;

/**
 * A written UI message: the first word picks the toast severity and is
 * stripped, so "Alarm: Pump is dry" shows "Pump is dry" in red. Nothing after
 * the word keeps the word itself. No prefix means info.
 */
export function uiMessage(value: unknown): UiMessage | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  const match = PREFIX.exec(text);
  if (!match) return { level: "info", text };
  const word = match[1].toLowerCase();
  const body = match[2].trim() || match[1];
  if (word === "alarm" || word === "error") {
    return { level: "error", text: body, timeout: 0 };
  }
  if (word === "warning" || word === "warn") {
    return { level: "warn", text: body, timeout: 10 };
  }
  return { level: "info", text: body };
}
