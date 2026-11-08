/** Short relative age, e.g. "now", "5s", "3m", "2h", "4d". */
export function formatAge(ts: number, now: number = Date.now()): string {
  if (!ts) return "";
  const age = now - ts;
  if (age < 4000) return "now";
  if (age < 60_000) return `${Math.round(age / 1000)}s`;
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m`;
  if (age < 86_400_000) return `${Math.round(age / 3_600_000)}h`;
  return `${Math.round(age / 86_400_000)}d`;
}

/** Resolve a possibly-localized name (string or {lang: name}). */
export function localizeName(name: unknown): string {
  if (!name) return "";
  if (typeof name === "string") return name;
  const n = name as Record<string, string>;
  return n.en || n.de || n[Object.keys(n)[0]] || "";
}

/** All language variants of a name joined, for searching. */
export function nameText(name: unknown): string {
  if (!name) return "";
  if (typeof name === "string") return name;
  return Object.values(name as Record<string, string>).join(" ");
}

/**
 * A reading at a set precision: round a number (or a numeric string) to
 * `decimals` digits and drop trailing zeros — 54.32 with 1 → "54.3", 54 → "54".
 * Anything else (text, a junk precision) passes through as its display string.
 */
export function formatNumber(v: unknown, decimals?: number): string {
  const n =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v)
        : NaN;
  if (
    !Number.isFinite(n) ||
    typeof decimals !== "number" ||
    !Number.isFinite(decimals) ||
    decimals < 0
  ) {
    return String(v);
  }
  return String(Number(n.toFixed(Math.min(Math.trunc(decimals), 20))));
}

/**
 * A slot's value and its unit as separate strings, so a tile can set the unit
 * smaller and un-bold than the number it belongs to. `decimals` is the slot's
 * precision knob (absent = the value as it comes).
 *
 * A boolean's unit is its false/true pair ("OFF/ON", "Aus/Ein"), so it is
 * consumed as the label and never repeated; a missing value shows "—" with no
 * unit, because "— °C" is noise.
 */
const TIMESTAMP_TOKENS = /YYYY|MM|DD|HH|mm|ss/g;

/** A unit that asks for a date/time rendering rather than a suffix. */
function isDateFormat(unit: string | undefined): boolean {
  const value = String(unit ?? "").trim();
  if (!value) return false;
  const named = value.toLowerCase();
  return (
    named === "ago" ||
    named === "time" ||
    named === "date" ||
    named === "datetime" ||
    /YYYY|HH|ss/.test(value)
  );
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatPattern(date: Date, pattern: string): string {
  const parts: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    MM: pad2(date.getMonth() + 1),
    DD: pad2(date.getDate()),
    HH: pad2(date.getHours()),
    mm: pad2(date.getMinutes()),
    ss: pad2(date.getSeconds()),
  };
  return pattern.replace(TIMESTAMP_TOKENS, (token) => parts[token]);
}

/**
 * An epoch-ms timestamp (or an ISO/date string) in the viewer's local time.
 * A format unit picks the rendering: `ago` (relative), `time`/`date`/
 * `datetime` (browser locale), or a token pattern like `HH:mm:ss`. 0 means
 * "never" in ioBroker, so it reads as an empty value instead of 1970.
 */
export function formatTimestamp(
  v: unknown,
  format?: string,
  now: number = Date.now(),
): string {
  const ms =
    typeof v === "number"
      ? v
      : typeof v === "string" && v.trim() !== ""
        ? Number(v)
        : NaN;
  const time = Number.isFinite(ms) ? ms : Date.parse(String(v));
  if (!Number.isFinite(time)) return String(v);
  if (time <= 0) return "—";
  const date = new Date(time);
  const wanted = String(format ?? "").trim();
  const named = wanted.toLowerCase();
  if (named === "ago") {
    const age = formatAge(time, now);
    return age === "now" ? "just now" : `${age} ago`;
  }
  if (named === "time") return date.toLocaleTimeString();
  if (named === "date") return date.toLocaleDateString();
  if (named === "datetime") return date.toLocaleString();
  if (/YYYY|HH|ss/.test(wanted)) return formatPattern(date, wanted);
  return date.toLocaleString();
}

export function splitReading(
  v: unknown,
  unit?: string,
  decimals?: number,
  states?: Record<string, string>,
  role?: string,
  now: number = Date.now(),
): { value: string; unit: string } {
  if (v === null || v === undefined) return { value: "—", unit: "" };
  // A states label is the whole reading: "Standby °C" would be noise.
  const label = states?.[String(v)];
  if (label !== undefined) return { value: label, unit: "" };
  // A date-format unit is consumed as the rendering, not shown as a suffix.
  if (role === "value.time" || isDateFormat(unit)) {
    return { value: formatTimestamp(v, unit, now), unit: "" };
  }
  if (typeof v === "boolean") {
    return { value: formatBoolean(v, unit || "Off/On"), unit: "" };
  }
  if (typeof v === "object") return { value: JSON.stringify(v), unit: "" };
  return { value: formatNumber(v, decimals), unit: unit ? String(unit) : "" };
}

/** The same split without a states map (the pre-metadata contract). */
export function splitValueUnit(
  v: unknown,
  unit?: string,
  decimals?: number,
): { value: string; unit: string } {
  return splitReading(v, unit, decimals);
}

/**
 * Text for a tile slot: booleans read On/Off (or the configured pair in the
 * unit, e.g. "Aus/Ein") rather than true/false, everything else goes through
 * `formatValue`.
 */
export function formatSlotText(
  v: unknown,
  unit?: string,
  role?: string,
  now: number = Date.now(),
): string {
  if (typeof v === "boolean") return formatBoolean(v, unit || "Off/On");
  return formatValue(v, unit, role, now);
}

/** Pick readable text (#1a1a1a or #fff) for a background colour. */
export function contrastColor(color: string): string {
  const hex = String(color ?? "")
    .trim()
    .replace("#", "");
  let r: number, g: number, b: number;
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    r = parseInt(hex[0] + hex[0], 16);
    g = parseInt(hex[1] + hex[1], 16);
    b = parseInt(hex[2] + hex[2], 16);
  } else if (/^[0-9a-f]{6}$/i.test(hex)) {
    r = parseInt(hex.slice(0, 2), 16);
    g = parseInt(hex.slice(2, 4), 16);
    b = parseInt(hex.slice(4, 6), 16);
  } else {
    return "#1a1a1a";
  }
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#1a1a1a" : "#ffffff";
}

/** Label for a boolean, using a "false/true" pair in the unit (e.g. "OFF/ON"). */
export function formatBoolean(v: boolean, unit?: string): string {
  const parts = unit?.split("/") ?? [];
  if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
    return (v ? parts[1] : parts[0]).trim();
  }
  return v ? "true" : "false";
}

/** Display a value, appending a unit when present. */
export function formatValue(
  v: unknown,
  unit?: string,
  role?: string,
  now: number = Date.now(),
): string {
  if (v === null || v === undefined) return "—";
  if (role === "value.time" || isDateFormat(unit)) {
    return formatTimestamp(v, unit, now);
  }
  if (typeof v === "boolean") return formatBoolean(v, unit);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v) + (unit ? " " + unit : "");
}
