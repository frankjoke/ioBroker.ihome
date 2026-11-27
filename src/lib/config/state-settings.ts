import { localizeName } from "$lib/config/format";
import { stateIdFor, type GlobalVariable } from "$lib/config/variables";
import { stateRowIcon } from "$lib/config/icon-ops";
import { enumsOfState } from "$lib/config/rooms";
import type { SourceOverride } from "$lib/types/overrides";

/** One row of the state list. */
export interface StateEntry {
  id: string;
  name: string;
  type: string;
  role: string;
  instance: string;
  /** Real history adapter configs (`history.0`, `influxdb.0`, …). */
  historyKeys: string[];
  overrideCount: number;
  /** Room/function enum ids, including parent-channel memberships. */
  rooms: string[];
  functions: string[];
  /** Nearest state-path icon, else the adapter icon. */
  icon?: { from: string; value: string };
}

/** Everything under `system.*` is ioBroker controller space, not iHome data. */
export function isSystemInstance(instance: string): boolean {
  return String(instance ?? "").startsWith("system.");
}

/** iHome's own config documents are internal, not user-editable state. */
export function isIhomeConfigState(id: string): boolean {
  return /^ihome\.\d+\.config\./.test(String(id ?? ""));
}

/** Path depth below adapter.instance; one level per extra id segment. */
export function stateDepth(id: string): number {
  return Math.max(0, String(id ?? "").split(".").length - 2);
}

export interface StateFilters {
  instance?: string;
  role?: string;
  room?: string;
  function?: string;
  override?: boolean;
  history?: boolean;
}

/** Common state roles, before the roles the broker already carries. */
export const STATE_ROLE_SEED = [
  "value",
  "value.temperature",
  "value.humidity",
  "value.power",
  "switch",
  "level",
  "level.dimmer",
  "level.switch",
  "level.state",
  "state",
  "indicator",
  "text",
] as const;

/** Role choices: the seed plus every role already used by an object. */
export function stateRoles(objects: Map<string, any>, current = ""): string[] {
  const list: string[] = [...STATE_ROLE_SEED];
  for (const entry of objects.values()) {
    const role = entry?.common?.role;
    if (typeof role === "string" && role && !list.includes(role)) {
      list.push(role);
    }
  }
  if (current && !list.includes(current)) list.push(current);
  return list.sort();
}

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** A common.custom entry that is a real history adapter config. Both the
 *  history and influxdb adapters carry these fields; iQontrol and other
 *  adapters do not. */
export function isHistoryCustom(value: unknown): boolean {
  return (
    record(value) &&
    ("debounceTime" in value || "blockTime" in value || "changesOnly" in value)
  );
}

/** The adapter keys of a state's real history configurations. */
export function historyKeys(custom: unknown): string[] {
  if (!record(custom)) return [];
  return Object.entries(custom)
    .filter(([key, value]) => key !== "ihome" && isHistoryCustom(value))
    .map(([key]) => key)
    .sort();
}

/** The default history instance from ioBroker's system settings. Empty when
 *  none is configured; then no history adapter is available. */
export function defaultHistoryAdapter(objects: Map<string, any>): string {
  const value = objects.get("system.config")?.common?.defaultHistory;
  return typeof value === "string" ? value.trim() : "";
}

/** The adapter instance a state id belongs to: `adapter.0`, or the fuller
 *  `system.adapter.<adapter>.0` / `system.host.<host>` namespaces. */
export function instanceOf(id: string): string {
  const parts = id.split(".");
  if (parts[0] === "system" && parts[1] === "adapter") {
    return parts.slice(0, 4).join(".");
  }
  if (parts[0] === "system" && parts[1] === "host") {
    return parts.slice(0, 3).join(".");
  }
  return parts.slice(0, 2).join(".");
}

/** The row to open on arrival: the remembered state, else the first state in
 *  its parent folder, else the first row. */
export function restoreSelection(
  entries: StateEntry[],
  rememberedId: string,
): string {
  if (!rememberedId) return entries[0]?.id ?? "";
  if (entries.some((entry) => entry.id === rememberedId)) return rememberedId;
  const cut = rememberedId.lastIndexOf(".");
  if (cut > 0) {
    const parent = `${rememberedId.slice(0, cut)}.`;
    const sibling = entries.find((entry) => entry.id.startsWith(parent));
    if (sibling) return sibling.id;
  }
  return entries[0]?.id ?? "";
}

/** A remembered instance filter survives only while that instance still exists.
 *  While the state list is still loading, keep it so a valid saved filter is
 *  not dropped on a slow start. */
export function keptInstance(instance: string, instances: string[]): string {
  if (!instance || instances.length === 0) return instance;
  return instances.includes(instance) ? instance : "";
}

/** The state objects as list rows, sorted by broker id. */
export function stateEntries(
  objects: Map<string, any>,
  overrides: SourceOverride[],
  variables: GlobalVariable[] = [],
  enums: any = null,
): StateEntry[] {
  const rows: StateEntry[] = [];
  for (const [id, object] of objects) {
    if (!object || object.type !== "state") continue;
    const common = record(object.common) ? object.common : {};
    const custom = record(common.custom) ? common.custom : {};
    const wanted = stateIdFor(id, variables);
    rows.push({
      id,
      name: localizeName(common.name) || id,
      type: String(common.type ?? ""),
      role: String(common.role ?? ""),
      instance: instanceOf(id),
      historyKeys: historyKeys(custom),
      overrideCount: overrides.filter(
        (override) => stateIdFor(override.stateId, variables) === wanted,
      ).length,
      rooms: enums ? enumsOfState(enums, id, "rooms") : [],
      functions: enums ? enumsOfState(enums, id, "functions") : [],
      icon: stateRowIcon(objects, id),
    });
  }
  // Sort by broker id: equal display names ("Host", "Online", …) from
  // different networks would otherwise interleave.
  return rows.sort((left, right) =>
    left.id.localeCompare(right.id, undefined, { numeric: true }),
  );
}

/** Text and badge filters for the list. */
export function stateMatches(
  entry: StateEntry,
  query: string,
  filters: StateFilters,
): boolean {
  const text = query.trim().toLowerCase();
  if (filters.instance && entry.instance !== filters.instance) return false;
  if (filters.role && entry.role !== filters.role) return false;
  if (filters.room && !entry.rooms.includes(filters.room)) return false;
  if (filters.function && !entry.functions.includes(filters.function)) {
    return false;
  }
  if (
    text &&
    !`${entry.name} ${entry.id} ${entry.role}`.toLowerCase().includes(text)
  ) {
    return false;
  }
  if (filters.override && entry.overrideCount === 0) return false;
  if (filters.history && entry.historyKeys.length === 0) return false;
  return true;
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
export interface HistoryRow {
  ts: number;
  val: unknown;
}

/** Every raw history row (any value type), sorted by time. */
export function historyRows(reply: unknown): HistoryRow[] {
  const rows = Array.isArray(reply)
    ? reply
    : record(reply) && Array.isArray(reply.result)
      ? reply.result
      : [];
  const out: HistoryRow[] = [];
  for (const row of rows) {
    if (!record(row) || typeof row.ts !== "number") continue;
    out.push({ ts: row.ts, val: row.val });
  }
  return out.sort((left, right) => left.ts - right.ts);
}

/** The newest row's timestamp, which may be a planned value ahead of now. */
export function newestHistoryTs(reply: unknown): number | undefined {
  return historyRows(reply).at(-1)?.ts;
}

export function chartPoints(
  reply: unknown,
): Array<{ ts: number; val: number }> {
  const points: Array<{ ts: number; val: number }> = [];
  for (const row of historyRows(reply)) {
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
  return points;
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
