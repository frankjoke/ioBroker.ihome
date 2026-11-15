// Persists the user's icon-pool additions. The device/role base pool lives in
// code (`$lib/config/icon-pool`) and is never written here.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { registerProgramStateId } from "$lib/stores/devices.svelte";
import {
  emptyIconPool,
  parseIconPool,
  type IconPool,
} from "$lib/config/icon-library";

export const ICON_POOL_ID = "ihome.0.config.iconPool";

/** The result of a save attempt, so the manager can word the outcome. */
export type IconPoolSave = "saved" | "conflict" | "failed";

let iconPool = $state<IconPool>(emptyIconPool());
let initPromise: Promise<void> | null = null;
/** The updatedAt this tab last wrote; its own echo is not a remote change. */
let lastSent: number | null = null;
let subscribed = false;
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
  if (obj) return;
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

function attachUpdates(st: { onUpdate?: unknown }): void {
  subscribed = true;
  st.onUpdate = (_cl: unknown, state: { val?: unknown }) => {
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
}

/**
 * Write the whole document. Only the manager saves, and only on an explicit
 * Save, so there is no debounce; the promise settles with the write. The state
 * is re-read first: an absent document that another tab has since created must
 * not be overwritten by this tab's empty draft.
 */
export async function commitIconPool(
  next: IconPool,
  baseUpdatedAt: number,
): Promise<IconPoolSave> {
  if (!isIconPoolWritable()) {
    console.error(
      "iconPool is not readable (no successful load) — the change was not saved",
    );
    return "failed";
  }
  if (!ioBroker.connected) {
    saveFailed = true;
    return "failed";
  }
  let st;
  try {
    st = await ioBroker.getState(ICON_POOL_ID, true);
  } catch (e) {
    saveFailed = true;
    console.error("re-read icon pool before save:", e);
    return "failed";
  }
  if (!st && baseUpdatedAt !== 0) return "conflict";
  const current = parseIconPool(st?.value);
  if (st && !current) return "conflict";
  if (current && current.updatedAt !== baseUpdatedAt) {
    iconPool = current;
    loadKind = "loaded";
    attachUpdates(st!);
    return "conflict";
  }
  iconPool = next;
  lastSent = next.updatedAt;
  saveFailed = false;
  try {
    await ioBroker.setState(ICON_POOL_ID, JSON.stringify(next));
  } catch (e) {
    saveFailed = true;
    console.error("save icon pool:", e);
    return "failed";
  }
  if (!subscribed) {
    // The first save created the state; subscribe to it from now on.
    initPromise = null;
    void initIconPool();
  }
  return "saved";
}

/** Re-read the document (the conflict banner's Reload action). */
export function reloadIconPool(): Promise<void> {
  initPromise = null;
  subscribed = false;
  lastSent = null;
  return initIconPool();
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
      try {
        await ensureIconPoolObject();
      } catch (e) {
        console.error("initIconPool ensureIconPoolObject:", e);
      }
      let st = await ioBroker.getState(ICON_POOL_ID, true);
      if (!st) {
        // A never-written state and a failed read both read as "not found";
        // ask once more before treating the document as absent.
        await ioBroker.wait(300);
        st = await ioBroker.getState(ICON_POOL_ID, true);
      }
      if (!st) {
        // The adapter creates the object but writes no value on a fresh
        // install. That is an empty pool, not an unreadable one.
        loadKind = "absent";
        initPromise = null;
        return;
      }
      attachUpdates(st);
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
        initPromise = null;
      }
    })().catch((e) => {
      console.error("initIconPool:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
