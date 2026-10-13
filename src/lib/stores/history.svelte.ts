import { SvelteMap } from "svelte/reactivity";
import type { HistorySpec } from "$lib/types/device";
import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import {
  buildHistoryOptions,
  historyKey,
  toSeries,
  appendLive,
  type HistoryPoint,
} from "$lib/config/history-ops";

export interface HistoryEntry {
  status: "loading" | "ready" | "empty" | "error";
  series: HistoryPoint[];
  fetchedAt: number;
  error?: string;
}

const cache = new SvelteMap<string, HistoryEntry>();

async function load(
  key: string,
  stateId: string,
  spec: HistorySpec,
): Promise<void> {
  try {
    const res = await ioBroker.getHistory(stateId, buildHistoryOptions(spec));
    const series = toSeries(res);
    cache.set(key, {
      status: series.length ? "ready" : "empty",
      series,
      fetchedAt: Date.now(),
    });
  } catch (e) {
    cache.set(key, {
      status: "error",
      series: [],
      fetchedAt: Date.now(),
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** Fetch the series once for a state + spec; a no-op while disconnected. */
export function ensureHistory(stateId: string, spec: HistorySpec): void {
  if (!ioBroker.connected) return;
  const key = historyKey(stateId, spec);
  if (cache.has(key)) return;
  cache.set(key, { status: "loading", series: [], fetchedAt: 0 });
  void load(key, stateId, spec);
}

/** Re-fetch the whole range for a state + spec. */
export function refreshHistory(stateId: string, spec: HistorySpec): void {
  if (!ioBroker.connected) return;
  const key = historyKey(stateId, spec);
  cache.set(key, { status: "loading", series: [], fetchedAt: 0 });
  void load(key, stateId, spec);
}

/**
 * The cached entry, with the live state value appended when it is newer.
 * Pure — never mutates the cache (it runs during render).
 */
export function readHistory(
  stateId: string,
  spec: HistorySpec,
): HistoryEntry | undefined {
  const entry = cache.get(historyKey(stateId, spec));
  if (!entry || entry.status !== "ready") return entry;
  const st: any = ioBroker.states?.get(stateId);
  if (st && typeof st.ts === "number" && typeof st.val === "number") {
    const series = appendLive(
      entry.series,
      { ts: st.ts, val: st.val },
      spec,
      Date.now(),
    );
    return series === entry.series ? entry : { ...entry, series };
  }
  return entry;
}
