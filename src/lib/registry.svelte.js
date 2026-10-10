// @ts-nocheck
// Persists the canonical device registry to an ioBroker state, mirroring the
// pattern: create the state if missing, load it once
// on connect, keep it in sync via onUpdate (with echo suppression) and debounce
// writes back to ioBroker.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  DEVICE_LIST_ID,
  getCanonicalRegistry,
  setCanonicalRegistry,
} from "$lib/stores/devices";
import { loadUsedStates } from "$lib/states.svelte.js";
import { migrateRegistry } from "$lib/config/transform-ops";

let initPromise = null;
let saveTimer = null;
let lastSent = null;

function parseRegistry(raw) {
  if (raw && typeof raw === "object" && "val" in raw) raw = raw.val;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw && typeof raw === "object" && Array.isArray(raw.devices)) {
    return {
      version: raw.version ?? 0,
      updatedAt: raw.updatedAt ?? Date.now(),
      devices: raw.devices,
    };
  }
  return null;
}

async function ensureRegistryObject() {
  const obj = await ioBroker.getObject(DEVICE_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", DEVICE_LIST_ID, {
      type: "state",
      common: {
        name: "AiHome device list",
        type: "json",
        role: "json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

export function saveRegistry() {
  // New state ids may have entered the used set — load their current values.
  void loadUsedStates();
  clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getCanonicalRegistry());
  saveTimer = setTimeout(() => {
    lastSent = snapshot;
    ioBroker
      .setState(DEVICE_LIST_ID, snapshot)
      .then(() => console.log("[registry] setState OK"))
      .catch((e) => console.error("save registry:", e));
  }, 250);
}

export function initRegistry() {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureRegistryObject();
      } catch (e) {
        console.error("initRegistry ensureRegistryObject:", e);
      }
      const st = await ioBroker.getState(DEVICE_LIST_ID);
      if (st) {
        st.onUpdate = (_cl, state) => {
          const parsed = parseRegistry(state?.val);
          if (!parsed) return true;
          const asString = JSON.stringify(parsed);
          if (lastSent !== null && lastSent === asString) {
            console.log("[registry] onUpdate -> ignore echo (skip)");
            return true;
          }
          console.log("[registry] onUpdate -> apply");
          setCanonicalRegistry(migrateRegistry(parsed));
          void loadUsedStates();
          return true;
        };
        const parsed = parseRegistry(st.value);
        if (parsed) {
          setCanonicalRegistry(migrateRegistry(parsed));
          console.log(
            "[registry] init loaded:",
            parsed.devices?.length ?? 0,
            "devices",
          );
        }
        void loadUsedStates();
      } else {
        initPromise = null;
      }
    })().catch((e) => {
      console.error("initRegistry:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
