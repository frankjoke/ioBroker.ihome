// The page list under the cog menu's Plugins group (ihome.0.config.pluginPages).
// Same document pattern as the logic list: strict parse, a debounced whole-
// document write, and a refusal to overwrite a document we could not read.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  emptyPluginPages,
  parsePluginPages,
  type PluginPagesDocument,
} from "$lib/config/plugin-pages";

export const PLUGIN_PAGES_ID = "ihome.0.config.pluginPages";

let document = $state<PluginPagesDocument>(emptyPluginPages());
let loadKind = $state<"pending" | "absent" | "loaded" | "unreadable">(
  "pending",
);
let saveFailed = $state(false);
let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function getPluginPages(): PluginPagesDocument {
  return document;
}

export function pluginPagesLoadKind(): typeof loadKind {
  return loadKind;
}

export function pluginPagesSaveFailed(): boolean {
  return saveFailed;
}

/** False until the document was read, and false for an unreadable one. */
export function isPluginPagesWritable(): boolean {
  return loadKind === "loaded" || loadKind === "absent";
}

async function ensurePluginPagesObject(): Promise<void> {
  const obj = await ioBroker.getObject(PLUGIN_PAGES_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", PLUGIN_PAGES_ID, {
      type: "state",
      common: {
        name: "iHome plugin pages",
        type: "string",
        role: "text.json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  const snapshot = JSON.stringify(document);
  saveTimer = setTimeout(() => {
    if (!isPluginPagesWritable()) {
      saveFailed = true;
      return;
    }
    const parsed = parsePluginPages(snapshot);
    if (!parsed) {
      saveFailed = true;
      return;
    }
    if (!ioBroker.connected) {
      saveFailed = true;
      return;
    }
    ioBroker
      .setState(PLUGIN_PAGES_ID, JSON.stringify(parsed))
      .then(() => {
        saveFailed = false;
      })
      .catch((error: unknown) => {
        saveFailed = true;
        console.error("save plugin pages:", error);
      });
  }, 250);
}

/** The editor's only write path; refuses while the document is unreadable. */
export function commitPluginPages(next: PluginPagesDocument): boolean {
  if (!isPluginPagesWritable()) {
    console.error(
      "pluginPages is not readable (no successful load) — the change was not saved",
    );
    return false;
  }
  const parsed = parsePluginPages(JSON.stringify(next));
  if (!parsed) return false;
  document = parsed;
  scheduleSave();
  return true;
}

export function initPluginPages(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensurePluginPagesObject();
      } catch (error) {
        console.error("initPluginPages ensure:", error);
      }
      const st = await ioBroker.getState(PLUGIN_PAGES_ID, true);
      if (!st) {
        loadKind = "absent";
        return;
      }
      st.onUpdate = (_cl: unknown, state: { val?: unknown }) => {
        const parsed = parsePluginPages(state?.val);
        if (!parsed) {
          if (state?.val != null && state.val !== "") {
            loadKind = "unreadable";
            if (saveTimer) {
              clearTimeout(saveTimer);
              saveTimer = null;
            }
          }
          return true;
        }
        if (JSON.stringify(document) === JSON.stringify(parsed)) return true;
        document = parsed;
        loadKind = "loaded";
        return true;
      };
      const parsed = parsePluginPages(st.value);
      if (parsed) {
        document = parsed;
        loadKind = "loaded";
      } else if (st.value != null && st.value !== "") {
        loadKind = "unreadable";
        console.error(
          "pluginPages is unreadable — leaving it untouched rather than overwriting it",
        );
      } else {
        loadKind = "absent";
      }
    })().catch((error: unknown) => {
      console.error("initPluginPages:", error);
      initPromise = null;
    });
  }
  return initPromise;
}
