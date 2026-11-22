// Collection envelope validation without the adapter's logic runtime or hash.
// The SPA imports this through plugin-file, so it must stay browser-safe.
import { validateLogicDocument } from "./logic/validate";
import type { LogicDef, LogicDocument } from "./logic/types";
import type {
  PluginCollection,
  PluginStateDecl,
} from "./plugin-collection-types";

export const MAX_COLLECTION_STATES = 200;
export const MAX_COLLECTION_LOGICS = 100;
export const MAX_COLLECTION_USES = 500;
export const MAX_COLLECTION_SIZE = 2_000_000;
export const MAX_COLLECTION_ITEM = 512_000;

export type CollectionParse =
  { collection: PluginCollection; warnings?: string[] } | { problem: string };

const COLLECTION_KEYS = new Set(["version", "states", "logics", "uses"]);
const STATE_ID = /^[A-Za-z0-9_-]+\.[0-9]+\..+/;
const LOGIC_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validStateId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= 256 &&
    !value.includes("..") &&
    STATE_ID.test(value)
  );
}

function jsonSize(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Infinity;
  }
}

function parseStates(value: unknown): PluginStateDecl[] | string {
  if (!Array.isArray(value)) return "states must be an array";
  if (value.length > MAX_COLLECTION_STATES) {
    return `at most ${MAX_COLLECTION_STATES} states`;
  }
  const states: PluginStateDecl[] = [];
  const ids = new Set<string>();
  for (const item of value) {
    if (!plainObject(item)) return "a state declaration must be an object";
    if (!validStateId(item.id)) return `invalid state id: ${String(item.id)}`;
    if (item.type !== "state" && item.type !== "folder") {
      return `invalid state type for ${item.id}`;
    }
    if (!plainObject(item.common))
      return `${item.id}: common must be an object`;
    if (item.native !== undefined && !plainObject(item.native)) {
      return `${item.id}: native must be an object`;
    }
    if (jsonSize(item) > MAX_COLLECTION_ITEM) {
      return `${item.id} is larger than ${MAX_COLLECTION_ITEM} characters`;
    }
    if (ids.has(item.id)) return `duplicate state id: ${item.id}`;
    ids.add(item.id);
    states.push({ ...item, id: item.id, type: item.type } as PluginStateDecl);
  }
  return states;
}

function parseLogics(
  value: unknown,
): { logics: LogicDef[]; warnings: string[] } | string {
  if (!Array.isArray(value)) return "logics must be an array";
  if (value.length > MAX_COLLECTION_LOGICS) {
    return `at most ${MAX_COLLECTION_LOGICS} logics`;
  }
  const warnings: string[] = [];
  const ids = new Set<string>();
  const logics: LogicDef[] = [];
  for (const item of value) {
    if (!plainObject(item)) return "a logic must be an object";
    if (typeof item.id !== "string" || !LOGIC_ID.test(item.id)) {
      return `invalid logic id: ${String(item.id)}`;
    }
    if (ids.has(item.id)) return `duplicate logic id: ${item.id}`;
    ids.add(item.id);
    if (jsonSize(item) > MAX_COLLECTION_ITEM) {
      return `${item.id} is larger than ${MAX_COLLECTION_ITEM} characters`;
    }
    const { managed, enabled, ...rest } = item;
    if (managed !== undefined)
      warnings.push(`${item.id}: managed marker stripped`);
    if (enabled !== undefined) warnings.push(`${item.id}: enabled stripped`);
    logics.push(rest as unknown as LogicDef);
  }
  const issues = validateLogicDocument({
    version: 3,
    logics,
  } as LogicDocument).filter((issue) => issue.severity === "error");
  if (issues.length) {
    return `invalid logic: ${issues
      .slice(0, 3)
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ")}`;
  }
  return { logics, warnings };
}

function parseUses(
  value: unknown,
  stateIds: Set<string>,
): string[] | string | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return "uses must be an array";
  if (value.length > MAX_COLLECTION_USES) {
    return `at most ${MAX_COLLECTION_USES} uses`;
  }
  const uses: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (!validStateId(id)) return `invalid use id: ${String(id)}`;
    if (stateIds.has(id)) return `${id} is both owned and used`;
    if (seen.has(id)) return `duplicate use: ${id}`;
    seen.add(id);
    uses.push(id);
  }
  return uses;
}

/** Parse and validate a plugin collection envelope. */
export function collectionOf(value: unknown): CollectionParse {
  if (!plainObject(value)) return { problem: "collection must be an object" };
  for (const key of Object.keys(value)) {
    if (!COLLECTION_KEYS.has(key)) return { problem: `unknown key: ${key}` };
  }
  if (value.version !== 1) return { problem: "collection.version must be 1" };
  const states = parseStates(value.states);
  if (typeof states === "string") return { problem: states };
  const parsedLogics = parseLogics(value.logics);
  if (typeof parsedLogics === "string") return { problem: parsedLogics };
  const uses = parseUses(value.uses, new Set(states.map((entry) => entry.id)));
  if (typeof uses === "string") return { problem: uses };
  if (states.length === 0 && parsedLogics.logics.length === 0) {
    return { problem: "a collection must own at least one state or logic" };
  }
  const collection: PluginCollection = {
    version: 1,
    states,
    logics: parsedLogics.logics,
    ...(uses?.length ? { uses } : {}),
  };
  if (jsonSize(collection) > MAX_COLLECTION_SIZE) {
    return { problem: `collection is larger than ${MAX_COLLECTION_SIZE}` };
  }
  return {
    collection,
    ...(parsedLogics.warnings.length
      ? { warnings: parsedLogics.warnings }
      : {}),
  };
}

/** JSON with object keys sorted recursively; array order is preserved. */
export function canonicalJson(value: unknown): string {
  const sort = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sort);
    if (input && typeof input === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(input as Record<string, unknown>).sort()) {
        out[key] = sort((input as Record<string, unknown>)[key]);
      }
      return out;
    }
    return input;
  };
  return JSON.stringify(sort(value)) ?? "null";
}
