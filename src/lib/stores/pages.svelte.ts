// Persists the display page list to its own ioBroker state, following the
// registry pattern: create the state if missing, load it once on connect, keep
// it in sync via onUpdate (with echo suppression), debounce writes back.
//
// The ioBroker client is imported directly (never injected through a module
// global): Vite HMR can hand this module two instances, and a module-global
// client then desyncs them — see the 2026-10-13 handoff.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { loadPages, parsePageRegistry } from "$lib/config/pages-ops";

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
    lastSent = snapshot;
    ioBroker
      .setState(PAGE_LIST_ID, snapshot)
      .catch((e) => console.error("save pages:", e));
  }, 250);
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
// Chips, group collapse flags and the last opened page are *view* state: they
// belong to this browser, never to the config document, so they live in
// localStorage (one key) and are read once, at startup.
import type { FilterChips } from "$lib/config/pages-ops";

const VIEW_KEY = "iHome.view";

export const view = $state<{
  chips: FilterChips;
  collapsed: Record<string, boolean>;
  lastPage: string;
}>({ chips: {}, collapsed: {}, lastPage: "" });

/** Read the persisted view state once, from the layout's onMount. */
export function loadViewState(): void {
  try {
    const raw = localStorage.getItem(VIEW_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<typeof view>;
    view.chips = parsed?.chips ?? {};
    view.collapsed = parsed?.collapsed ?? {};
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
        chips: view.chips,
        collapsed: view.collapsed,
        lastPage: view.lastPage,
      }),
    );
  } catch {
    // Storage full/blocked: view state is a nicety, not a requirement.
  }
}

export function setChips(next: FilterChips): void {
  view.chips = next;
  persistViewState();
}

/** Collapse keys are `pageId + groupId`, so the same group on another page is separate. */
export function collapseKey(pageId: string, groupId: string): string {
  return `${pageId}::${groupId}`;
}

export function isCollapsed(pageId: string, groupId: string): boolean {
  return view.collapsed[collapseKey(pageId, groupId)] === true;
}

export function toggleCollapsed(pageId: string, groupId: string): void {
  const key = collapseKey(pageId, groupId);
  view.collapsed = { ...view.collapsed, [key]: !view.collapsed[key] };
  persistViewState();
}

export function setLastPage(id: string): void {
  if (!id || view.lastPage === id) return;
  view.lastPage = id;
  persistViewState();
}
