import { createHash } from "node:crypto";
import { extractRefCalls } from "./logic/expr-code";
import { collectRefs } from "./logic/subscriptions";
import {
  pluginContributionsOf,
  type PluginContributions,
} from "./plugin-contributions";
import type { LogicDef, LogicDocument } from "./logic/types";
import type { AdapterPlugin } from "./plugin-ops";
import type { ImportedPlugin } from "./plugin-file";
import type {
  CaptureRequest,
  CollectionConflict,
  PluginCollection,
  PluginStateDecl,
} from "./plugin-collection-types";
import {
  canonicalJson,
  collectionOf,
  plainObject,
} from "./plugin-collection-contract";

export type {
  CaptureRequest,
  CollectionConflict,
  PluginCollection,
  PluginStateDecl,
} from "./plugin-collection-types";

export {
  MAX_COLLECTION_ITEM,
  MAX_COLLECTION_LOGICS,
  MAX_COLLECTION_SIZE,
  MAX_COLLECTION_STATES,
  MAX_COLLECTION_USES,
  canonicalJson,
  collectionOf,
  type CollectionParse,
} from "./plugin-collection-contract";

/**
 * The definition hash the ownership marker carries. Lifecycle fields (`enabled`
 * for logic) and the marker itself are not content.
 */
export function baselineOf(value: unknown, kind: "logic" | "state"): string {
  const copy = JSON.parse(JSON.stringify(value ?? null)) as Record<
    string,
    unknown
  > | null;
  if (copy && typeof copy === "object") {
    if (kind === "logic") {
      delete copy.managed;
      delete copy.enabled;
    } else if (plainObject(copy.native)) {
      delete copy.native.ihomeCollection;
      if (Object.keys(copy.native).length === 0) delete copy.native;
    }
    if (kind === "state" && plainObject(copy.common)) {
      // Local metadata, not the plugin's definition.
      delete copy.common.custom;
    }
  }
  return createHash("sha256").update(canonicalJson(copy)).digest("hex");
}

export interface CollectionHost {
  getObject(id: string): Promise<Record<string, unknown> | undefined>;
  setObject(id: string, object: Record<string, unknown>): Promise<void>;
  deleteObject(id: string): Promise<void>;
  readLogicDocument(): Promise<LogicDocument | null>;
  writeLogicDocument(doc: LogicDocument): Promise<void>;
  resolveVariable(name: string): string | undefined;
  log(level: "info" | "warn" | "error", message: string): void;
  /** Optional: every live object id, so dropped states can be found. */
  listObjects?(): Promise<string[]>;
}

export interface CollectionPlugin {
  id: string;
  version: string;
  collection: PluginCollection;
}

export interface CollectionReport {
  conflicts: CollectionConflict[];
  /** Owned items edited locally; kept and skipped until an explicit restore. */
  modified: CollectionConflict[];
  missing: string[];
  droppedLogics: string[];
  droppedStates: string[];
}

interface Inspection extends CollectionReport {
  doc: LogicDocument;
}

const pluginMarkerOf = (value: unknown): Record<string, unknown> | undefined =>
  plainObject(value) ? value : undefined;

/** The part of a state object a manifest declaration owns. `common.custom` is
 *  local metadata (iHome overrides, history adapters), never collection content. */
function stateContent(value: Record<string, unknown>): Record<string, unknown> {
  const native = plainObject(value.native) ? { ...value.native } : {};
  delete native.ihomeCollection;
  const common = plainObject(value.common) ? { ...value.common } : value.common;
  if (plainObject(common)) delete common.custom;
  return {
    id: value.id ?? value._id,
    type: value.type,
    common,
    ...(Object.keys(native).length ? { native } : {}),
  };
}

/** The manifest's common, with local `custom` metadata kept from the live
 *  object (and never taken from the manifest). */
function collectionCommon(
  declCommon: unknown,
  liveCommon: unknown,
): Record<string, unknown> {
  const next = plainObject(declCommon) ? { ...declCommon } : {};
  delete next.custom;
  const custom = plainObject(liveCommon) ? liveCommon.custom : undefined;
  if (plainObject(custom)) next.custom = custom;
  return next;
}

const stateBaseline = (value: Record<string, unknown>): string =>
  baselineOf(stateContent(value), "state");

function stateMarker(
  value: Record<string, unknown>,
): Record<string, unknown> | undefined {
  return plainObject(value.native)
    ? pluginMarkerOf(value.native.ihomeCollection)
    : undefined;
}

/** A configured plugin with a version is a collection plugin. */
export function collectionPluginOf(
  plugin: AdapterPlugin,
): CollectionPlugin | undefined {
  if (!plugin.collection || !plugin.version) return undefined;
  return {
    id: plugin.id,
    version: plugin.version,
    collection: plugin.collection,
  };
}

async function inspect(
  host: CollectionHost,
  plugin: CollectionPlugin,
): Promise<Inspection> {
  const doc = await host.readLogicDocument();
  if (!doc) throw new Error("logic document unreadable");
  const conflicts: CollectionConflict[] = [];
  const modified: CollectionConflict[] = [];
  const missing: string[] = [];
  const declaredStates = new Set(
    plugin.collection.states.map((decl) => decl.id),
  );
  const declaredLogics = new Set(
    plugin.collection.logics.map((decl) => decl.id),
  );

  for (const decl of plugin.collection.states) {
    const live = await host.getObject(decl.id);
    if (!live) {
      missing.push(decl.id);
      continue;
    }
    const marker = stateMarker(live);
    if (!marker) {
      conflicts.push({ kind: "state", id: decl.id, reason: "unmanaged" });
    } else if (marker.plugin !== plugin.id) {
      conflicts.push({ kind: "state", id: decl.id, reason: "foreign" });
    } else if (stateBaseline(live) !== marker.baseline) {
      modified.push({ kind: "state", id: decl.id, reason: "modified" });
    }
  }

  const logics = doc.logics ?? [];
  for (const decl of plugin.collection.logics) {
    const live = logics.find((entry) => entry.id === decl.id);
    if (!live) {
      missing.push(decl.id);
      continue;
    }
    if (!live.managed) {
      conflicts.push({ kind: "logic", id: decl.id, reason: "unmanaged" });
    } else if (live.managed.plugin !== plugin.id) {
      conflicts.push({ kind: "logic", id: decl.id, reason: "foreign" });
    } else if (baselineOf(live, "logic") !== live.managed.baseline) {
      modified.push({ kind: "logic", id: decl.id, reason: "modified" });
    }
  }

  const droppedLogics = logics
    .filter(
      (entry) =>
        entry.managed?.plugin === plugin.id && !declaredLogics.has(entry.id),
    )
    .map((entry) => entry.id);

  const droppedStates: string[] = [];
  if (host.listObjects) {
    for (const id of await host.listObjects()) {
      if (declaredStates.has(id)) continue;
      const live = await host.getObject(id);
      const marker = live ? stateMarker(live) : undefined;
      if (marker?.plugin === plugin.id) droppedStates.push(id);
    }
  }

  return {
    doc,
    conflicts,
    modified,
    missing,
    droppedLogics,
    droppedStates,
  };
}

/** Report missing, conflicting, foreign and dropped items without writing. */
export async function classifyCollection(
  host: CollectionHost,
  plugin: CollectionPlugin,
): Promise<CollectionReport> {
  const result = await inspect(host, plugin);
  return {
    conflicts: result.conflicts,
    modified: result.modified,
    missing: result.missing,
    droppedLogics: result.droppedLogics,
    droppedStates: result.droppedStates,
  };
}

async function ensureParentObjects(
  host: CollectionHost,
  id: string,
): Promise<void> {
  const parts = id.split(".");
  if (parts[0] === "system") return;
  // adapter.instance is the instance root; system objects are never created.
  for (let index = 2; index < parts.length - 1; index += 1) {
    const parentId = parts.slice(0, index + 1).join(".");
    if (await host.getObject(parentId)) continue;
    await host.setObject(parentId, {
      id: parentId,
      type: "folder",
      common: { name: parts[index] },
      native: {},
    });
  }
}

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/**
 * Create or update the owned items. Conflicts and foreign items abort before
 * any write; `sync` keeps a locally edited definition and only sets `enabled`.
 */
export async function applyCollection(
  host: CollectionHost,
  plugin: CollectionPlugin,
  options: {
    enabled: boolean;
    mode: "sync" | "reconcile";
    /** Claim unmanaged items and restore locally modified ones. */
    overwrite?: boolean;
    /** Restore locally modified owned items, but never claim unmanaged ones. */
    restore?: boolean;
  },
): Promise<{
  applied: boolean;
  conflicts: CollectionConflict[];
  modified: CollectionConflict[];
  changed: boolean;
}> {
  const { doc, conflicts, modified, droppedStates } = await inspect(
    host,
    plugin,
  );
  const foreign = conflicts.some((entry) => entry.reason === "foreign");
  // Unmanaged items may be claimed only by an explicit reconcile+overwrite;
  // enable/disable sync and a plain restore must never touch them.
  const unmanagedBlock =
    conflicts.some((entry) => entry.reason === "unmanaged") &&
    !(options.mode === "reconcile" && options.overwrite === true);
  if (foreign || unmanagedBlock) {
    return { applied: false, conflicts, modified, changed: false };
  }

  const restoreModified =
    options.overwrite === true || options.restore === true;
  const modifiedKeys = new Set(
    modified.map((entry) => `${entry.kind}:${entry.id}`),
  );
  let changed = false;

  for (const decl of plugin.collection.states) {
    const live = await host.getObject(decl.id);
    if (!live) {
      await ensureParentObjects(host, decl.id);
      await host.setObject(decl.id, {
        id: decl.id,
        type: decl.type,
        common: collectionCommon(decl.common, undefined),
        native: {
          ...decl.native,
          ihomeCollection: {
            plugin: plugin.id,
            version: plugin.version,
            baseline: baselineOf(decl, "state"),
          },
        },
      });
      changed = true;
      continue;
    }
    if (options.mode !== "reconcile") continue;
    if (modifiedKeys.has(`state:${decl.id}`) && !restoreModified) continue;
    const next = {
      ...live,
      id: decl.id,
      type: decl.type,
      common: collectionCommon(decl.common, live.common),
      native: {
        ...(plainObject(live.native) ? live.native : {}),
        ...decl.native,
        ihomeCollection: {
          plugin: plugin.id,
          version: plugin.version,
          baseline: baselineOf(decl, "state"),
        },
      },
    };
    if (!same(next, live)) {
      await host.setObject(decl.id, next);
      changed = true;
    }
  }

  if (options.mode === "reconcile") {
    for (const id of droppedStates) {
      const live = await host.getObject(id);
      if (!live || !plainObject(live.native)) continue;
      const native = { ...live.native };
      delete native.ihomeCollection;
      const next: Record<string, unknown> = { ...live, native };
      if (Object.keys(native).length === 0) delete next.native;
      await host.setObject(id, next);
      changed = true;
    }
  }

  const declared = new Set(plugin.collection.logics.map((entry) => entry.id));
  const modifiedLogicIds = new Set(
    modified.filter((entry) => entry.kind === "logic").map((entry) => entry.id),
  );
  const logics = (doc.logics ?? []).filter(
    (entry) =>
      options.mode !== "reconcile" ||
      entry.managed?.plugin !== plugin.id ||
      declared.has(entry.id) ||
      (!restoreModified && modifiedLogicIds.has(entry.id)),
  );
  const removed = logics.length !== (doc.logics ?? []).length;
  changed = changed || removed;

  for (const decl of plugin.collection.logics) {
    const index = logics.findIndex((entry) => entry.id === decl.id);
    if (index < 0) {
      logics.push({
        ...decl,
        enabled: options.enabled,
        managed: {
          plugin: plugin.id,
          version: plugin.version,
          baseline: baselineOf(decl, "logic"),
        },
      });
      changed = true;
      continue;
    }
    if (options.mode === "sync") {
      if (logics[index].enabled !== options.enabled) {
        logics[index] = { ...logics[index], enabled: options.enabled };
        changed = true;
      }
      continue;
    }
    if (modifiedLogicIds.has(decl.id) && !restoreModified) {
      // Keep the local definition; still follow the plugin's enabled flag.
      if (logics[index].enabled !== options.enabled) {
        logics[index] = { ...logics[index], enabled: options.enabled };
        changed = true;
      }
      continue;
    }
    const next = {
      ...decl,
      enabled: options.enabled,
      managed: {
        plugin: plugin.id,
        version: plugin.version,
        baseline: baselineOf(decl, "logic"),
      },
    } as LogicDef;
    const before = logics[index];
    if (
      before.name !== next.name ||
      before.kind !== next.kind ||
      baselineOf(before, "logic") !== baselineOf(next, "logic") ||
      before.enabled !== next.enabled ||
      !same(before.managed, next.managed)
    ) {
      logics[index] = next;
      changed = true;
    }
  }

  if (changed) {
    await host.writeLogicDocument({ ...doc, logics });
  }
  return { applied: true, conflicts, modified, changed };
}

/** Remove the owned logic; states stay (and keep their marker) unless asked. */
export async function removeCollection(
  host: CollectionHost,
  plugin: CollectionPlugin,
  options: { removeStates: boolean },
): Promise<{ changed: boolean }> {
  const doc = await host.readLogicDocument();
  if (!doc) throw new Error("logic document unreadable");
  const logics = (doc.logics ?? []).filter(
    (entry) => entry.managed?.plugin !== plugin.id,
  );
  let changed = logics.length !== (doc.logics ?? []).length;

  if (options.removeStates) {
    for (const decl of plugin.collection.states) {
      const live = await host.getObject(decl.id);
      if (live && stateMarker(live)?.plugin === plugin.id) {
        await host.deleteObject(decl.id);
        changed = true;
      }
    }
  }

  if (logics.length !== (doc.logics ?? []).length) {
    await host.writeLogicDocument({ ...doc, logics });
  }
  return { changed };
}

export interface CaptureResult {
  collection: PluginCollection;
  contributions?: PluginContributions;
  uses: string[];
}

function collectCode(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectCode(item, out);
  } else if (plainObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "code" && typeof item === "string") out.push(item);
      else collectCode(item, out);
    }
  }
}

/**
 * Turn selected live items into a manifest snapshot and stamp the live copies
 * with this plugin's ownership marker. The manifest is written by the caller.
 */
export async function captureCollection(
  host: CollectionHost,
  request: CaptureRequest,
): Promise<CaptureResult> {
  const doc = await host.readLogicDocument();
  if (!doc) throw new Error("logic document unreadable");

  const logics: LogicDef[] = [];
  for (const id of request.logicIds) {
    const live = (doc.logics ?? []).find((entry) => entry.id === id);
    if (!live) throw new Error(`missing logic: ${id}`);
    if (live.managed && live.managed.plugin !== request.id) {
      throw new Error(`logic ${id} is owned by another plugin`);
    }
    const def = { ...live } as LogicDef;
    delete def.managed;
    delete def.enabled;
    logics.push(def);
  }

  const states: PluginStateDecl[] = [];
  for (const id of request.stateIds) {
    if (id.startsWith("$")) {
      throw new Error(`invalid state id: ${id}`);
    }
    const live = await host.getObject(id);
    if (!live) throw new Error(`missing state: ${id}`);
    const marker = stateMarker(live);
    if (marker && marker.plugin !== request.id) {
      throw new Error(`state ${id} is owned by another plugin`);
    }
    const native = plainObject(live.native) ? { ...live.native } : {};
    delete native.ihomeCollection;
    const common = plainObject(live.common) ? { ...live.common } : {};
    delete common.custom;
    if (live.type !== "state" && live.type !== "folder") {
      throw new Error(`state ${id} has no valid type`);
    }
    states.push({
      id,
      type: live.type,
      common,
      ...(Object.keys(native).length ? { native } : {}),
    });
  }

  const owned = new Set([...request.logicIds, ...request.stateIds]);
  const refs: string[] = [];
  const code: string[] = [];
  for (const def of logics) {
    collectRefs(def, refs);
    collectCode(def, code);
  }
  for (const snippet of code) {
    for (const call of extractRefCalls(snippet)) refs.push(call.name);
  }
  const uses = [
    ...new Set(
      refs
        .map((ref) => (ref.includes(".") ? ref : host.resolveVariable(ref)))
        .filter((ref): ref is string => !!ref && ref.includes(".")),
    ),
  ]
    .filter((id) => !id.startsWith("$") && !owned.has(id))
    .sort();

  const parsed = collectionOf({
    version: 1,
    states,
    logics,
    ...(uses.length ? { uses } : {}),
  });
  if ("problem" in parsed) {
    throw new Error(`invalid collection: ${parsed.problem}`);
  }

  let contributions: PluginContributions | undefined;
  if (request.tiles.length) {
    const tiles = request.tiles.map((tile) => {
      if (!plainObject(tile)) throw new Error("a tile must be an object");
      const copy = { ...tile };
      delete copy.builtin;
      delete copy.basedOn;
      return copy;
    });
    const checked = pluginContributionsOf({ tiles });
    if ("problem" in checked) {
      throw new Error(`invalid tiles: ${checked.problem}`);
    }
    contributions = checked.contributions;
  }

  for (const decl of parsed.collection.logics) {
    const index = (doc.logics ?? []).findIndex((entry) => entry.id === decl.id);
    if (index < 0) continue;
    doc.logics[index] = {
      ...doc.logics[index],
      managed: {
        plugin: request.id,
        version: request.version,
        baseline: baselineOf(decl, "logic"),
      },
    };
  }
  for (const decl of parsed.collection.states) {
    const live = await host.getObject(decl.id);
    if (!live) continue;
    await host.setObject(decl.id, {
      ...live,
      native: {
        ...(plainObject(live.native) ? live.native : {}),
        ihomeCollection: {
          plugin: request.id,
          version: request.version,
          baseline: baselineOf(decl, "state"),
        },
      },
    });
  }
  await host.writeLogicDocument(doc);

  return {
    collection: parsed.collection,
    ...(contributions ? { contributions } : {}),
    uses,
  };
}

/** Keep the existing manifest's code/settings and replace its collection. */
export function mergeCapturedPlugin(
  existing: ImportedPlugin | undefined,
  request: CaptureRequest,
  capture: CaptureResult,
): ImportedPlugin {
  const base = existing ?? { id: request.id, name: request.name };
  return {
    ...base,
    id: request.id,
    name: request.name,
    version: request.version,
    ...(existing?.api ? { api: existing.api } : {}),
    ...(existing?.help ? { help: existing.help } : {}),
    ...(existing?.usage ? { usage: existing.usage } : {}),
    ...(existing?.settings ? { settings: existing.settings } : {}),
    ...(existing?.settingsSchema
      ? { settingsSchema: existing.settingsSchema }
      : {}),
    ...(existing?.settingsTabs ? { settingsTabs: existing.settingsTabs } : {}),
    ...(existing?.code ? { code: existing.code } : {}),
    contributions: {
      ...existing?.contributions,
      ...(capture.contributions?.tiles
        ? { tiles: capture.contributions.tiles }
        : {}),
    },
    collection: capture.collection,
  };
}
