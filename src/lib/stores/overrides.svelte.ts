// The override document lives in one state (`ihome.0.config.overrideList`),
// shared by every iHome instance. Loading is fail-closed: a document that cannot
// be read is never replaced, the store stays read-only.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  OVERRIDE_LIST_ID,
  emptyOverrideRegistry,
  evaluateOverride,
  normalizeOverrideRegistry,
  overrideById,
  overrideGroup,
} from "$lib/config/source-overrides";
import { registerProgramStateId } from "$lib/stores/devices.svelte";
import type { OverrideRegistry, SourceOverride } from "$lib/types/overrides";

/** The result of a save attempt, so the editor can word the outcome. */
export type OverrideSave = "saved" | "conflict" | "failed";

let registry = $state<OverrideRegistry>(emptyOverrideRegistry());
let loadKind = $state<"pending" | "absent" | "loaded" | "unreadable">(
  "pending",
);
let saveFailed = $state(false);
let initPromise: Promise<void> | null = null;

export function getOverrideRegistry(): OverrideRegistry {
  return registry;
}

/** A pending or unreadable document must not be replaced by an empty one. */
export function isOverridesWritable(): boolean {
  return loadKind === "loaded" || loadKind === "absent";
}

/** True while the last save failed, so the pane can say "not saved". */
export function overrideSaveFailed(): boolean {
  return saveFailed;
}

function statesSource(): Map<string, any> {
  return ioBroker.states as unknown as Map<string, any>;
}

function objectsSource(): Map<string, any> {
  return ioBroker.objects as unknown as Map<string, any>;
}

/** Evaluate one derived override against the live caches. */
function compute(
  override: SourceOverride,
  reg: OverrideRegistry,
): { value?: unknown; error?: string; inputs: string[] } {
  const objects = objectsSource();
  const group = overrideGroup(override.stateId, objects, reg);
  return evaluateOverride(override, {
    group,
    states: statesSource(),
    registry: reg,
    objects,
  });
}

/**
 * The derived values, keyed by override id. They are computed on read, not
 * cached: a read inside a `$derived`/render tracks the state cache it reads, so
 * an input change recomputes exactly the tiles that show the value. (An eager
 * `$effect` map is inert in the test/SSR build and a render-time cache write is
 * forbidden, so the promise the map would make cannot be kept.)
 */
export function getDerived(overrideId: string): {
  value?: unknown;
  error?: string;
} {
  const override = overrideById(registry, overrideId);
  if (!override || override.kind !== "derived") {
    return { error: `unknown derived override "${overrideId}"` };
  }
  try {
    const { value, error } = compute(override, registry);
    return error ? { error } : { value };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Re-derive each derived override's `inputs` from its live group and subscribe
 * them. The stored field is never trusted: an expression edited on another
 * instance must resubscribe what it now reads.
 */
function withInputs(doc: OverrideRegistry): OverrideRegistry {
  const overrides = doc.overrides.map((override) => {
    if (override.kind !== "derived") return override;
    let inputs: string[] = [];
    try {
      inputs = compute(override, doc).inputs;
    } catch (e) {
      console.error("derive override inputs:", e);
    }
    return { ...override, inputs };
  });
  return { ...doc, overrides };
}

function use(doc: OverrideRegistry, kind: "loaded" | "absent"): void {
  registry = doc;
  loadKind = kind;
  registerProgramStateId(OVERRIDE_LIST_ID);
  for (const override of doc.overrides) {
    for (const id of override.inputs ?? []) registerProgramStateId(id);
  }
}

async function readState(): Promise<{ value?: unknown } | null> {
  let state = await ioBroker.getState(OVERRIDE_LIST_ID, true).catch(() => null);
  if (!state) {
    await ioBroker.wait(300);
    state = await ioBroker.getState(OVERRIDE_LIST_ID, true).catch(() => null);
  }
  return state;
}

/** The adapter owns the document objects, but an old adapter may not have run
 *  since the SPA was updated: create it so the first save cannot be rejected. */
async function ensureOverridesObject(): Promise<void> {
  const obj = await ioBroker.getObject(OVERRIDE_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", OVERRIDE_LIST_ID, {
      type: "state",
      common: {
        name: "iHome source overrides",
        type: "string",
        role: "text.json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

/**
 * Write the whole document. The state is re-read first: a save from another tab
 * or instance since this one loaded is a conflict, not an overwrite. `updatedAt`
 * belongs to the store, so callers cannot forget to bump it.
 */
export async function commitOverrides(
  next: OverrideRegistry,
  baseUpdatedAt: number,
): Promise<OverrideSave> {
  if (!isOverridesWritable()) {
    console.error(
      "overrideList is not readable (no successful load) — the change was not saved",
    );
    return "failed";
  }
  if (!ioBroker.connected) {
    saveFailed = true;
    return "failed";
  }
  const state = await readState();
  if (!state && registry.updatedAt > 0) {
    // The re-read failed after a real document was loaded: writing would
    // replace something this store never read. A fresh (updatedAt 0) document
    // still creates normally.
    saveFailed = true;
    console.error(
      "the override list could not be re-read — the change was not saved",
    );
    return "failed";
  }
  const current =
    state && state.value != null && state.value !== ""
      ? normalizeOverrideRegistry(state.value)
      : null;
  if (state?.value != null && state.value !== "" && !current) {
    saveFailed = true;
    loadKind = "unreadable";
    return "conflict";
  }
  if (current && current.updatedAt !== baseUpdatedAt) {
    use(withInputs(current), "loaded");
    return "conflict";
  }

  const doc = withInputs({ ...next, version: 1, updatedAt: Date.now() });
  try {
    await ioBroker.setState(OVERRIDE_LIST_ID, JSON.stringify(doc));
  } catch (e) {
    saveFailed = true;
    console.error("save overrides:", e);
    return "failed";
  }
  use(doc, "loaded");
  saveFailed = false;
  return "saved";
}

/** Load the document; an absent one is a valid empty registry. */
export function initOverrides(): Promise<void> {
  registerProgramStateId(OVERRIDE_LIST_ID);
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      if (!ioBroker.connected) {
        // Nothing was read, so nothing may be written: stay read-only and let a
        // later init retry. Treating this as an absent document could replace a
        // real one that never arrived.
        console.error(
          "initOverrides: no connection — the override list stays read-only",
        );
        initPromise = null;
        return;
      }
      try {
        await ensureOverridesObject();
      } catch (e) {
        console.error("initOverrides ensureOverridesObject:", e);
      }
      const state = await readState();
      const value = state?.value;
      const empty = value === null || value === undefined || value === "";
      if (!empty) {
        const doc = normalizeOverrideRegistry(value);
        if (doc) {
          use(withInputs(doc), "loaded");
          return;
        }
        loadKind = "unreadable";
        console.error(
          "the override list is unreadable — leaving it untouched rather than overwriting it",
        );
        return;
      }
      use(emptyOverrideRegistry(), "absent");
    })().catch((e) => {
      console.error("initOverrides:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
