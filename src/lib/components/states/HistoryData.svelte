<script lang="ts">
  import { untrack } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { toSeries } from "$lib/config/history-ops";
  import {
    deleteAllPayload,
    deleteRangePayload,
    hasHistoryFeature,
  } from "$lib/config/state-settings";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import HistoryChart from "./HistoryChart.svelte";

  let {
    stateId,
    customKeys,
  }: {
    stateId: string;
    customKeys: string[];
  } = $props();

  const DURATIONS = [
    { value: "1", label: "1 hour" },
    { value: "6", label: "6 hours" },
    { value: "24", label: "24 hours" },
    { value: "168", label: "7 days" },
  ];

  let adapter = $state(untrack(() => customKeys[0] ?? ""));
  let duration = $state("24");
  let features = $state<string[]>([]);
  let points = $state<Array<{ ts: number; val: number }>>([]);
  let loading = $state(false);
  let error = $state("");
  let message = $state("");
  let pending = $state<{ kind: "range" | "all" } | null>(null);
  let rangeStart = $state("");
  let rangeEnd = $state("");

  function localInput(time: number): string {
    const date = new Date(time);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  function resetRange(): void {
    const end = Date.now();
    rangeStart = localInput(end - 24 * 3600_000);
    rangeEnd = localInput(end);
  }
  resetRange();

  function replyError(reply: unknown): string {
    if (reply && typeof reply === "object") {
      const value = reply as Record<string, unknown>;
      if (typeof value.error === "string" && value.error) return value.error;
      if (value.ok === false)
        return String(value.error ?? "The adapter rejected the request.");
    }
    return "";
  }

  async function probeFeatures(): Promise<void> {
    if (!adapter) {
      features = [];
      return;
    }
    try {
      const reply = await ioBroker.sendTo(adapter, "features", {});
      const errorText = replyError(reply);
      if (errorText) throw new Error(errorText);
      const value = reply as { supportedFeatures?: unknown };
      features = Array.isArray(value?.supportedFeatures)
        ? value.supportedFeatures.filter(
            (entry): entry is string => typeof entry === "string",
          )
        : [];
    } catch (failure) {
      features = [];
      error = `Features from ${adapter}: ${failure instanceof Error ? failure.message : String(failure)}`;
    }
  }

  async function loadChart(): Promise<void> {
    if (
      !adapter ||
      !hasHistoryFeature({ supportedFeatures: features }, "getHistory")
    ) {
      return;
    }
    loading = true;
    error = "";
    try {
      const end = Date.now();
      const start = end - Number(duration) * 3600_000;
      const reply = await ioBroker.sendTo(adapter, "getHistory", {
        id: stateId,
        options: {
          start,
          end,
          aggregate: "average",
          step: Math.max(60_000, (end - start) / 300),
        },
      });
      const errorText = replyError(reply);
      if (errorText) throw new Error(errorText);
      points = toSeries(reply);
    } catch (failure) {
      points = [];
      error = `History from ${adapter}: ${failure instanceof Error ? failure.message : String(failure)}`;
    } finally {
      loading = false;
    }
  }

  async function chooseAdapter(): Promise<void> {
    error = "";
    message = "";
    await probeFeatures();
    if (features.includes("getHistory")) await loadChart();
    else points = [];
  }

  async function deleteRange(): Promise<void> {
    const start = new Date(rangeStart).getTime();
    const end = new Date(rangeEnd).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
      error = "The range needs a start before the end.";
      pending = null;
      return;
    }
    pending = null;
    await remove("deleteRange", deleteRangePayload(stateId, start, end));
  }

  async function deleteAll(): Promise<void> {
    pending = null;
    await remove("deleteAll", deleteAllPayload(stateId));
  }

  async function remove(
    command: "deleteRange" | "deleteAll",
    payload: unknown,
  ): Promise<void> {
    loading = true;
    error = "";
    message = "";
    try {
      let reply = await ioBroker.sendTo(adapter, command, payload);
      let errorText = replyError(reply);
      if (errorText && command === "deleteRange" && Array.isArray(payload)) {
        reply = await ioBroker.sendTo(adapter, command, {
          id: stateId,
          start: (payload[0] as { start: number }).start,
          end: (payload[0] as { end: number }).end,
        });
        errorText = replyError(reply);
      }
      if (errorText) throw new Error(errorText);
      message =
        command === "deleteAll" ? "All stored data deleted." : "Range deleted.";
      await loadChart();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (customKeys.length && !customKeys.includes(adapter)) {
      adapter = customKeys[0];
    }
    void chooseAdapter();
  });
</script>

<div class="history">
  {#if customKeys.length === 0}
    <p class="hint text-muted">
      No custom settings on this state. Add a history adapter key in Custom
      first.
    </p>
  {:else}
    <div class="row">
      <label class="small">
        <span class="label-mono">Adapter</span>
        <select bind:value={adapter} onchange={() => void chooseAdapter()}>
          {#each customKeys as key (key)}
            <option value={key}>{key}</option>
          {/each}
        </select>
      </label>
      <label class="small">
        <span class="label-mono">Range</span>
        <select bind:value={duration} onchange={() => void loadChart()}>
          {#each DURATIONS as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>
    </div>

    {#if features.length === 0}
      <p class="hint text-muted">
        {adapter} does not report history features.
      </p>
    {:else if hasHistoryFeature({ supportedFeatures: features }, "getHistory")}
      {#if loading}
        <p class="hint text-muted">Loading…</p>
      {:else}
        <HistoryChart {points} />
      {/if}
    {:else}
      <p class="hint text-muted">
        {adapter} does not support getHistory.
      </p>
    {/if}

    <div class="row wrap">
      <label class="small">
        <span class="label-mono">From</span>
        <input type="datetime-local" bind:value={rangeStart} />
      </label>
      <label class="small">
        <span class="label-mono">To</span>
        <input type="datetime-local" bind:value={rangeEnd} />
      </label>
      {#if hasHistoryFeature({ supportedFeatures: features }, "deleteRange")}
        <button
          type="button"
          class="btn btn-sm"
          disabled={loading}
          onclick={() => (pending = { kind: "range" })}>Delete range</button
        >
      {/if}
      {#if hasHistoryFeature({ supportedFeatures: features }, "deleteAll")}
        <button
          type="button"
          class="btn btn-sm btn-danger"
          disabled={loading}
          onclick={() => (pending = { kind: "all" })}>Delete all</button
        >
      {/if}
    </div>

    {#if message}<p class="hint text-muted">{message}</p>{/if}
    {#if error}<p class="hint text-danger">{error}</p>{/if}
  {/if}
</div>

{#if pending}
  <ConfirmModal
    title={pending.kind === "all"
      ? "Delete all stored data?"
      : "Delete a data range?"}
    confirmLabel="Delete"
    onConfirm={() =>
      void (pending?.kind === "all" ? deleteAll() : deleteRange())}
    onCancel={() => (pending = null)}
  >
    <p class="text-muted">
      {adapter} · <span class="mono">{stateId}</span>. This cannot be undone.
    </p>
  </ConfirmModal>
{/if}

<style>
  .history {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
  }

  .row.wrap {
    flex-wrap: wrap;
  }

  .small {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: var(--body-sm);
  }

  .small select,
  .small input {
    min-width: 0;
  }
</style>
