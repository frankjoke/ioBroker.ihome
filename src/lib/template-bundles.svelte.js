// @ts-nocheck
// Persists the combined template library to its own ioBroker state. Same
// registry pattern as functions: create if missing, load once, echo guard,
// debounced writes. Writes are refused until the document has been read, so a
// failed read is never replaced by "no bundles".
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  TEMPLATE_BUNDLE_LIST_ID,
  getTemplateBundleLibrary,
  isTemplateBundlesWritable,
  setTemplateBundleLibrary,
  setTemplateBundleSaveFailed,
  setTemplateBundlesLoadKind,
} from "$lib/stores/template-bundles.svelte.ts";
import { migrateTemplateBundleLibrary } from "$lib/config/template-bundles";

let initPromise = null;
let saveTimer = null;
let lastSent = null;

/** Read a stored value into a library, or report why it cannot be used. */
function readTemplateBundleLibrary(raw) {
  if (raw == null || raw === "") {
    return { kind: "absent", library: migrateTemplateBundleLibrary(null) };
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
  return { kind: "loaded", library: migrateTemplateBundleLibrary(value) };
}

async function ensureTemplateBundlesObject() {
  const obj = await ioBroker.getObject(TEMPLATE_BUNDLE_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", TEMPLATE_BUNDLE_LIST_ID, {
      type: "state",
      common: {
        name: "AiHome combined templates",
        type: "json",
        role: "json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

export function saveTemplateBundles() {
  clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getTemplateBundleLibrary());
  saveTimer = setTimeout(() => {
    if (!isTemplateBundlesWritable()) {
      setTemplateBundleSaveFailed(true);
      return;
    }
    // A disconnected socket resolves without sending; never report success.
    if (!ioBroker.connected) {
      setTemplateBundleSaveFailed(true);
      return;
    }
    lastSent = snapshot;
    ioBroker
      .setState(TEMPLATE_BUNDLE_LIST_ID, snapshot)
      .then(() => setTemplateBundleSaveFailed(false))
      .catch((e) => {
        setTemplateBundleSaveFailed(true);
        console.error("save template bundles:", e);
      });
  }, 250);
}

export function initTemplateBundles() {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureTemplateBundlesObject();
      } catch (e) {
        console.error("initTemplateBundles ensureTemplateBundlesObject:", e);
      }
      const st = await ioBroker.getState(TEMPLATE_BUNDLE_LIST_ID, true);
      if (!st) {
        setTemplateBundlesLoadKind("absent");
        initPromise = null;
        return;
      }
      st.onUpdate = (_cl, state) => {
        const raw = state?.val;
        const asString = typeof raw === "string" ? raw : JSON.stringify(raw);
        if (lastSent !== null && lastSent === asString) return true;
        const read = readTemplateBundleLibrary(raw);
        if (read.kind === "unreadable") {
          setTemplateBundlesLoadKind("unreadable");
          return true;
        }
        setTemplateBundleLibrary(read.library);
        setTemplateBundlesLoadKind(read.kind);
        return true;
      };
      const read = readTemplateBundleLibrary(st.value);
      setTemplateBundlesLoadKind(read.kind);
      if (read.library) {
        setTemplateBundleLibrary(read.library);
      } else {
        console.error(
          "templateBundleList is unreadable — leaving it untouched rather than overwriting it",
        );
      }
    })().catch((e) => {
      console.error("initTemplateBundles:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
