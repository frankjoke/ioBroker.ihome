<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    chartPoints,
    deleteAllPayload,
    deleteRangePayload,
    hasHistoryFeature,
    historyRows,
    isHistoryCustom,
  } from "$lib/config/state-settings";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import HistoryChart from "./HistoryChart.svelte";
  import HistoryResample from "./HistoryResample.svelte";
  import { writeStateCustom } from "$lib/config/state-write";
  import { csvText } from "$lib/config/history-resample";
  import { downloadText } from "$lib/utils/download";
  import { formatValue, localizeName } from "$lib/config/format";
  import { debounce } from "$lib/utils/debounce";

  let {
    stateId,
    customKeys,
    object,
    defaultAdapter,
    openAdapter = $bindable(""),
  }: {
    stateId: string;
    customKeys: string[];
    object: any;
    defaultAdapter: string;
    /** The open adapter; owned by the parent so it survives tab switches. */
    openAdapter?: string;
  } = $props();

  const DURATIONS = [
    { value: "1", label: "1 hour" },
    { value: "6", label: "6 hours" },
    { value: "24", label: "24 hours" },
    { value: "168", label: "7 days" },
  ];
  const FORMAT_TABS = [
    {
      id: "graphic" as const,
      label: "Graphic",
      hint: "History as a chart.",
    },
    {
      id: "table" as const,
      label: "Table",
      hint: "History as time and value rows.",
    },
  ];
  const RAW_LIMIT = 100000;

  let draftEnabled = $state<boolean | null>(null);
  let draftAlias = $state<string | null>(null);
  let saving = $state(false);
  let duration = $state("24");
  let mode = $state<"graphic" | "table">("graphic");
  let newestFirst = $state(false);
  let featuresReply = $state<unknown>(null);
  let rows = $state<Array<{ ts: number; val: unknown }>>([]);
  let points = $state<Array<{ ts: number; val: number }>>([]);
  let loading = $state(false);
  let error = $state("");
  let message = $state("");
  let pending = $state<{ kind: "range" | "all" } | null>(null);
  let rangeStart = $state("");
  let rangeEnd = $state("");
  let rangeTouched = $state(false);
  let rangeCount = $state(0);
  let rangeCounting = $state(false);
  let rangeError = $state("");
  let countSeq = 0;

  const rangeBounds = $derived.by(() => {
    const start = new Date(rangeStart).getTime();
    const end = new Date(rangeEnd).getTime();
    return {
      start,
      end,
      valid: Number.isFinite(start) && Number.isFinite(end) && start < end,
    };
  });
  const tableRows = $derived(newestFirst ? [...rows].reverse() : rows);

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
    rangeTouched = false;
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

  function aliasOf(key: string): string {
    const value = customValue(key)?.aliasId;
    return typeof value === "string" ? value : "";
  }

  const aliasOptions = $derived.by(() => {
    const options: Array<{ id: string; name: string }> = [];
    for (const [id, entry] of ioBroker.objects as Map<string, any>) {
      if (id === stateId || entry?.type !== "state") continue;
      const custom = entry?.common?.custom;
      if (!custom || typeof custom !== "object") continue;
      const hasHistory = Object.entries(custom).some(
        ([key, value]) => key !== "ihome" && isHistoryCustom(value),
      );
      if (!hasHistory) continue;
      options.push({ id, name: localizeName(entry.common?.name) });
    }
    options.sort((left, right) => left.id.localeCompare(right.id));
    const current = openAdapter ? aliasOf(openAdapter) : "";
    if (current && !options.some((option) => option.id === current)) {
      options.unshift({ id: current, name: "(removed)" });
    }
    return options;
  });

  const configDirty = $derived(
    openAdapter !== "" &&
      ((draftEnabled !== null && draftEnabled !== enabledOf(openAdapter)) ||
        (draftAlias !== null && draftAlias !== aliasOf(openAdapter))),
  );

  async function saveConfig(): Promise<void> {
    const key = openAdapter;
    if (!key) return;
    const enabled = draftEnabled ?? enabledOf(key);
    const alias = (draftAlias ?? aliasOf(key)).trim();
    const value = customValue(key);
    if (!value) return;
    saving = true;
    error = "";
    message = "";
    const custom = {
      ...((object?.common?.custom ?? {}) as Record<string, unknown>),
      [key]: { ...value, enabled, aliasId: alias },
    };
    try {
      await writeStateCustom(stateId, custom);
      draftEnabled = enabled;
      draftAlias = alias;
      message = alias
        ? `${key}: history alias ${alias}.`
        : `${key} ${enabled ? "enabled" : "disabled"}.`;
      await chooseAdapter();
      await countRange();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      saving = false;
    }
  }

  function downloadRows(): void {
    if (!rows.length) return;
    const safe = stateId.replace(/[^A-Za-z0-9._-]+/g, "-");
    downloadText(
      `${safe}-history-${duration}h.csv`,
      csvText(rows),
      "text/csv;charset=utf-8",
    );
  }

  function toggle(key: string): void {
    openAdapter = openAdapter === key ? "" : key;
    draftEnabled = openAdapter ? enabledOf(openAdapter) : null;
    draftAlias = openAdapter ? aliasOf(openAdapter) : null;
    error = "";
    message = "";
    featuresReply = null;
    points = [];
    rows = [];
    resetRange();
  }

  function onHistoryLineClick(event: MouseEvent, key: string): void {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    toggle(key);
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
          // The adapter defaults to "average"; the table needs every raw row.
          aggregate: "none",
          limit: RAW_LIMIT,
          ignoreNull: true,
        },
      });
      const errorText = replyError(reply);
      if (errorText) throw new Error(errorText);
      rows = historyRows(reply);
      points = chartPoints(reply);
    } catch (failure) {
      points = [];
      rows = [];
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

  async function countRange(): Promise<void> {
    if (!adapter || !rangeBounds.valid) {
      rangeCount = 0;
      rangeError = "";
      rangeCounting = false;
      return;
    }
    const seq = ++countSeq;
    rangeCounting = true;
    try {
      const reply = await ioBroker.sendTo(adapter, "getHistory", {
        id: stateId,
        options: {
          start: rangeBounds.start,
          end: rangeBounds.end,
          aggregate: "none",
          limit: RAW_LIMIT,
          ignoreNull: true,
        },
      });
      if (seq !== countSeq) return;
      const errorText = replyError(reply);
      if (errorText) throw new Error(errorText);
      rangeCount = historyRows(reply).length;
      rangeError = "";
    } catch (failure) {
      if (seq !== countSeq) return;
      rangeCount = 0;
      rangeError = `Count from ${adapter}: ${
        failure instanceof Error ? failure.message : String(failure)
      }`;
    } finally {
      if (seq === countSeq) rangeCounting = false;
    }
  }
  const scheduleCount = debounce(() => void countRange(), 300);

  async function deleteRange(): Promise<void> {
    if (!rangeBounds.valid) {
      error = "The range needs a start before the end.";
      pending = null;
      return;
    }
    pending = null;
    await remove(
      "deleteRange",
      deleteRangePayload(stateId, rangeBounds.start, rangeBounds.end),
    );
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
      await countRange();
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
    if (openAdapter && !customKeys.includes(openAdapter)) {
      openAdapter = "";
      draftEnabled = null;
    }
  });

  $effect(() => {
    rangeStart;
    rangeEnd;
    adapter;
    scheduleCount();
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
        {@const open = openAdapter === key}
        {@const enabled =
          open && draftEnabled !== null ? draftEnabled : enabledOf(key)}
        <div class="item" class:open>
          <!-- The free line area is a mouse convenience; the name button is the keyboard control. -->
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="item-line"
            onclick={(event) => onHistoryLineClick(event, key)}
          >
            <button
              type="button"
              class="name"
              aria-expanded={open}
              onclick={() => toggle(key)}>{key}</button
            >
            {#if key === defaultAdapter}
              <span class="badge badge-secondary">default</span>
            {/if}
            <span class="item-actions">
              <label
                class="enabled"
                title={open
                  ? "Toggles the enabled flag; Save applies it"
                  : "Fold out to change"}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={!open || saving}
                  onchange={(event) =>
                    (draftEnabled = event.currentTarget.checked)}
                />
                <span>Enabled</span>
              </label>
              {#if open}
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={!configDirty || saving}
                  onclick={() => void saveConfig()}
                  >{saving ? "Saving…" : "Save"}</button
                >
              {/if}
            </span>
          </div>
          {#if open}
            <div class="item-editor">
              <div class="row wrap">
                <label class="small grow">
                  <span class="label-mono">History alias</span>
                  <select
                    value={draftAlias ?? aliasOf(key)}
                    disabled={saving}
                    onchange={(event) =>
                      (draftAlias = event.currentTarget.value)}
                  >
                    <option value="">No alias (own id)</option>
                    {#each aliasOptions as option (option.id)}
                      <option value={option.id}
                        >{option.id}{option.name
                          ? ` · ${option.name}`
                          : ""}</option
                      >
                    {/each}
                  </select>
                </label>
              </div>
              <p class="hint text-muted">
                Reads and writes this state's history under the selected state
                id. The old entries stay there after the alias state is removed.
              </p>
              {#if !featuresReply}
                <p class="hint text-muted">
                  {adapter} does not report history features.
                </p>
              {:else if hasHistoryFeature(featuresReply, "getHistory")}
                <OptionTabs
                  bind:value={mode}
                  label="History format"
                  tabs={FORMAT_TABS}
                  collapsible={false}
                >
                  {#snippet trailing()}
                    {#if mode === "table"}
                      <label class="sort">
                        <input type="checkbox" bind:checked={newestFirst} />
                        <span>Newest first</span>
                      </label>
                    {/if}
                  {/snippet}
                  {#snippet actions()}
                    <label class="range">
                      <span class="label-mono">Display range</span>
                      <select
                        bind:value={duration}
                        onchange={() => void loadChart()}
                      >
                        {#each DURATIONS as option (option.value)}
                          <option value={option.value}>{option.label}</option>
                        {/each}
                      </select>
                    </label>
                    <button
                      type="button"
                      class="btn btn-sm"
                      disabled={!rows.length}
                      title="Download the displayed rows as CSV"
                      onclick={downloadRows}>CSV</button
                    >
                  {/snippet}
                  {#snippet children(active)}
                    {#if loading}
                      <p class="hint text-muted">Loading…</p>
                    {:else if active === "graphic"}
                      <HistoryChart {points} />
                    {:else if rows.length === 0}
                      <p class="hint text-muted">No data in this range.</p>
                    {:else}
                      <div class="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Time</th>
                              <th>Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            {#each tableRows as row, index (index)}
                              <tr>
                                <td class="mono"
                                  >{new Date(row.ts).toLocaleString()}</td
                                >
                                <td class="mono">
                                  {formatValue(
                                    row.val,
                                    object?.common?.unit,
                                    object?.common?.role,
                                  )}
                                </td>
                              </tr>
                            {/each}
                          </tbody>
                        </table>
                      </div>
                    {/if}
                  {/snippet}
                </OptionTabs>
              {:else}
                <p class="hint text-muted">
                  {adapter} does not support getHistory.
                </p>
              {/if}

              <div class="row wrap">
                <label class="small">
                  <span class="label-mono">From</span>
                  <input
                    type="datetime-local"
                    bind:value={rangeStart}
                    oninput={() => (rangeTouched = true)}
                  />
                </label>
                <label class="small">
                  <span class="label-mono">To</span>
                  <input
                    type="datetime-local"
                    bind:value={rangeEnd}
                    oninput={() => (rangeTouched = true)}
                  />
                </label>
                {#if hasHistoryFeature(featuresReply, "deleteRange")}
                  <button
                    type="button"
                    class="btn btn-sm btn-danger"
                    disabled={loading ||
                      rangeCounting ||
                      !rangeTouched ||
                      !rangeBounds.valid ||
                      rangeCount === 0}
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

              <p class="hint text-muted">
                {#if rangeCounting}
                  Counting…
                {:else if !rangeBounds.valid}
                  Set a valid delete range.
                {:else if rangeCount === 0}
                  No entries in the selected range.
                {:else}
                  {rangeCount}{rangeCount >= RAW_LIMIT ? "+" : ""} entries in the
                  selected range
                {/if}
                {#if message}
                  · {message}{/if}
              </p>
              {#if rangeError}<p class="hint text-danger">{rangeError}</p>{/if}
              {#if error}<p class="hint text-danger">{error}</p>{/if}
              <HistoryResample
                {adapter}
                {stateId}
                {object}
                config={customValue(key) ?? {}}
                {featuresReply}
                rangeStart={rangeBounds.start}
                rangeEnd={rangeBounds.end}
                rangeValid={rangeBounds.valid}
                onDone={async () => {
                  await chooseAdapter();
                  await countRange();
                }}
              />
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
    {#if pending.kind === "all"}
      <p class="text-muted">
        All stored data for <span class="mono">{adapter}</span> ·
        <span class="mono">{stateId}</span> will be deleted. This cannot be undone.
      </p>
    {:else}
      <p class="text-muted">
        {rangeCount}{rangeCount >= RAW_LIMIT ? "+" : ""}
        {rangeCount === 1 ? "datapoint" : "datapoints"} from
        <span class="mono">{new Date(rangeStart).toLocaleString()}</span> to
        <span class="mono">{new Date(rangeEnd).toLocaleString()}</span> on
        <span class="mono">{adapter}</span> ·
        <span class="mono">{stateId}</span> will be deleted. This cannot be undone.
      </p>
    {/if}
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

  .range {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--body-sm);
  }

  .sort {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: var(--body-sm);
    white-space: nowrap;
  }

  .table-wrap {
    max-height: 16rem;
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--body-sm);
  }

  th,
  td {
    padding: 0.25rem 0.5rem;
    text-align: left;
    border-bottom: 1px solid var(--border-color);
    white-space: nowrap;
  }

  thead th {
    position: sticky;
    top: 0;
    background: var(--surface-color);
  }

  td:last-child,
  th:last-child {
    text-align: right;
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

  .small input {
    min-width: 0;
  }
</style>
