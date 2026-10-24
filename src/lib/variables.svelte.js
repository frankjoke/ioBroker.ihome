// @ts-nocheck
// Persists the global-variable list to its own ioBroker state and creates the
// states a state variable names (never for constants). Mirrors the formula
// library: one JSON document, onUpdate with echo suppression, debounced writes.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  VARIABLE_LIST_ID,
  getVariableLibrary,
  setVariableLibrary,
} from "$lib/stores/variables.svelte.ts";
import {
  VARIABLES_FOLDER_ID,
  initialValue,
  migrateVariables,
} from "$lib/config/variables";
import { registerProgramStateId } from "$lib/stores/devices.svelte";

let initPromise = null;
let saveTimer = null;
let lastSent = null;

/** Register every state a variable points at: external ids need the explicit
 *  subscription; ihome.0 ones need the app's own used-set entry to be cached.
 *  The list document itself is registered too, so an edit from another device
 *  reaches this one live (same as the formula library). */
function registerVariableStateIds() {
  registerProgramStateId(VARIABLE_LIST_ID);
  for (const v of getVariableLibrary().variables ?? []) {
    if (v.kind === "state" && v.stateId) registerProgramStateId(v.stateId);
  }
}

/** Load the current values of the states a variable points at. The object
 *  cache is no gate here: a state outside `ihome.0` is fetched even when this
 *  client never cached its object — the reply proves it exists. */
function hydrateVariableStates() {
  registerVariableStateIds();
  for (const v of getVariableLibrary().variables ?? []) {
    if (v.kind !== "state" || !v.stateId) continue;
    void ioBroker.getState(v.stateId);
  }
}

async function ensureVariableObject() {
  const obj = await ioBroker.getObject(VARIABLE_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", VARIABLE_LIST_ID, {
      type: "state",
      common: {
        name: "AiHome global variables",
        type: "json",
        role: "json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

/** Create the state object for a new state variable and give it a start value. */
async function createVariableState(v) {
  if (
    v.stateId.startsWith(`${VARIABLES_FOLDER_ID}.`) &&
    !ioBroker.objects?.has(VARIABLES_FOLDER_ID)
  ) {
    const folder = {
      _id: VARIABLES_FOLDER_ID,
      type: "folder",
      common: { name: "iHome variables" },
      native: {},
    };
    await ioBroker.emitAsync("setObject", VARIABLES_FOLDER_ID, folder);
    ioBroker.objects.update(VARIABLES_FOLDER_ID, folder);
  }
  const type = ["string", "number", "boolean"].includes(v.type)
    ? v.type
    : "string";
  const obj = {
    _id: v.stateId,
    type: "state",
    common: {
      name: v.name || v.stateId,
      type,
      role: "value",
      read: true,
      write: true,
      ...(v.unit ? { unit: v.unit } : {}),
    },
    native: {},
  };
  await ioBroker.emitAsync("setObject", v.stateId, obj);
  // An id outside `ihome.0` is not object-subscribed, so the broker will never
  // push this object back: cache what we just created, or the row would read
  // "missing" until a reload.
  ioBroker.objects.update(v.stateId, obj);
  await ioBroker.setState(v.stateId, initialValue(type));
  // The created state is not in the local cache yet; reading it is the only way
  // to show a value — but the broker can need a moment before it serves the
  // state it just learned about (an immediate read logs "not found").
  await ioBroker.wait(300);
  void ioBroker.getState(v.stateId);
}

/**
 * Apply one saved variable to the broker: register/subscribe its state and,
 * only when it does not exist yet, create it. Returns an error message for the
 * form; the list entry is already saved, so the page shows it as missing.
 */
export async function applyVariable(v) {
  if (v.kind !== "state" || !v.stateId) return null;
  // Offline, every emit is a silent no-op: say so instead of pretending the
  // state was created (and caching an object the broker never saw).
  if (!ioBroker.connected)
    return "Not connected to ioBroker — save again once the connection is back.";
  try {
    registerProgramStateId(v.stateId);
    // The object cache is not the truth for ids outside ihome.0: ask the
    // broker, so an id that already exists is never overwritten.
    const known = ioBroker.objects?.has(v.stateId)
      ? ioBroker.objects.get(v.stateId)
      : await ioBroker.getObject(v.stateId, true);
    if (known) {
      void ioBroker.getState(v.stateId);
      return null;
    }
    await createVariableState(v);
    return null;
  } catch (e) {
    console.error("apply variable:", e);
    return e instanceof Error ? e.message : String(e);
  }
}

export function saveVariables() {
  registerVariableStateIds();
  clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getVariableLibrary());
  saveTimer = setTimeout(() => {
    lastSent = snapshot;
    ioBroker
      .setState(VARIABLE_LIST_ID, snapshot)
      .catch((e) => console.error("save variables:", e));
  }, 250);
}

export function initVariables() {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureVariableObject();
      } catch (e) {
        console.error("initVariables ensureVariableObject:", e);
      }
      registerVariableStateIds();
      const st = await ioBroker.getState(VARIABLE_LIST_ID);
      if (st) {
        st.onUpdate = (_cl, state) => {
          const raw = state?.val;
          const asString = typeof raw === "string" ? raw : JSON.stringify(raw);
          if (lastSent !== null && lastSent === asString) return true;
          setVariableLibrary(migrateVariables(raw));
          hydrateVariableStates();
          return true;
        };
        setVariableLibrary(migrateVariables(st.value));
        hydrateVariableStates();
      } else {
        initPromise = null;
      }
    })().catch((e) => {
      console.error("initVariables:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
