import { localizeName } from "$lib/config/format";
import { stateIdFor, type GlobalVariable } from "$lib/config/variables";
import type { SourceOverride } from "$lib/types/overrides";

/** One row of the state list. */
export interface StateEntry {
  id: string;
  name: string;
  type: string;
  role: string;
  customKeys: string[];
  overrideCount: number;
}

export interface StateFilters {
  override?: boolean;
  history?: boolean;
  custom?: boolean;
}

const MAX_CUSTOM = 64 * 1024;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** The state objects as list rows, sorted by display name. */
export function stateEntries(
  objects: Map<string, any>,
  overrides: SourceOverride[],
  variables: GlobalVariable[] = [],
): StateEntry[] {
  const rows: StateEntry[] = [];
  for (const [id, object] of objects) {
    if (!object || object.type !== "state") continue;
    const common = record(object.common) ? object.common : {};
    const customKeys = record(common.custom)
      ? Object.keys(common.custom).sort()
      : [];
    const wanted = stateIdFor(id, variables);
    rows.push({
      id,
      name: localizeName(common.name) || id,
      type: String(common.type ?? ""),
      role: String(common.role ?? ""),
      customKeys,
      overrideCount: overrides.filter(
        (override) => stateIdFor(override.stateId, variables) === wanted,
      ).length,
    });
  }
  return rows.sort(
    (left, right) =>
      left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
  );
}

/** Text and badge filters for the list. */
export function stateMatches(
  entry: StateEntry,
  query: string,
  filters: StateFilters,
): boolean {
  const text = query.trim().toLowerCase();
  if (
    text &&
    !`${entry.name} ${entry.id} ${entry.role}`.toLowerCase().includes(text)
  ) {
    return false;
  }
  if (filters.override && entry.overrideCount === 0) return false;
  if (filters.custom && entry.customKeys.length === 0) return false;
  if (filters.history && entry.customKeys.length === 0) return false;
  return true;
}

/** Parse a custom editor's JSON as a plain object. */
export function parseCustomJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return record(value) ? value : null;
  } catch {
    return null;
  }
}

/** Why the editor's JSON cannot be saved, or null when it can. */
export function customJsonProblem(text: string): string | null {
  if (!text.trim()) return "Custom settings must be a JSON object.";
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (!record(value)) return "Custom settings must be a JSON object.";
  if (JSON.stringify(value).length > MAX_CUSTOM) {
    return "Custom settings are too large.";
  }
  return null;
}

/** The `supportedFeatures` list of a history adapter reply. */
export function historyFeatures(reply: unknown): string[] {
  if (!record(reply)) return [];
  const nested = record(reply.result) ? reply.result : reply;
  const value = nested.supportedFeatures;
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

/** A reply to a history adapter's `features` command. */
export function isHistoryAdapter(reply: unknown): boolean {
  const nested = record(reply)
    ? record(reply.result)
      ? reply.result
      : reply
    : null;
  return !!nested && Array.isArray(nested.supportedFeatures);
}

/** `getHistory` is the baseline command a history adapter answers without
 *  listing it (history.0 reports only update/delete/deleteRange/deleteAll). */
export function hasHistoryFeature(reply: unknown, feature: string): boolean {
  if (feature === "getHistory") return isHistoryAdapter(reply);
  return historyFeatures(reply).includes(feature);
}

/** Numeric chart points; boolean samples become 0/1, other values are skipped. */
export function chartPoints(
  reply: unknown,
): Array<{ ts: number; val: number }> {
  const rows = Array.isArray(reply)
    ? reply
    : record(reply) && Array.isArray(reply.result)
      ? reply.result
      : [];
  const points: Array<{ ts: number; val: number }> = [];
  for (const row of rows) {
    if (!record(row) || typeof row.ts !== "number") continue;
    const value =
      typeof row.val === "number"
        ? row.val
        : typeof row.val === "boolean"
          ? row.val
            ? 1
            : 0
          : undefined;
    if (value === undefined || !Number.isFinite(value)) continue;
    points.push({ ts: row.ts, val: value });
  }
  return points.sort((left, right) => left.ts - right.ts);
}

/** The array shape the history adapters accept for one state's range. */
export function deleteRangePayload(
  id: string,
  start: number,
  end: number,
): Array<{ id: string; start: number; end: number }> {
  return [{ id, start, end }];
}

/** `deleteAll` takes one state object. */
export function deleteAllPayload(id: string): { id: string } {
  return { id };
}
