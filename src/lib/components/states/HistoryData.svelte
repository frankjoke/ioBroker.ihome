<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    chartPoints,
    deleteAllPayload,
    deleteRangePayload,
    hasHistoryFeature,
  } from "$lib/config/state-settings";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import HistoryChart from "./HistoryChart.svelte";

  let {
    stateId,
    customKeys,
    object,
    defaultAdapter,
  }: {
    stateId: string;
    customKeys: string[];
    object: any;
    defaultAdapter: string;
  } = $props();

  const DURATIONS = [
    { value: "1", label: "1 hour" },
    { value: "6", label: "6 hours" },
    { value: "24", label: "24 hours" },
    { value: "168", label: "7 days" },
  ];

  let openAdapter = $state("");
  let duration = $state("24");
  let featuresReply = $state<unknown>(null);
  let points = $state<Array<{ ts: number; val: number }>>([]);
  let loading = $state(false);
  let error = $state("");
  let message = $state("");
  let pending = $state<{ kind: "range" | "all" } | null>(null);
  let rangeStart = $state("");
  let rangeEnd = $state("");

  const adapter = $derived(openAdapter);

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

  function customValue(key: string): Record<string, unknown> | undefined {
    const custom = object?.common?.custom;
    const value =
      custom && typeof custom === "object" ? custom[key] : undefined;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  }

  function enabledOf(key: string): boolean {
    return customValue(key)?.enabled !== false;
  }

  async function setEnabled(key: string, enabled: boolean): Promise<void> {
    const value = customValue(key);
    if (!value) return;
    const custom = {
      ...((object?.common?.custom ?? {}) as Record<string, unknown>),
      [key]: { ...value, enabled },
    };
    try {
      const reply = (await ioBroker.sendTo(ioBroker.namespace, "states", {
        action: "custom.write",
        id: stateId,
        custom,
      })) as { ok?: boolean; error?: string } | undefined;
      if (!reply?.ok) {
        throw new Error(reply?.error ?? "The adapter rejected the change.");
      }
      message = `${key} ${enabled ? "enabled" : "disabled"}.`;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    }
  }

  function toggle(key: string): void {
    openAdapter = openAdapter === key ? "" : key;
    error = "";
    message = "";
    featuresReply = null;
    points = [];
    resetRange();
  }

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
      featuresReply = null;
      return;
    }
    try {
      const reply = await ioBroker.sendTo(adapter, "features", {});
      const errorText = replyError(reply);
      if (errorText) throw new Error(errorText);
      featuresReply = reply;
    } catch (failure) {
      featuresReply = null;
      error = `Features from ${adapter}: ${failure instanceof Error ? failure.message : String(failure)}`;
    }
  }

  async function loadChart(): Promise<void> {
    if (!adapter || !hasHistoryFeature(featuresReply, "getHistory")) {
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
      points = chartPoints(reply);
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
    if (hasHistoryFeature(featuresReply, "getHistory")) await loadChart();
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
    if (!openAdapter) return;
    void chooseAdapter();
  });

  $effect(() => {
    if (openAdapter && !customKeys.includes(openAdapter)) openAdapter = "";
  });
</script>

<div class="history">
  {#if customKeys.length === 0}
    <p class="hint text-muted">
      No history adapter is configured for this state. Use + History on the tab
      line first.
    </p>
  {:else}
    <div class="items">
      {#each customKeys as key (key)}
        {@const enabled = enabledOf(key)}
        <div class="item" class:open={openAdapter === key}>
          <div class="item-line">
            <button
              type="button"
              class="name"
              aria-expanded={openAdapter === key}
              onclick={() => toggle(key)}>{key}</button
            >
            <span class="badge" class:badge-secondary={!enabled}
              >{enabled ? "enabled" : "disabled"}</span
            >
            {#if key === defaultAdapter}
              <span class="badge badge-secondary">default</span>
            {/if}
          </div>
          {#if openAdapter === key}
            <div class="item-editor">
              <label class="enabled">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={loading}
                  onchange={(event) =>
                    void setEnabled(key, event.currentTarget.checked)}
                />
                <span>Enabled</span>
              </label>

              <div class="row">
                <label class="small">
                  <span class="label-mono">Range</span>
                  <select
                    bind:value={duration}
                    onchange={() => void loadChart()}
                  >
                    {#each DURATIONS as option (option.value)}
                      <option value={option.value}>{option.label}</option>
                    {/each}
                  </select>
                </label>
              </div>

              {#if !featuresReply}
                <p class="hint text-muted">
                  {adapter} does not report history features.
                </p>
              {:else if hasHistoryFeature(featuresReply, "getHistory")}
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
                {#if hasHistoryFeature(featuresReply, "deleteRange")}
                  <button
                    type="button"
                    class="btn btn-sm"
                    disabled={loading}
                    onclick={() => (pending = { kind: "range" })}
                    >Delete range</button
                  >
                {/if}
                {#if hasHistoryFeature(featuresReply, "deleteAll")}
                  <button
                    type="button"
                    class="btn btn-sm btn-danger"
                    disabled={loading}
                    onclick={() => (pending = { kind: "all" })}
                    >Delete all</button
                  >
                {/if}
              </div>

              {#if message}<p class="hint text-muted">{message}</p>{/if}
              {#if error}<p class="hint text-danger">{error}</p>{/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
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

  .items {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }

  .enabled {
    display: flex;
    align-items: center;
    gap: 0.35rem;
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
