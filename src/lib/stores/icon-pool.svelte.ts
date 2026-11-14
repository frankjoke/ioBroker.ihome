// Persists the user's icon-pool additions. The device/role base pool lives in
// code (`$lib/config/icon-pool`) and is never written here.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { parseIconPool, type IconPool } from "$lib/config/icon-pool";

export const ICON_POOL_ID = "ihome.0.config.iconPool";

const emptyIconPool: IconPool = { version: 1, updatedAt: 0, icons: [] };

let iconPool = $state<IconPool>(emptyIconPool);
let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent: string | null = null;
let saveFailed = $state(false);
let loadKind = $state<"pending" | "absent" | "loaded" | "unreadable">(
  "pending",
);

export function getIconPool(): IconPool {
  return iconPool;
}

export function iconPoolSaveFailed(): boolean {
  return saveFailed;
}

/** A pending or unreadable document must not be replaced by an empty one. */
export function isIconPoolWritable(): boolean {
  return loadKind === "loaded" || loadKind === "absent";
}

export function iconPoolLoadKind():
  "pending" | "absent" | "loaded" | "unreadable" {
  return loadKind;
}

async function ensureIconPoolObject(): Promise<void> {
  const obj = await ioBroker.getObject(ICON_POOL_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", ICON_POOL_ID, {
      type: "state",
      common: {
        name: "iHome icon pool",
        type: "string",
        role: "text.json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

function saveIconPool(): void {
  if (saveTimer) clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getIconPool());
  saveTimer = setTimeout(() => {
    if (!ioBroker.connected) {
      saveFailed = true;
      return;
    }
    lastSent = snapshot;
    ioBroker
      .setState(ICON_POOL_ID, snapshot)
      .then(() => {
        saveFailed = false;
      })
      .catch((e) => {
        saveFailed = true;
        console.error("save icon pool:", e);
      });
  }, 250);
}

export function commitIconPool(next: IconPool): boolean {
  if (!isIconPoolWritable()) {
    console.error(
      "iconPool is not readable (no successful load) — the change was not saved",
    );
    return false;
  }
  iconPool = next;
  saveIconPool();
  return true;
}

/** Load the user pool; an absent document simply means "no additions yet". */
export function initIconPool(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensureIconPoolObject();
      } catch (e) {
        console.error("initIconPool ensureIconPoolObject:", e);
      }
      const st = await ioBroker.getState(ICON_POOL_ID, true);
      if (!st) {
        loadKind = "absent";
        return;
      }
      st.onUpdate = (_cl, state) => {
        const parsed = parseIconPool(state?.val);
        if (!parsed) {
          if (state?.val != null && state.val !== "") loadKind = "unreadable";
          return true;
        }
        const asString = JSON.stringify(parsed);
        if (lastSent !== null && lastSent === asString) return true;
        iconPool = parsed;
        loadKind = "loaded";
        return true;
      };
      const parsed = parseIconPool(st.value);
      if (parsed) {
        loadKind = "loaded";
        iconPool = parsed;
      } else if (st.value != null && st.value !== "") {
        loadKind = "unreadable";
        console.error(
          "iconPool is unreadable — leaving it untouched rather than overwriting it",
        );
      } else {
        loadKind = "absent";
      }
    })().catch((e) => {
      console.error("initIconPool:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
