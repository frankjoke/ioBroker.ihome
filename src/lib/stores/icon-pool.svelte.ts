// Persists the user's icon-pool additions. The device/role base pool lives in
// code (`$lib/config/icon-pool`) and is never written here.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { registerProgramStateId } from "$lib/stores/devices.svelte";
import { parseIconPool, type IconPool } from "$lib/config/icon-pool";

export const ICON_POOL_ID = "ihome.0.config.iconPool";

const emptyIconPool: IconPool = { version: 1, updatedAt: 0, icons: [] };

let iconPool = $state<IconPool>(emptyIconPool);
let initPromise: Promise<void> | null = null;
/** The updatedAt this tab last wrote; its own echo is not a remote change. */
let lastSent: number | null = null;
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

/** Create the document when it is missing; true when it already existed. */
async function ensureIconPoolObject(): Promise<boolean> {
  const obj = await ioBroker.getObject(ICON_POOL_ID);
  if (obj) return true;
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
  return false;
}

/**
 * Write the whole document. Only the manager saves, and only on an explicit
 * Save, so there is no debounce; the promise settles with the write.
 */
export function commitIconPool(next: IconPool): Promise<boolean> {
  if (!isIconPoolWritable()) {
    console.error(
      "iconPool is not readable (no successful load) — the change was not saved",
    );
    return Promise.resolve(false);
  }
  iconPool = next;
  if (!ioBroker.connected) {
    saveFailed = true;
    return Promise.resolve(false);
  }
  lastSent = next.updatedAt;
  saveFailed = false;
  return ioBroker.setState(ICON_POOL_ID, JSON.stringify(next)).then(
    () => true,
    (e) => {
      saveFailed = true;
      console.error("save icon pool:", e);
      return false;
    },
  );
}

/** Load the user pool; an absent document simply means "no additions yet". */
export function initIconPool(): Promise<void> {
  if (!initPromise) {
    // Without this the connection layer never reads the document, so another
    // tab's save would be invisible and the conflict warning unreachable.
    registerProgramStateId(ICON_POOL_ID);
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      let existed = false;
      try {
        existed = await ensureIconPoolObject();
      } catch (e) {
        console.error("initIconPool ensureIconPoolObject:", e);
      }
      const st = await ioBroker.getState(ICON_POOL_ID, true);
      if (!st) {
        // A failed read of an existing document is not "no additions yet":
        // treating it as absent would let an empty draft overwrite it.
        loadKind = existed ? "unreadable" : "absent";
        return;
      }
      st.onUpdate = (_cl, state) => {
        const parsed = parseIconPool(state?.val);
        if (!parsed) {
          if (state?.val != null && state.val !== "") loadKind = "unreadable";
          return true;
        }
        if (lastSent !== null && parsed.updatedAt === lastSent) return true;
        iconPool = parsed;
        loadKind = "loaded";
        saveFailed = false;
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
