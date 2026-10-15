// Persists the display page list to its own ioBroker state, following the
// registry pattern: create the state if missing, load it once on connect, keep
// it in sync via onUpdate (with echo suppression), debounce writes back.
//
// The ioBroker client is imported directly (never injected through a module
// global): Vite HMR can hand this module two instances, and a module-global
// client then desyncs them — see the 2026-10-13 handoff.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  loadPages,
  mayWritePages,
  migratePageRegistry,
  parsePageRegistry,
  type FilterableDevice,
  type LoadedPages,
} from "$lib/config/pages-ops";

/**
 * Wait for the enum cache: `connected` flips before objects/enums are in, and
 * anything that reads rooms/functions (seeding, the enum backfill) needs it.
 */
export async function waitForEnumCache(ms = 8000): Promise<void> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    const rooms = (ioBroker.enums as any)?.getList?.("rooms");
    if (Array.isArray(rooms) && rooms.length > 0) return;
    await ioBroker.wait(200);
  }
}
import { registerProgramStateId } from "$lib/stores/devices.svelte";
import type { PageRegistry } from "$lib/types/display";

export const PAGE_LIST_ID = "0_userdata.0.Test.AiHome.pageList";

const emptyRegistry: PageRegistry = { version: 0, updatedAt: 0, pages: [] };

let pageRegistry = $state<PageRegistry>(emptyRegistry);

export function getPageRegistry(): PageRegistry {
  return pageRegistry;
}

export function setPageRegistry(reg: PageRegistry): void {
  pageRegistry = reg;
}

let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent: string | null = null;
let saveFailed = $state(false);
/** How the stored document last loaded — nothing may be written unless a read
 *  actually succeeded (`loaded`) or this run seeded it (`seeded`). */
let pagesLoadKind = $state<LoadedPages["kind"] | null>(null);

/**
 * True while the last document write failed, so the editor can say "not saved"
 * instead of pretending the change landed.
 */
export function getLayoutSaveFailed(): boolean {
  return saveFailed;
}

/**
 * May the editor write? False until a document has been read or seeded, and
 * false for an unreadable one — see `mayWritePages`. The editor disables its
 * actions on this, so a failed read cannot be replaced by an empty document.
 */
export function isLayoutWritable(): boolean {
  return mayWritePages(pagesLoadKind);
}

async function ensurePagesObject() {
  const obj = await ioBroker.getObject(PAGE_LIST_ID);
  if (!obj) {
    await ioBroker.emitAsync("setObject", PAGE_LIST_ID, {
      type: "state",
      common: {
        name: "AiHome display pages",
        type: "json",
        role: "json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

export function savePages(): void {
  if (saveTimer) clearTimeout(saveTimer);
  const snapshot = JSON.stringify(getPageRegistry());
  saveTimer = setTimeout(() => {
    // A disconnected socket resolves `emitAsync` without sending anything, so a
    // write would look successful while the broker never saw it (review I1).
    if (!ioBroker.connected) {
      saveFailed = true;
      return;
    }
    lastSent = snapshot;
    ioBroker
      .setState(PAGE_LIST_ID, snapshot)
      .then(() => {
        saveFailed = false;
      })
      .catch((e) => {
        saveFailed = true;
        console.error("save pages:", e);
      });
  }, 250);
}

/**
 * The editor's only write path: replace the registry and persist it. Refuses
 * until a document has been read or seeded, so an unreadable or half-loaded one
 * is never replaced by whatever is in memory (review C1).
 */
export function commitLayout(next: PageRegistry): boolean {
  if (!isLayoutWritable()) {
    console.error(
      "pageList is not writable yet (no successful load) — the change was not saved",
    );
    return false;
  }
  setPageRegistry(next);
  savePages();
  return true;
}

/**
 * The one-time bridge from a filter-based document to placements (A15), called
 * once both the registry and the device list are loaded. It is a no-op when the
 * document is already current, so it is safe on every connect.
 */
export function migrateLayout(devices: FilterableDevice[]): boolean {
  const { registry, changed } = migratePageRegistry(getPageRegistry(), devices);
  if (changed) commitLayout(registry);
  return changed;
}

/**
 * Load the page list, seeding it once when the state is empty.
 *
 * `seed` is a factory rather than a value: it is called after the connection is
 * up, which is when the enum cache is populated, so the seeded groups actually
 * have rooms and functions to point at.
 */
export function initPages(seed?: () => PageRegistry): Promise<void> {
  registerProgramStateId(PAGE_LIST_ID);
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      try {
        await ensurePagesObject();
      } catch (e) {
        console.error("initPages ensurePagesObject:", e);
      }
      // Seeding from an empty enum cache would write pages with no groups.
      await waitForEnumCache();
      const st = await ioBroker.getState(PAGE_LIST_ID);
      if (!ioBroker.connected) {
        // Not reachable after the wait — leave the promise unset so a later
        // call retries instead of caching an empty registry.
        initPromise = null;
        return;
      }
      if (st) {
        st.onUpdate = (_cl, state) => {
          const parsed = parsePageRegistry(state?.val);
          if (!parsed) return true;
          const asString = JSON.stringify(parsed);
          if (lastSent !== null && lastSent === asString) return true;
          setPageRegistry(parsed);
          return true;
        };
      }
      const loaded = loadPages(st?.value, seed);
      pagesLoadKind = loaded.kind;
      if (loaded.registry) setPageRegistry(loaded.registry);
      // Persist only a seed this run created — a stored document is never
      // rewritten (C1: a failed read must not overwrite config).
      if (loaded.kind === "seeded") savePages();
      if (loaded.kind === "invalid") {
        console.error(
          "pageList is unreadable — leaving it untouched rather than overwriting it",
        );
      }
    })().catch((e) => {
      console.error("initPages:", e);
      initPromise = null;
    });
  }
  return initPromise;
}

// ---------------------------------------------------------------- view state
// The last opened page is *view* state: it belongs to this browser, never to the
// config document, so it lives in localStorage (one key) and is read once, at
// startup.

const VIEW_KEY = "iHome.view";

export const view = $state<{ lastPage: string }>({ lastPage: "" });

/** Read the persisted view state once, from the layout's onMount. */
export function loadViewState(): void {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<typeof view>;
    view.lastPage = parsed?.lastPage ?? "";
  } catch {
    // A corrupt blob must not break the display; defaults stay.
  }
}

function persistViewState(): void {
  try {
    localStorage.setItem(
      VIEW_KEY,
      JSON.stringify({
        lastPage: view.lastPage,
      }),
    );
  } catch {
    // Storage full/blocked: view state is a nicety, not a requirement.
  }
}

export function setLastPage(id: string): void {
  if (!id || view.lastPage === id) return;
  view.lastPage = id;
  persistViewState();
}
