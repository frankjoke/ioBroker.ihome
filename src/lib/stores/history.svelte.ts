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
 * The ioBroker bits this store needs. Passed in by the caller (the components
 * already import the shared socket module) so the store never imports it and
 * stays unit-testable. Deliberately *not* a module global: a hot-reloaded
 * duplicate of this module would otherwise hold a null client.
 */
export interface HistoryClient {
  connected: boolean | number;
  getHistory(
    stateId: string,
    options: Record<string, unknown>,
  ): Promise<unknown>;
}

const cache = new SvelteMap<string, HistoryEntry>();

async function load(
  client: HistoryClient,
  key: string,
  stateId: string,
  spec: HistorySpec,
): Promise<void> {
  try {
    const res = await client.getHistory(stateId, buildHistoryOptions(spec));
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
export function ensureHistory(
  client: HistoryClient,
  stateId: string,
  spec: HistorySpec,
): void {
  if (!client?.connected) return;
  const key = historyKey(stateId, spec);
  if (cache.has(key)) return;
  cache.set(key, { status: "loading", series: [], fetchedAt: 0 });
  void load(client, key, stateId, spec);
}

/** Re-fetch the whole range for a state + spec. */
export function refreshHistory(
  client: HistoryClient,
  stateId: string,
  spec: HistorySpec,
): void {
  if (!client?.connected) return;
  const key = historyKey(stateId, spec);
  cache.set(key, { status: "loading", series: [], fetchedAt: 0 });
  void load(client, key, stateId, spec);
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
