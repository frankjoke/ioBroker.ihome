// @ts-nocheck
// Persists the function-template library to its own ioBroker state. Same
// registry pattern as formulas: create if missing, load once, echo guard,
// debounced writes. Writes are refused until the document has been read, so a
// failed read is never replaced by "no functions".
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  FUNCTION_LIST_ID,
  getFunctionLibrary,
  isFunctionsWritable,
  setFunctionLibrary,
  setFunctionsLoadKind,
  setFunctionSaveFailed,
} from "$lib/stores/functions.svelte.ts";
import { migrateFunctionLibrary } from "$lib/config/functions";

let initPromise = null;
let saveTimer = null;
let lastSent = null;

/** Read a stored value into a library, or report why it cannot be used. */
function readFunctionLibrary(raw) {
  if (raw == null || raw === "") {
    return { kind: "absent", library: migrateFunctionLibrary(null) };
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
  return { kind: "loaded", library: migrateFunctionLibrary(value) };
}

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
    if (!isFunctionsWritable()) {
      setFunctionSaveFailed(true);
      return;
    }
    // A disconnected socket resolves without sending; never report success.
    if (!ioBroker.connected) {
      setFunctionSaveFailed(true);
      return;
    }
    lastSent = snapshot;
    ioBroker
      .setState(FUNCTION_LIST_ID, snapshot)
      .then(() => setFunctionSaveFailed(false))
      .catch((e) => {
        setFunctionSaveFailed(true);
        console.error("save functions:", e);
      });
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
      if (!st) {
        setFunctionsLoadKind("absent");
        initPromise = null;
        return;
      }
      st.onUpdate = (_cl, state) => {
        const raw = state?.val;
        const asString = typeof raw === "string" ? raw : JSON.stringify(raw);
        if (lastSent !== null && lastSent === asString) return true;
        const read = readFunctionLibrary(raw);
        if (read.kind === "unreadable") {
          setFunctionsLoadKind("unreadable");
          return true;
        }
        setFunctionLibrary(read.library);
        setFunctionsLoadKind(read.kind);
        return true;
      };
      const read = readFunctionLibrary(st.value);
      setFunctionsLoadKind(read.kind);
      if (read.library) {
        setFunctionLibrary(read.library);
      } else {
        console.error(
          "functionList is unreadable — leaving it untouched rather than overwriting it",
        );
      }
    })().catch((e) => {
      console.error("initFunctions:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
