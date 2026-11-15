// The icon library lives in `ihome.0.config.iconPool` — one state every iHome
// instance already shares, with the conflict model the rest of the app uses.
// `ihome.meta/icons/library.json` is a best-effort mirror for browsing/other
// tools, never the source of truth: a broken mirror must not break the library.

import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  emptyIconPool,
  parseIconPool,
  type IconPool,
} from "$lib/config/icon-library";
import { readLibraryFile, writeLibraryFile } from "$lib/config/icon-files";

export const ICON_POOL_ID = "ihome.0.config.iconPool";

/** The result of a save attempt, so the manager can word the outcome. */
export type IconPoolSave = "saved" | "conflict" | "failed";

let iconPool = $state<IconPool>(emptyIconPool());
let initPromise: Promise<void> | null = null;
let saveFailed = $state(false);
let mirrorStale = $state(false);
let loadKind = $state<"pending" | "absent" | "loaded" | "unreadable">(
  "pending",
);

export function getIconPool(): IconPool {
  return iconPool;
}

export function iconPoolSaveFailed(): boolean {
  return saveFailed;
}

/** The state is fine, but the shared mirror file could not be refreshed. */
export function iconPoolMirrorStale(): boolean {
  return mirrorStale;
}

/** A pending or unreadable document must not be replaced by an empty one. */
export function isIconPoolWritable(): boolean {
  return loadKind === "loaded" || loadKind === "absent";
}

export function iconPoolLoadKind():
  "pending" | "absent" | "loaded" | "unreadable" {
  return loadKind;
}

async function readState(): Promise<{ value?: unknown } | null> {
  let state = await ioBroker.getState(ICON_POOL_ID, true).catch(() => null);
  if (!state) {
    await ioBroker.wait(300);
    state = await ioBroker.getState(ICON_POOL_ID, true).catch(() => null);
  }
  return state;
}

/** Write the mirror and prove it by reading it back over HTTP. A write that
 *  "succeeds" but leaves something that does not parse is retried once, then
 *  reported; the state is already saved and stays authoritative. */
async function writeMirror(pool: IconPool): Promise<void> {
  const text = JSON.stringify(pool);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeLibraryFile(text);
    } catch (error) {
      console.warn("icon library mirror write failed:", error);
      continue;
    }
    const back = await readLibraryFile();
    const parsed = back === null ? null : parseIconPool(back);
    if (parsed && parsed.updatedAt === pool.updatedAt) {
      mirrorStale = false;
      return;
    }
  }
  mirrorStale = true;
  console.warn(
    "icon library mirror did not verify; the state is authoritative",
  );
}

/**
 * Write the whole document. The state is re-read first: a save from another
 * tab or instance since this one loaded is a conflict, not an overwrite. The
 * mirror file is refreshed afterwards and never decides the save's outcome.
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
  const state = await readState();
  const current = parseIconPool(state?.value);
  if (state && !current) {
    saveFailed = true;
    loadKind = "unreadable";
    return "conflict";
  }
  if (current && current.updatedAt !== baseUpdatedAt) {
    iconPool = current;
    loadKind = "loaded";
    return "conflict";
  }

  try {
    await ioBroker.setState(ICON_POOL_ID, JSON.stringify(next));
  } catch (e) {
    saveFailed = true;
    console.error("save icon library:", e);
    return "failed";
  }
  iconPool = next;
  saveFailed = false;
  await writeMirror(next);
  return "saved";
}

/** Re-read the document (the conflict banner's Reload action). */
export function reloadIconPool(): Promise<void> {
  initPromise = null;
  return initIconPool();
}

/**
 * Load the document: the state wins when both exist (it is the truth), the
 * mirror is used when the state is empty (a fresh instance joining an existing
 * shared space) and then repaired back into the state.
 */
export function initIconPool(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }

      const stateText = (await readState())?.value;
      const stateEmpty =
        stateText === null || stateText === undefined || stateText === "";
      // parseIconPool treats an absent value as an empty document; here an
      // empty side must stay "absent" so the other side can win.
      const stateDoc = stateEmpty ? null : parseIconPool(stateText);
      const fileText = await readLibraryFile();
      const fileDoc = fileText === null ? null : parseIconPool(fileText);

      if (stateDoc || fileDoc) {
        const useState =
          !!stateDoc && (!fileDoc || stateDoc.updatedAt >= fileDoc.updatedAt);
        const chosen = (useState ? stateDoc : fileDoc)!;
        iconPool = chosen;
        loadKind = "loaded";
        // Keep both sides in step without letting either override the choice.
        if (!stateDoc || stateDoc.updatedAt < chosen.updatedAt) {
          void ioBroker
            .setState(ICON_POOL_ID, JSON.stringify(chosen))
            .catch(() => undefined);
        }
        if (!fileDoc || fileDoc.updatedAt < chosen.updatedAt) {
          void writeMirror(chosen);
        }
        return;
      }

      if (stateEmpty && fileText === null) {
        iconPool = emptyIconPool();
        loadKind = "absent";
        initPromise = null;
        return;
      }
      loadKind = "unreadable";
      console.error("the icon library is unreadable — leaving it untouched");
    })().catch((e) => {
      console.error("initIconPool:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
