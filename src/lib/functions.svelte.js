// @ts-nocheck
// Persists the function-template library to its own ioBroker state. Same
// registry pattern as formulas: create if missing, load once, echo guard,
// debounced writes.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  FUNCTION_LIST_ID,
  getFunctionLibrary,
  setFunctionLibrary,
} from "$lib/stores/functions.svelte.ts";
import { migrateFunctionLibrary } from "$lib/config/functions";

let initPromise = null;
let saveTimer = null;
let lastSent = null;

async function ensureFunctionObject() {
  const obj = await ioBroker.getObject(FUNCTION_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", FUNCTION_LIST_ID, {
      type: "state",
      common: {
        name: "AiHome function templates",
        type: "json",
        role: "json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

export function saveFunctions() {
  clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getFunctionLibrary());
  saveTimer = setTimeout(() => {
    lastSent = snapshot;
    ioBroker
      .setState(FUNCTION_LIST_ID, snapshot)
      .catch((e) => console.error("save functions:", e));
  }, 250);
}

export function initFunctions() {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureFunctionObject();
      } catch (e) {
        console.error("initFunctions ensureFunctionObject:", e);
      }
      const st = await ioBroker.getState(FUNCTION_LIST_ID, true);
      if (st) {
        st.onUpdate = (_cl, state) => {
          const raw = state?.val;
          const asString = typeof raw === "string" ? raw : JSON.stringify(raw);
          if (lastSent !== null && lastSent === asString) return true;
          setFunctionLibrary(migrateFunctionLibrary(raw));
          return true;
        };
        setFunctionLibrary(migrateFunctionLibrary(st.value));
      } else {
        initPromise = null;
      }
    })().catch((e) => {
      console.error("initFunctions:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
