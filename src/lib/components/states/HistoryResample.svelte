<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import {
    deleteRangePayload,
    hasHistoryFeature,
    historyRows,
    type HistoryRow,
  } from "$lib/config/state-settings";
  import {
    csvText,
    resamplePoints,
    type ResampleAggregate,
    type ResamplePoint,
  } from "$lib/config/history-resample";
  import { downloadText } from "$lib/utils/download";
  import { newId } from "$lib/utils/ids";

  let {
    adapter,
    stateId,
    object,
    config,
    featuresReply,
    rangeStart,
    rangeEnd,
    rangeValid,
    onDone,
  }: {
    adapter: string;
    stateId: string;
    object: any;
    config: Record<string, unknown>;
    featuresReply: unknown;
    rangeStart: number;
    rangeEnd: number;
    rangeValid: boolean;
    onDone?: () => void | Promise<void>;
  } = $props();

  const INTERVALS = [
    { value: "5", label: "5 minutes" },
    { value: "15", label: "15 minutes" },
    { value: "60", label: "1 hour" },
  ] as const;
  const AGGREGATES: Array<{ value: ResampleAggregate; label: string }> = [
    { value: "average", label: "Average" },
    { value: "min", label: "Minimum" },
    { value: "max", label: "Maximum" },
    { value: "last", label: "Last" },
  ];
  const RAW_LIMIT = 100_000;

  let interval = $state("15");
  let aggregate = $state<ResampleAggregate>("average");
  let backup = $state(true);
  let busy = $state(false);
  let error = $state("");
  let message = $state("");
  let confirm = $state<{
    raw: HistoryRow[];
    points: ResamplePoint[];
    start: number;
    end: number;
  } | null>(null);
  let retry = $state<{
    tempId: string;
    points: ResamplePoint[];
    start: number;
    end: number;
  } | null>(null);

  const supported = $derived(
    adapter !== "" &&
      hasHistoryFeature(featuresReply, "getHistory") &&
      hasHistoryFeature(featuresReply, "storeState") &&
      hasHistoryFeature(featuresReply, "deleteRange") &&
      hasHistoryFeature(featuresReply, "deleteAll"),
  );
  const canRun = $derived(
    supported && rangeValid && !busy && !!config && rangeEnd > rangeStart,
  );
  const stepMs = $derived(Number(interval) * 60_000);

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

  function timeText(ms: number): string {
    return new Date(ms).toLocaleString();
  }

  function fileName(kind: string, start: number, end: number): string {
    const safe = stateId.replace(/[^A-Za-z0-9._-]+/g, "-");
    const from = new Date(start).toISOString().slice(0, 16).replace(":", "");
    const to = new Date(end).toISOString().slice(0, 16).replace(":", "");
    return `${safe}-history-${kind}-${from}-${to}.csv`;
  }

  function download(file: string, rows: HistoryRow[]): void {
    downloadText(file, csvText(rows), "text/csv;charset=utf-8");
  }

  async function readRange(
    id: string,
    start: number,
    end: number,
  ): Promise<HistoryRow[]> {
    const reply = await withTimeout(
      ioBroker.sendTo(adapter, "getHistory", {
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

  async function storePoints(
    id: string,
    points: ResamplePoint[],
  ): Promise<void> {
    if (points.length === 0) throw new Error("No points to store.");
    const reply = await withTimeout(
      ioBroker.sendTo(adapter, "storeState", {
        id,
        state: points.map((point) => ({
          ts: point.ts,
          val: point.val,
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

  function numericWithin(
    rows: HistoryRow[],
    start: number,
    end: number,
  ): ResamplePoint[] {
    return rows
      .filter(
        (row) =>
          row.ts >= start &&
          row.ts <= end &&
          typeof row.val === "number" &&
          Number.isFinite(row.val),
      )
      .map((row) => ({ ts: row.ts, val: row.val as number }))
      .sort((left, right) => left.ts - right.ts);
  }

  function sameValue(actual: number, expected: number): boolean {
    return (
      Math.abs(actual - expected) <= Math.max(1e-9, Math.abs(expected) * 1e-6)
    );
  }

  function assertTemp(
    actual: ResamplePoint[],
    expected: ResamplePoint[],
  ): void {
    if (actual.length !== expected.length) {
      throw new Error(
        `Temp verification: expected ${expected.length} points, got ${actual.length}.`,
      );
    }
    for (let index = 0; index < expected.length; index += 1) {
      const got = actual[index];
      const want = expected[index];
      if (got.ts !== want.ts) {
        throw new Error(`Temp verification: ${timeText(want.ts)} is missing.`);
      }
      if (!sameValue(got.val, want.val)) {
        throw new Error(
          `Temp verification: ${timeText(want.ts)} is ${got.val}, expected ${want.val}.`,
        );
      }
    }
  }

  async function createTempState(id: string): Promise<void> {
    const historyConfig = { ...(config ?? {}), enabled: true, aliasId: "" };
    const temp = {
      _id: id,
      type: "state",
      common: {
        name: `History resample ${object?.common?.name ?? stateId}`,
        type: object?.common?.type ?? "mixed",
        role: object?.common?.role ?? "state",
        read: true,
        write: false,
        custom: { [adapter]: historyConfig },
      },
      native: {},
    };
    await withTimeout(
      ioBroker.emitAsync("setObject", id, temp),
      10_000,
      "create temp state",
    );
    (ioBroker.objects as any)?.update?.(id, temp);
  }

  async function cleanupTemp(id: string): Promise<string> {
    let problem = "";
    try {
      const reply = await withTimeout(
        ioBroker.sendTo(adapter, "deleteAll", { id }) as Promise<unknown>,
        15_000,
        "deleteAll temp",
      );
      const errorText = replyError(reply);
      if (errorText) problem = `deleteAll: ${errorText}`;
    } catch (failure) {
      problem = `deleteAll: ${failure instanceof Error ? failure.message : String(failure)}`;
    }
    try {
      const reply = await withTimeout(
        ioBroker.sendTo(ioBroker.namespace, "states", {
          action: "delete",
          id,
        }) as Promise<unknown>,
        15_000,
        "delete temp state",
      );
      const errorText = replyError(reply);
      if (errorText) {
        const text = `delete temp state: ${errorText}`;
        problem = problem ? `${problem}; ${text}` : text;
      }
    } catch (failure) {
      const text = `delete temp state: ${failure instanceof Error ? failure.message : String(failure)}`;
      problem = problem ? `${problem}; ${text}` : text;
    }
    return problem;
  }

  async function copyToBase(
    points: ResamplePoint[],
    start: number,
    end: number,
  ): Promise<ResamplePoint[]> {
    await storePoints(stateId, points);
    const actual = numericWithin(
      await readRange(stateId, start, end),
      start,
      end,
    );
    const byTime = new Map(actual.map((point) => [point.ts, point.val]));
    for (const point of points) {
      if (!byTime.has(point.ts)) {
        throw new Error(
          `Copy verification: ${timeText(point.ts)} is missing on the base state.`,
        );
      }
      if (!sameValue(byTime.get(point.ts) as number, point.val)) {
        throw new Error(
          `Copy verification: ${timeText(point.ts)} differs on the base state.`,
        );
      }
    }
    return actual;
  }

  async function prepare(): Promise<void> {
    if (!canRun) return;
    busy = true;
    error = "";
    message = "";
    retry = null;
    try {
      const raw = await readRange(stateId, rangeStart, rangeEnd);
      if (raw.length === 0) {
        throw new Error("No history rows in the selected range.");
      }
      if (raw.length >= RAW_LIMIT) {
        throw new Error(
          `The range has at least ${RAW_LIMIT} rows; narrow it before resampling.`,
        );
      }
      const points = resamplePoints(raw, stepMs, aggregate);
      if (points.length === 0) {
        throw new Error("No numeric history rows to resample.");
      }
      confirm = { raw, points, start: rangeStart, end: rangeEnd };
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
    retry = null;
    let tempId = "";
    let deleteAttempted = false;
    let originalDeleted = false;
    let verified: ResamplePoint[] = [];
    try {
      if (backup) download(fileName("raw", job.start, job.end), job.raw);
      tempId = `${ioBroker.namespace}.historyResample.${newId()}`;
      await createTempState(tempId);
      await storePoints(tempId, job.points);
      verified = numericWithin(
        await readRange(tempId, job.start, job.end),
        job.start,
        job.end,
      );
      assertTemp(verified, job.points);

      deleteAttempted = true;
      const reply = await withTimeout(
        ioBroker.sendTo(
          adapter,
          "deleteRange",
          deleteRangePayload(stateId, job.start, job.end),
        ) as Promise<unknown>,
        30_000,
        "deleteRange",
      );
      const problem = replyError(reply);
      if (problem) throw new Error(`Delete failed: ${problem}`);
      originalDeleted = true;

      await copyToBase(verified, job.start, job.end);
      const cleanup = await cleanupTemp(tempId);
      tempId = "";
      message =
        `Resampled ${job.raw.length} rows into ${verified.length} points.` +
        (cleanup ? ` Temp cleanup: ${cleanup}` : "");
      await onDone?.();
    } catch (failure) {
      const text = failure instanceof Error ? failure.message : String(failure);
      if (tempId && !deleteAttempted) {
        const cleanup = await cleanupTemp(tempId);
        error = text + (cleanup ? ` (temp cleanup: ${cleanup})` : "");
      } else if (tempId && !originalDeleted) {
        error = `${text} The temporary copy remains at ${tempId}.`;
      } else if (tempId && originalDeleted && verified.length > 0) {
        retry = {
          tempId,
          points: verified,
          start: job.start,
          end: job.end,
        };
        error = `${text} The temporary copy remains at ${tempId}; retry the copy.`;
      } else {
        error = text;
      }
    } finally {
      busy = false;
    }
  }

  async function retryCopy(): Promise<void> {
    const job = retry;
    if (!job || busy) return;
    busy = true;
    error = "";
    try {
      await copyToBase(job.points, job.start, job.end);
      const cleanup = await cleanupTemp(job.tempId);
      retry = null;
      message =
        "Copy completed." + (cleanup ? ` Temp cleanup: ${cleanup}` : "");
      await onDone?.();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }
</script>

<div class="resample">
  <div class="row wrap">
    <label class="small">
      <span class="label-mono">Resample to</span>
      <select bind:value={interval} disabled={busy}>
        {#each INTERVALS as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
    <label class="small">
      <span class="label-mono">Aggregate</span>
      <select bind:value={aggregate} disabled={busy}>
        {#each AGGREGATES as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
    <button
      type="button"
      class="btn btn-sm"
      disabled={!canRun}
      onclick={() => void prepare()}
    >
      {busy ? "Working…" : "Resample…"}
    </button>
  </div>
  <p class="hint text-muted">
    Replaces the stored data in the From/To range with one {aggregate} point per
    {interval} minutes. The original is deleted only after the temporary copy is verified.
  </p>
  {#if !supported}
    <p class="hint text-muted">
      This adapter does not support the store/delete commands needed for
      resampling.
    </p>
  {:else if !rangeValid}
    <p class="hint text-muted">Set a valid From/To range first.</p>
  {/if}
  {#if error}<p class="hint text-danger">{error}</p>{/if}
  {#if message}<p class="hint text-muted">{message}</p>{/if}
  {#if retry}
    <button
      type="button"
      class="btn btn-sm"
      disabled={busy}
      onclick={() => void retryCopy()}
    >
      Retry copy from temp
    </button>
  {/if}
</div>

{#if confirm}
  {@const job = confirm}
  <ConfirmModal
    title={`Resample ${stateId}?`}
    confirmLabel="Resample and replace"
    onConfirm={() => void run()}
    onCancel={() => (confirm = null)}
  >
    <p class="text-muted">
      {job.raw.length} raw rows → {job.points.length} points at
      {interval} minutes, {aggregate}.
    </p>
    <p class="text-muted">
      <span class="mono">{timeText(job.start)}</span> to
      <span class="mono">{timeText(job.end)}</span> on
      <span class="mono">{adapter}</span>.
    </p>
    <label class="inline">
      <input type="checkbox" bind:checked={backup} />
      <span>Download the raw range first</span>
    </label>
    <p class="hint text-muted">
      The original range is deleted only after the temporary copy is verified.
      The temporary copy is kept if copying back fails.
    </p>
  </ConfirmModal>
{/if}

<style>
  .resample {
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
  }

  select {
    font: inherit;
    font-size: var(--body-sm);
    color: var(--text-color);
    background: var(--surface-color);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius);
    padding: 0.3rem 0.4rem;
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--body-sm);
  }
</style>
