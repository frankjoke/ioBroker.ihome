// The icon library lives in the shared meta file space (`ihome.meta`), so every
// iHome instance reads the same document and the same image files. The old
// `ihome.0.config.iconPool` state is read once for migration and kept as a
// best-effort mirror for older builds; it is no longer the truth.

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

/** The legacy state, read only when the shared file does not exist yet. */
async function readLegacyState(): Promise<{ value?: unknown } | null> {
  let state = await ioBroker.getState(ICON_POOL_ID, true).catch(() => null);
  if (!state) {
    await ioBroker.wait(300);
    state = await ioBroker.getState(ICON_POOL_ID, true).catch(() => null);
  }
  return state;
}

/**
 * Write the whole library. The file is re-read first: a save from another tab
 * or instance since this one loaded is reported as a conflict rather than
 * silently overwritten.
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
  const currentText = await readLibraryFile();
  if (currentText !== null) {
    const current = parseIconPool(currentText);
    // A corrupt file must not block saves forever: the draft being saved is a
    // whole valid document, so the write repairs it.
    if (current && current.updatedAt !== baseUpdatedAt) {
      iconPool = current;
      loadKind = "loaded";
      return "conflict";
    }
  } else if (baseUpdatedAt !== 0) {
    // The file vanished under us; let the caller reload instead of guessing.
    return "conflict";
  }

  try {
    await writeLibraryFile(JSON.stringify(next));
  } catch (e) {
    saveFailed = true;
    console.error("save icon library:", e);
    return "failed";
  }
  iconPool = next;
  saveFailed = false;
  // Mirror for older builds; a failure here does not fail the save.
  void ioBroker
    .setState(ICON_POOL_ID, JSON.stringify(next))
    .catch(() => undefined);
  return "saved";
}

/** Re-read the shared document (the conflict banner's Reload action). */
export function reloadIconPool(): Promise<void> {
  initPromise = null;
  return initIconPool();
}

/** Load the shared library; an absent file migrates from the legacy state. */
export function initIconPool(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }

      const text = await readLibraryFile();
      if (text !== null) {
        const parsed = parseIconPool(text);
        if (parsed) {
          iconPool = parsed;
          loadKind = "loaded";
          return;
        }
        console.error("the shared icon library is unreadable — trying the mirror");
        // Repair from the legacy mirror when it holds a valid document.
        try {
          const legacyText = (await readLegacyState())?.value;
          if (legacyText !== null && legacyText !== undefined && legacyText !== "") {
            const repaired = parseIconPool(legacyText);
            if (repaired) {
              await writeLibraryFile(JSON.stringify(repaired));
              iconPool = repaired;
              loadKind = "loaded";
              return;
            }
          }
        } catch (e) {
          console.error("initIconPool repair:", e);
        }
        loadKind = "unreadable";
        return;
      }

      // First run of the shared space: take the legacy state (or start empty)
      // and seed the file so other instances see the same document.
      let legacy: unknown = undefined;
      try {
        legacy = (await readLegacyState())?.value;
      } catch (e) {
        console.error("initIconPool read legacy:", e);
      }
      if (legacy === null || legacy === undefined || legacy === "") {
        iconPool = emptyIconPool();
        loadKind = "absent";
        initPromise = null;
        return;
      }
      const parsed = parseIconPool(legacy);
      if (!parsed) {
        loadKind = "unreadable";
        return;
      }
      iconPool = parsed;
      loadKind = "loaded";
      try {
        await writeLibraryFile(JSON.stringify(parsed));
      } catch (e) {
        console.error("seed the shared icon library:", e);
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
