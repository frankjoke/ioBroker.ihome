import { parseDuration } from "./logic/duration";

export interface DerivedEntry {
  id: string;
  adapter: string;
  interval: string;
  startDelay: string;
  changesOnly: boolean;
  relogInterval: string;
  function: { code: string };
}

export interface DerivedDocument {
  version: 1;
  entries: DerivedEntry[];
}

export interface DerivedPoint {
  ts: number;
  val: number;
}

export const MAX_DERIVED_QUEUE = 96;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** The reason one entry cannot run, or null when it is valid. */
export function derivedEntryProblem(value: unknown): string | null {
  if (!record(value)) return "entry must be an object";
  const id = text(value.id);
  const adapter = text(value.adapter);
  const interval = parseDuration(String(value.interval ?? ""));
  const startDelay = parseDuration(String(value.startDelay ?? ""));
  const relog = parseDuration(String(value.relogInterval ?? ""));
  if (!id || !id.includes(".")) return "entry needs a state id";
  if (!adapter || !/^[A-Za-z0-9_-]+\.\d+$/.test(adapter)) {
    return "entry needs a history adapter instance";
  }
  if (interval === null || interval <= 0) return "interval must be positive";
  if (startDelay === null || startDelay < 0) return "start delay is invalid";
  if (relog === null || relog < 0) return "relog interval is invalid";
  if (typeof value.changesOnly !== "boolean") {
    return "changesOnly must be a boolean";
  }
  if (
    !record(value.function) ||
    typeof value.function.code !== "string" ||
    !value.function.code.trim()
  ) {
    return "function needs code";
  }
  return null;
}

/** A document is either a JSON string or an already parsed object. */
export function parseDerivedDocument(value: unknown): DerivedDocument | null {
  let raw: unknown = value;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) {
    return null;
  }
  const entries: DerivedEntry[] = [];
  for (const candidate of raw.entries) {
    if (derivedEntryProblem(candidate)) return null;
    const entry = candidate as Record<string, unknown>;
    entries.push({
      id: String(entry.id).trim(),
      adapter: String(entry.adapter).trim(),
      interval: String(entry.interval).trim(),
      startDelay: String(entry.startDelay).trim(),
      changesOnly: entry.changesOnly === true,
      relogInterval: String(entry.relogInterval).trim(),
      function: { code: String((entry.function as Record<string, unknown>).code) },
    });
  }
  return { version: 1, entries };
}

/**
 * The state/adapter gate: derived only runs for a number state whose history
 * item is present, disabled and alias-free. Raw logging wins otherwise.
 */
export function derivedEntryProblemForObject(
  object: unknown,
  adapter: string,
): string | null {
  if (!record(object) || !record(object.common)) {
    return "state does not exist";
  }
  const common = object.common;
  if (common.type !== "number") return "derived history needs a number state";
  const custom = record(common.custom) ? common.custom : {};
  const config = custom[adapter];
  if (!record(config)) return "history item is missing";
  if (config.enabled !== false) {
    return "raw logging is enabled; set enabled: false for derived history";
  }
  if (typeof config.aliasId === "string" && config.aliasId.trim()) {
    return "derived history needs an empty alias";
  }
  return null;
}

export interface WriteDecision {
  value: number;
  lastWritten?: number;
  to: number;
  lastWrittenTs?: number;
  changesOnly: boolean;
  relogMs: number;
}

/** The spec's write policy for one closed window. */
export function shouldWrite(decision: WriteDecision): boolean {
  if (!decision.changesOnly) return true;
  if (decision.lastWritten === undefined) return true;
  if (decision.value !== decision.lastWritten) return true;
  if (decision.relogMs <= 0) return false;
  return (
    decision.lastWrittenTs !== undefined &&
    decision.to - decision.lastWrittenTs >= decision.relogMs
  );
}
