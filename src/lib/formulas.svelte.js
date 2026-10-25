// @ts-nocheck
// Persists the formula-template library to its own ioBroker state, mirroring the
// registry pattern: create the state if missing, load it once on connect, keep it
// in sync via onUpdate (with echo suppression) and debounce writes back.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  FORMULA_LIST_ID,
  getFormulaLibrary,
  setFormulaLibrary,
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
    lastSent = snapshot;
    ioBroker
      .setState(FORMULA_LIST_ID, snapshot)
      .catch((e) => console.error("save formulas:", e));
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
      if (st) {
        st.onUpdate = (_cl, state) => {
          const raw = state?.val;
          const asString = typeof raw === "string" ? raw : JSON.stringify(raw);
          if (lastSent !== null && lastSent === asString) return true;
          setFormulaLibrary(migrateLibrary(raw));
          return true;
        };
        const lib = migrateLibrary(st.value);
        if (lib.formulas.length) {
          setFormulaLibrary(lib);
        } else {
          setFormulaLibrary(seedLibrary());
          saveFormulas();
        }
      } else {
        initPromise = null;
      }
    })().catch((e) => {
      console.error("initFormulas:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
