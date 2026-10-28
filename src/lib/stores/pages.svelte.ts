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
  migratePageIds,
  migratePageRegistry,
  parsePageRegistry,
  toFilterable,
  PAGE_REGISTRY_VERSION,
  type FilterableDevice,
  type LoadedPages,
} from "$lib/config/pages-ops";
import { migratePagesV2 } from "$lib/config/migrate-v2";

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
import {
  registerProgramStateId,
  getCanonicalRegistry,
} from "$lib/stores/devices.svelte";
import { stateIdFor } from "$lib/config/variables";
import { getVariableLibrary } from "$lib/stores/variables.svelte";
import { stateIdsInExpression } from "$lib/config/rule-ops";
import type { Device } from "$lib/types/device";
import type { PageRegistry, Template } from "$lib/types/display";

export const PAGE_LIST_ID = "ihome.0.config.pageList";
/** The one-time v1 document, kept before the first v2 write. */
export const PAGE_BACKUP_ID = "ihome.0.config.pageListV1";

const emptyRegistry: PageRegistry = { version: 0, updatedAt: 0, pages: [] };

let pageRegistry = $state<PageRegistry>(emptyRegistry);

export function getPageRegistry(): PageRegistry {
  return pageRegistry;
}

export function setPageRegistry(reg: PageRegistry): void {
  registerSlotStateIds(reg);
  pageRegistry = reg;
}

/**
 * Subscribe every raw state a tile names (A21): the tile editor lets a slot —
 * and a tile's active condition — point at any state id, not only a control of
 * the tile's own device. A feature name like "power" is not a state id, so only
 * ids that exist in the object tree are registered.
 */
function registerSlotStateIds(reg: PageRegistry): void {
  const variables = getVariableLibrary().variables ?? [];
  for (const page of reg.pages ?? []) {
    for (const group of page.groups ?? []) {
      for (const placement of group.tiles ?? []) {
        const sources = [
          ...(placement.tile?.slots ?? []).map((slot) => slot.source),
          placement.tile?.active?.source,
        ];
        for (const raw of sources) {
          if (typeof raw === "string") {
            // A feature name has no dot and is not a state; a state id does. Do
            // not require the object cache here — at page load it is often not
            // populated yet, and a skipped id would never be read at all (the
            // slot then shows "—" until some other use subscribes it).
            const id = stateIdFor(raw, variables);
            if (id.includes(".")) registerProgramStateId(id);
            continue;
          }
          if (!raw) continue;
          if (raw.kind === "state") {
            if (raw.stateId.includes(".")) registerProgramStateId(raw.stateId);
          } else if (raw.kind === "control") {
            const device = getCanonicalRegistry().devices.find(
              (d) => d.id === raw.device,
            );
            const stateId = device?.controls.find(
              (c) => c.id === raw.control,
            )?.stateId;
            const id = stateId ? stateIdFor(stateId, variables) : "";
            if (id.includes(".")) registerProgramStateId(id);
          }
        }
        // The tile's *own* slots carry rules of their own (the editor writes
        // them), and those rules' `get("…")` ids need the same treatment as
        // the device chain's.
        for (const slot of placement.tile?.slots ?? []) {
          for (const rule of slot.rules ?? []) {
            for (const id of stateIdsInExpression(rule?.when ?? "")) {
              registerProgramStateId(id);
            }
          }
        }
      }
    }
  }
}

let initPromise: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastSent: string | null = null;
/** The raw document read from the broker, kept for the one-time v1 backup. */
let rawPages: string | null = null;
let saveFailed = $state(false);
/** How the stored document last loaded — nothing may be written unless a read
 *  actually succeeded (`loaded`) or this run seeded it (`seeded`). */
let pagesLoadKind = $state<LoadedPages["kind"] | null>(null);
/** Generated page ids renamed on this load (old id → readable id): the display
 *  redirects an open old link once; other loads see only the new ids. */
let pageIdRenames: Record<string, string> = {};

/** The renames applied when the current document was loaded (usually none). */
export function renamedPageIds(): Record<string, string> {
  return pageIdRenames;
}

/** How the last document read went — `null` while nothing has been read yet.
 *  The display uses it to tell "still loading" from "really no pages". */
export function getPagesLoadKind(): LoadedPages["kind"] | null {
  return pagesLoadKind;
}

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
/** Write the pre-migration document once; a later migration never overwrites it. */
async function writeBackupOnce(raw: string): Promise<void> {
  try {
    const existing = await ioBroker.getState(PAGE_BACKUP_ID, true);
    if (
      existing &&
      existing.val !== undefined &&
      existing.val !== null &&
      existing.val !== ""
    ) {
      return;
    }
    const obj = await ioBroker.getObject(PAGE_BACKUP_ID);
    if (!obj) {
      await ioBroker.emitAsync("setObject", PAGE_BACKUP_ID, {
        type: "state",
        common: {
          name: "iHome display pages (v1 backup)",
          type: "json",
          role: "json",
          read: true,
          write: false,
        },
        native: {},
      });
    }
    await ioBroker.setState(PAGE_BACKUP_ID, raw);
  } catch (e) {
    console.error("backup pages v1:", e);
  }
}

/**
 * The one-time v1 → v2 conversion, after devices and templates are loaded. The
 * filter→placement bridge runs first for a very old document; the v1 document
 * is backed up once before the first v2 write.
 */
export async function migrateLayout(
  devices: Device[],
  templates: Template[],
): Promise<boolean> {
  const bridge = migratePageRegistry(
    getPageRegistry(),
    devices.map((d) => toFilterable(d)),
  );
  const { registry, changed } = migratePagesV2(
    bridge.registry,
    devices,
    templates,
    getVariableLibrary().variables ?? [],
  );
  const version = getPageRegistry().version ?? 0;
  if (!bridge.changed && !changed && version >= PAGE_REGISTRY_VERSION) {
    return false;
  }
  if (rawPages) await writeBackupOnce(rawPages);
  return commitLayout({ ...registry, version: PAGE_REGISTRY_VERSION });
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
      const st = await ioBroker.getState(PAGE_LIST_ID, true);
      rawPages =
        st?.val !== undefined && st?.val !== null && st?.val !== ""
          ? typeof st.val === "string"
            ? st.val
            : JSON.stringify(st.val)
          : null;
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
      if (loaded.registry) {
        const { registry, renames } = migratePageIds(loaded.registry);
        setPageRegistry(registry);
        if (Object.keys(renames).length) {
          pageIdRenames = renames;
          const last = renames[view.lastPage];
          if (last) setLastPage(last);
          // Loaded documents only: an in-memory seed is not written just
          // because a rename ran (and seeds carry readable ids anyway).
          if (loaded.kind === "loaded") commitLayout(registry);
        }
      }
      // A seed stays in memory until the user actually does something: writing
      // it here is what overwrote a document the adapter had not migrated yet
      // (an empty read means "nothing there yet", not "the user wants this").
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
