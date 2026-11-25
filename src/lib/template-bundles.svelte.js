// @ts-nocheck
// Combined templates (bundles) live as one file per bundle in the shared space
// (`ihome.meta/templates/bundle/<id>.json`). The folder is the truth; the old
// `templateBundleList` state is read once for migration and then left untouched.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  templateBundleListId,
  getTemplateBundleLibrary,
  isTemplateBundlesWritable,
  setTemplateBundleLibrary,
  setTemplateBundleSaveFailed,
  setTemplateBundlesLoadKind,
} from "$lib/stores/template-bundles.svelte.ts";
import { migrateTemplateBundleLibrary } from "$lib/config/template-bundles";
import { listTemplates, syncKind } from "$lib/config/template-files";

let initPromise = null;
let saveTimer = null;
/** Ids present in the folder at the last load/save; deleting removes the rest. */
let knownIds = {};

function libraryOf(bundles) {
  return { version: 1, updatedAt: Date.now(), bundles };
}

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

export function saveTemplateBundles() {
  clearTimeout(saveTimer);
  const bundles = getTemplateBundleLibrary().bundles ?? [];
  saveTimer = setTimeout(() => {
    if (!isTemplateBundlesWritable() || !ioBroker.connected) {
      setTemplateBundleSaveFailed(true);
      return;
    }
    void (async () => {
      try {
        await syncKind("bundle", bundles, Object.keys(knownIds));
        knownIds = Object.fromEntries(
          bundles.map((bundle) => [bundle.id, true]),
        );
        setTemplateBundleSaveFailed(false);
      } catch (e) {
        setTemplateBundleSaveFailed(true);
        console.error("save template bundles:", e);
      }
    })();
  }, 250);
}

export function initTemplateBundles() {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      if (!ioBroker.connected) {
        initPromise = null;
        return;
      }

      const files = await listTemplates("bundle");
      const readable = files.filter((row) => !!row.file);
      if (files.length) {
        setTemplateBundlesLoadKind("loaded");
        knownIds = Object.fromEntries(readable.map((row) => [row.id, true]));
        setTemplateBundleLibrary(
          libraryOf(readable.map((row) => row.file.definition)),
        );
        return;
      }

      // No files yet: migrate the legacy document once (never written again).
      let state = null;
      try {
        state = await ioBroker.getState(
          templateBundleListId(ioBroker.namespace),
          true,
        );
      } catch (e) {
        console.error("initTemplateBundles legacy:", e);
      }
      const read = readTemplateBundleLibrary(state?.value);
      setTemplateBundlesLoadKind(read.kind);
      if (!read.library) {
        console.error(
          "the legacy bundle document is unreadable and no bundle files exist — leaving both untouched",
        );
        return;
      }
      setTemplateBundleLibrary(read.library);
      if (read.kind === "loaded") {
        try {
          await syncKind("bundle", read.library.bundles ?? [], []);
          knownIds = Object.fromEntries(
            (read.library.bundles ?? []).map((bundle) => [bundle.id, true]),
          );
        } catch (e) {
          setTemplateBundleSaveFailed(true);
          console.error("migrate template bundles:", e);
        }
      }
    })().catch((e) => {
      console.error("initTemplateBundles:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
