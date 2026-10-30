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
export function splitReading(
  v: unknown,
  unit?: string,
  decimals?: number,
  states?: Record<string, string>,
): { value: string; unit: string } {
  if (v === null || v === undefined) return { value: "—", unit: "" };
  // A states label is the whole reading: "Standby °C" would be noise.
  const label = states?.[String(v)];
  if (label !== undefined) return { value: label, unit: "" };
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
export function formatSlotText(v: unknown, unit?: string): string {
  if (typeof v === "boolean") return formatBoolean(v, unit || "Off/On");
  return formatValue(v, unit);
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
export function formatValue(v: unknown, unit?: string): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "boolean") return formatBoolean(v, unit);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v) + (unit ? " " + unit : "");
}
