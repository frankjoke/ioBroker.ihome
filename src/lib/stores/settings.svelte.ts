// The shared settings document (ihome.0.config.settings). One JSON object, read
// and written over the same socket as the other config documents; the local
// storage keys the app keeps are its cache, never the truth (settings-ops.ts
// owns what a document may contain, +layout.svelte mirrors it into the cache).

import { DEFAULT_PIN } from "$lib/config/pin.svelte";
import {
  mergeSettings,
  missingPin,
  parseSettings,
  settingsDocument,
  type Settings,
} from "$lib/config/settings-ops";
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { registerProgramStateId } from "$lib/stores/devices.svelte.js";

export const SETTINGS_ID = "ihome.0.config.settings";

let settings = $state<Settings>({});
let loaded = $state(false);
let saveFailed = $state(false);
/** The last document this browser wrote: its own echo is ignored (as pages does). */
let lastSent: string | null = null;
let initPromise: Promise<void> | null = null;

export function getSettings(): Settings {
  return settings;
}

export function isSettingsLoaded(): boolean {
  return loaded;
}

/** True while the last write failed, so the Security card can say "not saved". */
export function settingsSaveFailed(): boolean {
  return saveFailed;
}

async function ensureSettingsObject() {
  const obj = await ioBroker.getObject(SETTINGS_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", SETTINGS_ID, {
      type: "state",
      common: {
        name: "iHome settings",
        type: "json",
        role: "json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

/**
 * Merge a patch into the document and write it at once: settings change only on
 * a deliberate action, and the forced-PIN flow reloads right after — a debounce
 * would lose that write. The in-memory copy takes the change first, so the UI
 * answers immediately; a failed write is reported, not hidden.
 */
export async function updateSettings(
  patch: Partial<Settings>,
): Promise<boolean> {
  if (!ioBroker.connected) {
    saveFailed = true;
    return false;
  }
  const next = mergeSettings(settings, patch);
  settings = next;
  lastSent = JSON.stringify(next);
  try {
    await ioBroker.setState(SETTINGS_ID, lastSent);
    saveFailed = false;
    return true;
  } catch (e) {
    saveFailed = true;
    console.error("save settings:", e);
    return false;
  }
}

/**
 * Load the document once the socket is up and keep following it. `apply` gets
 * every version this browser adopts — the first read and each remote change —
 * so the layout can mirror it into the cache. Nothing readable (offline, or a
 * document that is not an object) leaves the memo unset, so a later call retries;
 * an unreadable document is never overwritten on load (D-1).
 */
export function initSettings(
  apply?: (settings: Settings) => void,
): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureSettingsObject();
      } catch (e) {
        console.error("initSettings ensureSettingsObject:", e);
      }
      registerProgramStateId(SETTINGS_ID);
      const st = await ioBroker.getState(SETTINGS_ID);
      if (!st) {
        initPromise = null;
        return;
      }
      // Registered before the first parse: a repaired document still arrives.
      st.onUpdate = (_cl, state) => {
        const parsed = parseSettings(state?.val);
        if (!parsed) return true;
        const asString = JSON.stringify(parsed);
        if (lastSent !== null && lastSent === asString) return true;
        settings = parsed;
        loaded = true;
        apply?.(settings);
        return true;
      };
      const doc = settingsDocument(st.value);
      if (!doc) {
        initPromise = null;
        return;
      }
      settings = doc;
      loaded = true;
      if (missingPin(doc)) {
        await updateSettings({ pin: DEFAULT_PIN });
      }
      apply?.(getSettings());
    })().catch((e) => {
      console.error("initSettings:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
