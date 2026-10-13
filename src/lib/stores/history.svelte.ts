import { SvelteMap } from "svelte/reactivity";
import { untrack } from "svelte";
import type { HistorySpec } from "$lib/types/device";
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

/**
 * The ioBroker bits this store needs, injected by the layout so the store
 * never imports the socket module (same no-cycle pattern as the device store)
 * and stays unit-testable.
 */
export interface HistoryClient {
  connected: boolean | number;
  getHistory(
    stateId: string,
    options: Record<string, unknown>,
  ): Promise<unknown>;
}

let client: HistoryClient | null = null;
export function setHistoryClient(c: HistoryClient | null): void {
  client = c;
}

const cache = new SvelteMap<string, HistoryEntry>();

async function load(
  key: string,
  stateId: string,
  spec: HistorySpec,
): Promise<void> {
  try {
    const res = await client!.getHistory(stateId, buildHistoryOptions(spec));
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
  if (!client?.connected) return;
  const key = historyKey(stateId, spec);
  if (cache.has(key)) return;
  cache.set(key, { status: "loading", series: [], fetchedAt: 0 });
  void load(key, stateId, spec);
}

/** Re-fetch the whole range for a state + spec. */
export function refreshHistory(stateId: string, spec: HistorySpec): void {
  if (!client?.connected) return;
  const key = historyKey(stateId, spec);
  cache.set(key, { status: "loading", series: [], fetchedAt: 0 });
  void load(key, stateId, spec);
}

/**
 * The cached entry. Pure — the live tail is fed in by `noteLive`, so reading
 * during render never mutates state.
 */
export function readHistory(
  stateId: string,
  spec: HistorySpec,
): HistoryEntry | undefined {
  return cache.get(historyKey(stateId, spec));
}

/**
 * Persist a live sample onto a loaded series when it is strictly newer,
 * trimming the window. Callers feed this from their own effect.
 */
export function noteLive(
  stateId: string,
  spec: HistorySpec,
  point: HistoryPoint,
): void {
  untrack(() => {
    const key = historyKey(stateId, spec);
    const entry = cache.get(key);
    if (!entry || entry.status !== "ready") return;
    const series = appendLive(entry.series, point, spec, Date.now());
    if (series === entry.series) return;
    cache.set(key, { ...entry, series });
  });
}
