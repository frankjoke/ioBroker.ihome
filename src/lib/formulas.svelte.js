// @ts-nocheck
// Persists the formula-template library to its own ioBroker state, mirroring the
// registry pattern: create the state if missing, load it once on connect, keep it
// in sync via onUpdate (with echo suppression) and debounce writes back. Writes
// are refused until the document has been read, so a failed read is never
// replaced by "no formulas".
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  FORMULA_LIST_ID,
  getFormulaLibrary,
  isFormulasWritable,
  setFormulaLibrary,
  setFormulaSaveFailed,
  setFormulasLoadKind,
} from "$lib/stores/formulas.svelte.ts";
import { migrateLibrary, seedLibrary } from "$lib/config/formulas";
import { stateIdsInExpression } from "$lib/config/rule-ops";
import { registerProgramStateId } from "$lib/stores/devices.svelte";

/**
 * The formula document and every id its expressions read: a formula is
 * evaluated with the used-state pool, so the document itself (live edits from
 * another device) and its inputs both belong in the used set. Called whenever
 * the library changes — `registerProgramStateId` only bumps for new ids.
 */
function registerFormulaStateIds() {
  registerProgramStateId(FORMULA_LIST_ID);
  for (const template of getFormulaLibrary().templates ?? []) {
    for (const id of stateIdsInExpression(template.expr ?? "")) {
      registerProgramStateId(id);
    }
  }
}

let initPromise = null;
let saveTimer = null;
let lastSent = null;

/** Read a stored value into a library, or report why it cannot be used. */
function readFormulaLibrary(raw) {
  if (raw == null || raw === "") {
    return { kind: "absent", library: migrateLibrary(null) };
  }
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return { kind: "unreadable", library: null };
    }
  }
  if (!value || typeof value !== "object") {
    return { kind: "unreadable", library: null };
  }
  return { kind: "loaded", library: migrateLibrary(value) };
}

async function ensureFormulaObject() {
  const obj = await ioBroker.getObject(FORMULA_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", FORMULA_LIST_ID, {
      type: "state",
      common: {
        name: "AiHome formula templates",
        type: "json",
        role: "json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

export function saveFormulas() {
  registerFormulaStateIds();
  clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getFormulaLibrary());
  saveTimer = setTimeout(() => {
    if (!isFormulasWritable()) {
      setFormulaSaveFailed(true);
      return;
    }
    // A disconnected socket resolves without sending; never report success.
    if (!ioBroker.connected) {
      setFormulaSaveFailed(true);
      return;
    }
    lastSent = snapshot;
    ioBroker
      .setState(FORMULA_LIST_ID, snapshot)
      .then(() => setFormulaSaveFailed(false))
      .catch((e) => {
        setFormulaSaveFailed(true);
        console.error("save formulas:", e);
      });
  }, 250);
}

export function initFormulas() {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureFormulaObject();
      } catch (e) {
        console.error("initFormulas ensureFormulaObject:", e);
      }
      registerFormulaStateIds();
      const st = await ioBroker.getState(FORMULA_LIST_ID, true);
      if (!st) {
        setFormulasLoadKind("absent");
        initPromise = null;
        return;
      }
      st.onUpdate = (_cl, state) => {
        const raw = state?.val;
        const asString = typeof raw === "string" ? raw : JSON.stringify(raw);
        if (lastSent !== null && lastSent === asString) return true;
        const read = readFormulaLibrary(raw);
        if (read.kind === "unreadable") {
          setFormulasLoadKind("unreadable");
          return true;
        }
        setFormulaLibrary(read.library);
        setFormulasLoadKind(read.kind);
        return true;
      };
      const read = readFormulaLibrary(st.value);
      setFormulasLoadKind(read.kind);
      if (read.kind === "unreadable") {
        console.error(
          "formulaList is unreadable — leaving it untouched rather than overwriting it",
        );
        return;
      }
      if (!read.library || read.library.formulas.length === 0) {
        setFormulaLibrary(seedLibrary());
        saveFormulas();
      } else {
        setFormulaLibrary(read.library);
      }
    })().catch((e) => {
      console.error("initFormulas:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
