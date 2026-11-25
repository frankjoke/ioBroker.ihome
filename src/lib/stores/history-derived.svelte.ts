import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { configId } from "$lib/config/config-id";
import {
  parseDerivedDocument,
  type DerivedDocument,
  type DerivedEntry,
} from "$adapter/history-derived-common";
import { registerProgramStateId } from "$lib/stores/program-states.svelte";

export const historyListId = () => configId("historyList", ioBroker.namespace);

let document = $state<DerivedDocument>({ version: 1, entries: [] });
let loaded = $state(false);
let saveFailed = $state(false);
let initPromise: Promise<void> | null = null;
let lastSent: string | null = null;

export function getHistoryDerived(): DerivedDocument {
  return document;
}

export function isHistoryDerivedLoaded(): boolean {
  return loaded;
}

export function historyDerivedSaveFailed(): boolean {
  return saveFailed;
}

async function ensureHistoryObject(): Promise<void> {
  const id = historyListId();
  const object = await ioBroker.getObject(id);
  if (!object) {
    await ioBroker.emitAsync("setObject", id, {
      type: "state",
      common: {
        name: "iHome derived history",
        type: "string",
        role: "text.json",
        read: true,
        write: true,
      },
      native: {},
    });
  }
}

/** Load the document once the socket is up; a broken one stays read-only. */
export function initHistoryDerived(): Promise<void> {
  registerProgramStateId(historyListId());
  if (!initPromise) {
    initPromise = (async () => {
      const until = Date.now() + 10_000;
      while (!ioBroker.connected && Date.now() < until) {
        await ioBroker.wait(200);
      }
      if (!ioBroker.connected) {
        initPromise = null;
        return;
      }
      await ensureHistoryObject().catch(() => undefined);
      const state = await ioBroker.getState(historyListId(), true);
      const raw = state?.val;
      if (raw == null || String(raw).trim() === "") {
        const empty: DerivedDocument = { version: 1, entries: [] };
        document = empty;
        lastSent = JSON.stringify(empty);
        loaded = true;
        saveFailed = false;
        return;
      }
      const parsed = parseDerivedDocument(raw);
      if (!parsed) {
        saveFailed = true;
        loaded = false;
        console.error(
          "historyList is unreadable; derived history is read-only",
        );
        initPromise = null;
        return;
      }
      document = parsed;
      lastSent = JSON.stringify(parsed);
      loaded = true;
      saveFailed = false;
    })().catch((error) => {
      console.error("initHistoryDerived:", error);
      initPromise = null;
    });
  }
  return initPromise;
}

/** Replace the whole document. The adapter reloads on the state change. */
export async function saveHistoryDerived(
  entries: DerivedEntry[],
): Promise<boolean> {
  if (!loaded) {
    saveFailed = true;
    return false;
  }
  const next: DerivedDocument = { version: 1, entries };
  const text = JSON.stringify(next);
  lastSent = text;
  document = next;
  try {
    await ioBroker.setState(historyListId(), text);
    saveFailed = false;
    return true;
  } catch (error) {
    saveFailed = true;
    console.error("save derived history:", error);
    return false;
  }
}

/** True when the last write was our own echo (used by a future live reload). */
export function isHistoryDerivedEcho(value: unknown): boolean {
  return typeof value === "string" && value === lastSent;
}
