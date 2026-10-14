// Persists the display page list to its own ioBroker state, following the
// registry pattern: create the state if missing, load it once on connect, keep
// it in sync via onUpdate (with echo suppression), debounce writes back.
//
// The ioBroker client is imported directly (never injected through a module
// global): Vite HMR can hand this module two instances, and a module-global
// client then desyncs them — see the 2026-10-13 handoff.
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { loadPages, parsePageRegistry } from "$lib/config/pages-ops";
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
      const resolved = loadPages(st?.value, seed);
      if (resolved?.pages?.length) {
        setPageRegistry(resolved);
        if (resolved.seeded) savePages();
      }
    })().catch((e) => {
      console.error("initPages:", e);
      initPromise = null;
    });
  }
  return initPromise;
}
