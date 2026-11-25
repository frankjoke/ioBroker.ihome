<script lang="ts">
  import { untrack } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import {
    deleteRangePayload,
    hasHistoryFeature,
    historyRows,
    type HistoryRow,
  } from "$lib/config/state-settings";
  import { newId } from "$lib/utils/ids";

  let {
    adapter,
    stateId,
    featuresReply,
    adapters,
    rangeStart,
    rangeEnd,
    rangeValid,
    onDone,
  }: {
    adapter: string;
    stateId: string;
    featuresReply: unknown;
    adapters: string[];
    rangeStart: number;
    rangeEnd: number;
    rangeValid: boolean;
    onDone?: () => void | Promise<void>;
  } = $props();

  const RAW_LIMIT = 100_000;
  const BATCH = 5000;
  const listId = `history-transfer-${newId()}`;

  type Mode = "copy" | "move" | "replace";
  type Job = {
    rows: HistoryRow[];
    start: number;
    end: number;
    destinationAdapter: string;
    destinationState: string;
    mode: Mode;
    samePlace: boolean;
  };

  let destinationAdapter = $state(untrack(() => adapter));
  let destinationState = $state(untrack(() => stateId));
  let mode = $state<Mode>("copy");
  let busy = $state(false);
  let error = $state("");
  let message = $state("");
  let confirm = $state<Job | null>(null);
  let destinationFeatures = $state<unknown>(null);
  let probing = $state(false);

  const adapterOptions = $derived(
    [...new Set([adapter, ...adapters].filter(Boolean))].sort(),
  );
  const destinationId = $derived(destinationState.trim());
  const samePlace = $derived(
    destinationAdapter === adapter && destinationId === stateId,
  );
  const destinationExists = $derived(
    destinationId === stateId ||
      (ioBroker.objects as Map<string, any>)?.has?.(destinationId),
  );
  const destinationConfigured = $derived(
    (ioBroker.objects as Map<string, any>)?.get?.(destinationId)?.common
      ?.custom?.[destinationAdapter] !== undefined,
  );
  const stateOptions = $derived.by(() => {
    const out: string[] = [];
    for (const [id, entry] of ioBroker.objects as Map<string, any>) {
      if (entry?.type !== "state") continue;
      if (
        id === stateId ||
        entry?.common?.custom?.[destinationAdapter] !== undefined
      ) {
        out.push(id);
      }
    }
    return out.sort();
  });
  const sourceCanMove = $derived(
    hasHistoryFeature(featuresReply, "deleteRange"),
  );
  const destinationCanWrite = $derived(
    hasHistoryFeature(destinationFeatures, "storeState"),
  );
  const destinationCanDelete = $derived(
    hasHistoryFeature(destinationFeatures, "deleteRange"),
  );
  const supported = $derived(
    adapter !== "" &&
      destinationAdapter !== "" &&
      hasHistoryFeature(featuresReply, "getHistory") &&
      destinationCanWrite &&
      (mode === "copy" || destinationCanDelete) &&
      (mode !== "move" || samePlace || sourceCanMove),
  );
  const canRun = $derived(
    supported &&
      destinationExists &&
      destinationId !== "" &&
      rangeValid &&
      rangeEnd > rangeStart &&
      !busy &&
      !probing &&
      !(samePlace && mode === "copy"),
  );

  async function probeFeatures(): Promise<void> {
    destinationFeatures = null;
    if (!destinationAdapter) return;
    probing = true;
    try {
      const reply = await withTimeout(
        ioBroker.sendTo(destinationAdapter, "features", {}) as Promise<unknown>,
        5000,
        "features",
      );
      const problem = replyError(reply);
      if (problem) throw new Error(problem);
      destinationFeatures = reply;
    } catch {
      destinationFeatures = null;
    } finally {
      probing = false;
    }
  }

  $effect(() => {
    destinationAdapter;
    void probeFeatures();
  });

  function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${ms / 1000}s`)),
        ms,
      );
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (failure) => {
          clearTimeout(timer);
          reject(failure);
        },
      );
    });
  }

  function replyError(reply: unknown): string {
    if (!reply || typeof reply !== "object") return "";
    const value = reply as Record<string, unknown>;
    if (typeof value.error === "string" && value.error) return value.error;
    if (value.success === false) {
      return typeof value.message === "string"
        ? value.message
        : "The adapter rejected the request.";
    }
    return "";
  }

  function sameValue(actual: unknown, expected: unknown): boolean {
    if (typeof actual === "number" && typeof expected === "number") {
      // sql.0 rounds stored numbers to its instance precision (default 4 decimals).
      return (
        Math.abs(actual - expected) <= Math.max(1e-4, Math.abs(expected) * 1e-4)
      );
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
  }

  function timeText(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  async function readRange(
    onAdapter: string,
    id: string,
    start: number,
    end: number,
  ): Promise<HistoryRow[]> {
    const reply = await withTimeout(
      ioBroker.sendTo(onAdapter, "getHistory", {
        id,
        options: {
          start,
          end,
          aggregate: "none",
          limit: RAW_LIMIT,
          ignoreNull: true,
        },
      }) as Promise<unknown>,
      30_000,
      "getHistory",
    );
    const problem = replyError(reply);
    if (problem) throw new Error(`getHistory ${id}: ${problem}`);
    return historyRows(reply);
  }

  async function deleteRange(
    onAdapter: string,
    id: string,
    start: number,
    end: number,
  ): Promise<void> {
    let reply = await withTimeout(
      ioBroker.sendTo(
        onAdapter,
        "deleteRange",
        deleteRangePayload(id, start, end),
      ) as Promise<unknown>,
      30_000,
      "deleteRange",
    );
    let problem = replyError(reply);
    if (problem) {
      reply = await withTimeout(
        ioBroker.sendTo(onAdapter, "deleteRange", {
          id,
          start,
          end,
        }) as Promise<unknown>,
        30_000,
        "deleteRange",
      );
      problem = replyError(reply);
    }
    if (problem) throw new Error(`deleteRange ${id}: ${problem}`);
  }

  async function storeRows(
    onAdapter: string,
    id: string,
    rows: HistoryRow[],
  ): Promise<void> {
    for (let index = 0; index < rows.length; index += BATCH) {
      const reply = await withTimeout(
        ioBroker.sendTo(onAdapter, "storeState", {
          id,
          state: rows.slice(index, index + BATCH).map((row) => ({
            ts: row.ts,
            val: row.val,
            ack: true,
            from: ioBroker.namespace,
          })),
        }) as Promise<unknown>,
        30_000,
        "storeState",
      );
      const problem = replyError(reply);
      if (problem) throw new Error(`storeState ${id}: ${problem}`);
    }
  }

  async function waitForRows(
    onAdapter: string,
    id: string,
    start: number,
    end: number,
    expected: HistoryRow[],
  ): Promise<HistoryRow[]> {
    const wanted = new Set(expected.map((row) => row.ts));
    const deadline = Date.now() + 15_000;
    for (;;) {
      const rows = await readRange(onAdapter, id, start, end);
      const have = new Set(rows.map((row) => row.ts));
      if ([...wanted].every((ts) => have.has(ts)) || Date.now() >= deadline) {
        return rows;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }

  function assertRows(actual: HistoryRow[], expected: HistoryRow[]): void {
    const byTs: Record<number, unknown[]> = {};
    for (const row of actual) {
      (byTs[row.ts] ||= []).push(row.val);
    }
    for (const row of expected) {
      const values = byTs[row.ts];
      if (!values) {
        throw new Error(
          `Verification: ${timeText(row.ts)} is missing on the destination.`,
        );
      }
      if (!values.some((value) => sameValue(value, row.val))) {
        throw new Error(
          `Verification: ${timeText(row.ts)} differs on the destination.`,
        );
      }
    }
  }

  async function prepare(): Promise<void> {
    if (!canRun) return;
    busy = true;
    error = "";
    message = "";
    try {
      const rows = await readRange(adapter, stateId, rangeStart, rangeEnd);
      if (rows.length === 0) {
        throw new Error("No history rows in the selected range.");
      }
      if (rows.length >= RAW_LIMIT) {
        throw new Error(
          `The range has at least ${RAW_LIMIT} rows; narrow it before transferring.`,
        );
      }
      confirm = {
        rows,
        start: rangeStart,
        end: rangeEnd,
        destinationAdapter,
        destinationState: destinationId,
        mode,
        samePlace,
      };
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }

  async function run(): Promise<void> {
    const job = confirm;
    confirm = null;
    if (!job) return;
    busy = true;
    error = "";
    message = "";
    let sourceDeleted = false;
    try {
      if (job.mode !== "copy") {
        await deleteRange(
          job.destinationAdapter,
          job.destinationState,
          job.start,
          job.end,
        );
      }
      await storeRows(job.destinationAdapter, job.destinationState, job.rows);
      const actual = await waitForRows(
        job.destinationAdapter,
        job.destinationState,
        job.start,
        job.end,
        job.rows,
      );
      assertRows(actual, job.rows);
      if (job.mode === "move" && !job.samePlace) {
        await deleteRange(adapter, stateId, job.start, job.end);
        sourceDeleted = true;
      }
      const verb =
        job.mode === "copy"
          ? "Copied"
          : job.mode === "move"
            ? "Moved"
            : "Replaced";
      message =
        `${verb} ${job.rows.length} rows to ${job.destinationAdapter} · ` +
        `${job.destinationState}.`;
      await onDone?.();
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : String(failure);
      error =
        job.mode === "move" && !job.samePlace && !sourceDeleted
          ? `${text} The source range was not deleted; the destination holds verified rows.`
          : text;
    } finally {
      busy = false;
    }
  }
</script>

<div class="transfer">
  <div class="row wrap">
    <label class="small">
      <span class="label-mono">Destination adapter</span>
      <select bind:value={destinationAdapter} disabled={busy}>
        {#each adapterOptions as option (option)}
          <option value={option}>{option}</option>
        {/each}
      </select>
    </label>
    <label class="small grow">
      <span class="label-mono">Destination state</span>
      <input
        list={listId}
        bind:value={destinationState}
        disabled={busy}
        spellcheck="false"
      />
      <datalist id={listId}>
        {#each stateOptions as option (option)}
          <option value={option}></option>
        {/each}
      </datalist>
    </label>
    <label class="small">
      <span class="label-mono">Mode</span>
      <select bind:value={mode} disabled={busy}>
        <option value="copy">Copy</option>
        <option value="replace">Replace destination range</option>
        <option value="move">Move</option>
      </select>
    </label>
    <button
      type="button"
      class="btn btn-sm"
      disabled={!canRun}
      onclick={() => void prepare()}
    >
      {busy
        ? "Working…"
        : mode === "copy"
          ? "Copy…"
          : mode === "move"
            ? "Move…"
            : "Replace…"}
    </button>
  </div>
  <p class="hint text-muted">
    Writes this From/To range to the destination through the adapter's
    storeState. Copy keeps the destination rows; replace and move delete the
    destination range first; move deletes the source only after the destination
    is verified. Resample the source first if you want aggregated rows at the
    destination.
  </p>
  {#if probing}
    <p class="hint text-muted">Checking {destinationAdapter}…</p>
  {:else if !destinationCanWrite}
    <p class="hint text-muted">
      {destinationAdapter} does not support storeState, so it cannot receive history.
    </p>
  {:else if (mode === "replace" || mode === "move") && !destinationCanDelete}
    <p class="hint text-muted">
      {destinationAdapter} does not support deleteRange; use Copy or choose another
      adapter.
    </p>
  {:else if mode === "move" && !samePlace && !sourceCanMove}
    <p class="hint text-muted">
      {adapter} does not support deleteRange, so it cannot be moved.
    </p>
  {:else if samePlace && mode === "copy"}
    <p class="hint text-muted">Choose another adapter or state for a copy.</p>
  {:else if !destinationExists}
    <p class="hint text-muted">
      The destination state does not exist. Create it first.
    </p>
  {:else if !destinationConfigured}
    <p class="hint text-muted">
      The destination has no {destinationAdapter} history item yet; add one to see
      the copied data there.
    </p>
  {:else if !rangeValid}
    <p class="hint text-muted">Set a valid From/To range first.</p>
  {/if}
  {#if error}<p class="hint text-danger">{error}</p>{/if}
  {#if message}<p class="hint text-muted">{message}</p>{/if}
</div>

{#if confirm}
  {@const job = confirm}
  <ConfirmModal
    title={`${job.mode === "copy" ? "Copy" : job.mode === "move" ? "Move" : "Replace"} ${stateId}?`}
    confirmLabel={job.mode === "copy"
      ? "Copy"
      : job.mode === "move"
        ? "Move"
        : "Replace"}
    onConfirm={() => void run()}
    onCancel={() => (confirm = null)}
  >
    <p class="text-muted">
      {job.rows.length} rows from <span class="mono">{adapter}</span> ·
      <span class="mono">{stateId}</span> to
      <span class="mono">{job.destinationAdapter}</span> ·
      <span class="mono">{job.destinationState}</span>.
    </p>
    <p class="text-muted">
      <span class="mono">{timeText(job.start)}</span> to
      <span class="mono">{timeText(job.end)}</span>.
    </p>
    {#if job.mode !== "copy"}
      <p class="hint text-muted">
        The destination's rows in this range are deleted before the copy is
        verified.
      </p>
    {/if}
    {#if job.mode === "move" && !job.samePlace}
      <p class="hint text-muted">
        The source range is deleted only after the destination is verified.
      </p>
    {/if}
  </ConfirmModal>
{/if}

<style>
  .transfer {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-top: 0.5rem;
    border-top: 1px solid var(--border-color);
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
    min-width: 9rem;
    font-size: var(--body-sm);
  }

  .small.grow {
    flex: 1;
    min-width: 12rem;
  }

  select,
  input {
    font: inherit;
    font-size: var(--body-sm);
    color: var(--text-color);
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    padding: 0.3rem 0.4rem;
    min-width: 0;
  }
</style>
