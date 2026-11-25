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
  import HistoryTransfer from "./HistoryTransfer.svelte";
  import CodeField from "$lib/components/logic/CodeField.svelte";
  import { checkStatement } from "$logic/expr-code";
  import { parseDuration } from "$adapter/logic/duration";
  import {
    getHistoryDerived,
    isHistoryDerivedLoaded,
    saveHistoryDerived,
  } from "$lib/stores/history-derived.svelte";
  import type { DerivedEntry } from "$adapter/history-derived-common";
  import { writeStateCustom } from "$lib/config/state-write";
  import { csvText } from "$lib/config/history-resample";
  import { jsonText, parseHistoryText } from "$lib/config/history-file";
  import {
    retentionDays,
    retentionLabel,
    retentionValues,
    supportsStateRetention,
  } from "$lib/config/history-retention";
  import { downloadText } from "$lib/utils/download";
  import { formatValue, localizeName } from "$lib/config/format";
  import { debounce } from "$lib/utils/debounce";

  let {
    stateId,
    customKeys,
    object,
    defaultAdapter,
    adapters = [],
    openAdapter = $bindable(""),
  }: {
    stateId: string;
    customKeys: string[];
    object: any;
    defaultAdapter: string;
    /** Installed history adapters, for the copy/move destination. */
    adapters?: string[];
    /** The open adapter; owned by the parent so it survives tab switches. */
    openAdapter?: string;
  } = $props();

  const DURATIONS = [
    { value: "1", label: "1 hour" },
    { value: "6", label: "6 hours" },
    { value: "24", label: "24 hours" },
    { value: "168", label: "7 days" },
    { value: "720", label: "30 days" },
    { value: "2160", label: "90 days" },
    { value: "8760", label: "1 year" },
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
  const DEFAULT_INTERVAL = "15m";
  const DEFAULT_START_DELAY = "0s";
  const DEFAULT_RELOG = "1h";
  const DEFAULT_FUNCTION =
    'const values = samples\n  .filter((sample) => typeof sample.val === "number")\n  .map((sample) => sample.val);\nreturn values.length ? mean(values) : NOOP;';
  type LoggingMode = "raw" | "derived" | "off";

  let draftMode = $state<LoggingMode>("raw");
  let draftInterval = $state(DEFAULT_INTERVAL);
  let draftStartDelay = $state(DEFAULT_START_DELAY);
  let draftChangesOnly = $state(true);
  let draftRelog = $state(DEFAULT_RELOG);
  let draftFunction = $state(DEFAULT_FUNCTION);
  let draftAlias = $state<string | null>(null);
  let draftRetention = $state<string | null>(null);
  let draftRetentionDays = $state("");
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
  let fileBusy = $state(false);
  let fileInput = $state<HTMLInputElement>();
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

  function derivedEntryOf(key: string): DerivedEntry | undefined {
    return getHistoryDerived().entries.find(
      (entry) => entry.id === stateId && entry.adapter === key,
    );
  }

  function loggingModeOf(key: string): LoggingMode {
    if (derivedEntryOf(key)) return "derived";
    return enabledOf(key) ? "raw" : "off";
  }

  const derivedAvailable = $derived(
    openAdapter !== "" &&
      (object?.common?.type === "number" || object?.common?.type === "mixed") &&
      hasHistoryFeature(featuresReply, "storeState") &&
      (draftAlias ?? aliasOf(openAdapter)).trim() === "",
  );

  const derivedProblem = $derived.by(() => {
    if (openAdapter === "" || draftMode !== "derived") return "";
    if (object?.common?.type !== "number" && object?.common?.type !== "mixed") {
      return "Derived history is only available for number and mixed states.";
    }
    if (!hasHistoryFeature(featuresReply, "storeState")) {
      return `${openAdapter} does not support storeState.`;
    }
    if ((draftAlias ?? aliasOf(openAdapter)).trim()) {
      return "Clear the history alias before using derived history.";
    }
    const interval = parseDuration(draftInterval);
    if (interval === null || interval <= 0) {
      return "Interval must be a positive duration, e.g. 15m.";
    }
    const startDelay = parseDuration(draftStartDelay);
    if (startDelay === null || startDelay < 0) {
      return "Start delay must be a duration, e.g. 10s.";
    }
    const relog = parseDuration(draftRelog);
    if (relog === null || relog < 0) {
      return "Repeat interval must be a duration, e.g. 1h.";
    }
    if (!draftFunction.trim()) return "The derived function needs code.";
    const codeProblem = checkStatement(draftFunction);
    if (codeProblem) return codeProblem;
    if (!isHistoryDerivedLoaded()) {
      return "The derived history document is still loading.";
    }
    return "";
  });

  const derivedDirty = $derived.by(() => {
    if (openAdapter === "") return false;
    if (draftMode !== loggingModeOf(openAdapter)) return true;
    if (draftMode !== "derived") return false;
    const entry = derivedEntryOf(openAdapter);
    if (!entry) return true;
    return (
      draftInterval !== entry.interval ||
      draftStartDelay !== entry.startDelay ||
      draftChangesOnly !== entry.changesOnly ||
      draftRelog !== entry.relogInterval ||
      draftFunction !== entry.function.code
    );
  });

  function retentionPresetOf(key: string): string {
    const days = retentionDays(customValue(key));
    if (days === undefined) return "";
    const rounded = Math.round(days);
    if ([0, 30, 90, 180, 365, 730].includes(rounded)) {
      return String(rounded);
    }
    return "custom";
  }

  const retentionOk = $derived(
    draftRetention !== "custom" ||
      (Number.isFinite(Number(draftRetentionDays)) &&
        Number(draftRetentionDays) >= 0),
  );

  const retentionDirty = $derived.by(() => {
    if (openAdapter === "" || draftRetention === null) return false;
    if (draftRetention !== retentionPresetOf(openAdapter)) return true;
    if (draftRetention !== "custom") return false;
    const current = retentionDays(customValue(openAdapter));
    return (
      draftRetentionDays !==
      (current === undefined ? "" : String(Math.round(current)))
    );
  });

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
      ((draftAlias !== null && draftAlias !== aliasOf(openAdapter)) ||
        retentionDirty ||
        derivedDirty),
  );

  async function saveConfig(): Promise<void> {
    const key = openAdapter;
    if (!key) return;
    const mode = draftMode;
    const alias = (draftAlias ?? aliasOf(key)).trim();
    const value = customValue(key);
    if (!value) return;
    if (mode === "derived" && derivedProblem) {
      error = derivedProblem;
      return;
    }
    saving = true;
    error = "";
    message = "";
    const next: Record<string, unknown> = {
      ...value,
      enabled: mode === "raw",
      aliasId: alias,
    };
    const retention = draftRetention ?? retentionPresetOf(key);
    if (retention === "") {
      delete next.retention;
      delete next.customRetentionDuration;
    } else {
      const days =
        retention === "custom" ? Number(draftRetentionDays) : Number(retention);
      if (Number.isFinite(days) && days >= 0) {
        const fields = retentionValues(days);
        next.retention = fields.retention;
        next.customRetentionDuration = fields.customRetentionDuration;
      }
    }
    const custom = {
      ...((object?.common?.custom ?? {}) as Record<string, unknown>),
      [key]: next,
    };
    const entries = getHistoryDerived().entries.filter(
      (entry) => !(entry.id === stateId && entry.adapter === key),
    );
    if (mode === "derived") {
      entries.push({
        id: stateId,
        adapter: key,
        interval: draftInterval.trim(),
        startDelay: draftStartDelay.trim(),
        changesOnly: draftChangesOnly,
        relogInterval: draftRelog.trim(),
        function: { code: draftFunction },
      });
    }
    const hadDerived = !!derivedEntryOf(key);
    try {
      // Removing first avoids the service writing while the item is switched
      // off; adding writes the raw-off config first so the adapter never sees
      // both raw and derived active.
      if (mode !== "derived" && hadDerived) {
        if (!(await saveHistoryDerived(entries))) {
          throw new Error("Derived history config could not be removed.");
        }
      }
      await writeStateCustom(stateId, custom);
      if (mode === "derived" && !(await saveHistoryDerived(entries))) {
        throw new Error("Derived history config could not be saved.");
      }
      draftMode = mode;
      draftAlias = alias;
      const savedDays = retentionDays(next);
      draftRetention =
        savedDays === undefined
          ? ""
          : [0, 30, 90, 180, 365, 730].includes(Math.round(savedDays))
            ? String(Math.round(savedDays))
            : "custom";
      draftRetentionDays =
        savedDays === undefined ? "" : String(Math.round(savedDays));
      message =
        mode === "derived"
          ? `${key}: derived logging saved.`
          : alias
            ? `${key}: history alias ${alias}.`
            : `${key} ${mode === "raw" ? "enabled" : "off"}.`;
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
    draftMode = openAdapter ? loggingModeOf(openAdapter) : "raw";
    const entry = openAdapter ? derivedEntryOf(openAdapter) : undefined;
    draftInterval = entry?.interval ?? DEFAULT_INTERVAL;
    draftStartDelay = entry?.startDelay ?? DEFAULT_START_DELAY;
    draftChangesOnly = entry?.changesOnly ?? true;
    draftRelog = entry?.relogInterval ?? DEFAULT_RELOG;
    draftFunction = entry?.function.code ?? DEFAULT_FUNCTION;
    draftAlias = openAdapter ? aliasOf(openAdapter) : null;
    draftRetention = openAdapter ? retentionPresetOf(openAdapter) : null;
    draftRetentionDays = openAdapter
      ? String(Math.round(retentionDays(customValue(openAdapter)) ?? 0))
      : "";
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

  function sameValue(actual: unknown, expected: unknown): boolean {
    if (typeof actual === "number" && typeof expected === "number") {
      // sql.0 rounds stored numbers to its instance precision (default 4 decimals).
      return (
        Math.abs(actual - expected) <= Math.max(1e-4, Math.abs(expected) * 1e-4)
      );
    }
    return JSON.stringify(actual) === JSON.stringify(expected);
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

  async function readRange(start: number, end: number) {
    const reply = await withTimeout(
      ioBroker.sendTo(adapter, "getHistory", {
        id: stateId,
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
    const errorText = replyError(reply);
    if (errorText) throw new Error(errorText);
    return historyRows(reply);
  }

  function rangeFileName(kind: string, start: number, end: number): string {
    const safe = stateId.replace(/[^A-Za-z0-9._-]+/g, "-");
    const from = new Date(start).toISOString().slice(0, 16).replace(":", "");
    const to = new Date(end).toISOString().slice(0, 16).replace(":", "");
    return `${safe}-history-${kind}-${from}-${to}.${kind}`;
  }

  async function exportRange(kind: "csv" | "json"): Promise<void> {
    if (!rangeBounds.valid || fileBusy) return;
    fileBusy = true;
    error = "";
    message = "";
    try {
      const rows = await readRange(rangeBounds.start, rangeBounds.end);
      if (rows.length === 0) {
        message = "No entries in the selected range.";
        return;
      }
      downloadText(
        rangeFileName(kind, rangeBounds.start, rangeBounds.end),
        kind === "csv" ? csvText(rows) : jsonText(rows),
        kind === "csv" ? "text/csv;charset=utf-8" : "application/json",
      );
      message = `Exported ${rows.length} rows from ${adapter}.`;
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      fileBusy = false;
    }
  }

  async function importFile(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || fileBusy) return;
    if (!hasHistoryFeature(featuresReply, "storeState")) {
      error = `${adapter} cannot store imported history.`;
      return;
    }
    fileBusy = true;
    error = "";
    message = "";
    try {
      const rows = parseHistoryText(await file.text());
      if (rows.length > RAW_LIMIT) {
        throw new Error(
          `The file has ${rows.length} rows; the limit is ${RAW_LIMIT}. Split it.`,
        );
      }
      const start = rows[0].ts;
      const end = rows[rows.length - 1].ts + 1;
      for (let index = 0; index < rows.length; index += 5000) {
        const batch = rows.slice(index, index + 5000).map((row) => ({
          ts: row.ts,
          val: row.val,
          ack: true,
          from: ioBroker.namespace,
        }));
        const reply = await withTimeout(
          ioBroker.sendTo(adapter, "storeState", {
            id: stateId,
            state: batch,
          }) as Promise<unknown>,
          30_000,
          "storeState",
        );
        const errorText = replyError(reply);
        if (errorText) throw new Error(`storeState: ${errorText}`);
      }
      // sql.0 acknowledges storeState before its SQL insert has run.
      const wanted = new Set(rows.map((row) => row.ts));
      const deadline = Date.now() + 15_000;
      let actual = new Map<number, unknown>();
      for (;;) {
        actual = new Map(
          (await readRange(start, end)).map((row) => [row.ts, row.val]),
        );
        if (
          [...wanted].every((ts) => actual.has(ts)) ||
          Date.now() >= deadline
        ) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
      let checked = 0;
      for (const row of rows) {
        if (!actual.has(row.ts)) {
          throw new Error(
            `Verification: ${new Date(row.ts).toLocaleString()} is missing.`,
          );
        }
        if (!sameValue(actual.get(row.ts), row.val)) {
          throw new Error(
            `Verification: ${new Date(row.ts).toLocaleString()} differs.`,
          );
        }
        checked += 1;
      }
      message = `Imported ${checked} rows into ${adapter} · ${stateId}.`;
      await loadChart();
      await countRange();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      fileBusy = false;
    }
  }

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
      draftMode = "raw";
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
        {@const itemMode = loggingModeOf(key)}
        {@const retention = retentionDays(customValue(key))}
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
            {#if itemMode === "derived"}
              <span class="badge">derived</span>
            {:else if itemMode === "off"}
              <span class="badge badge-secondary">off</span>
            {/if}
            {#if retention !== undefined && supportsStateRetention(key)}
              <span class="badge badge-secondary"
                >{retentionLabel(retention)}</span
              >
            {/if}
            <span class="item-actions">
              {#if open}
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={!configDirty ||
                    !retentionOk ||
                    (draftMode === "derived" && !!derivedProblem) ||
                    saving}
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
              {#if supportsStateRetention(key)}
                <div class="row wrap">
                  <label class="small">
                    <span class="label-mono">Retention</span>
                    <select
                      value={draftRetention ?? retentionPresetOf(key)}
                      disabled={saving}
                      onchange={(event) =>
                        (draftRetention = event.currentTarget.value)}
                    >
                      <option value="">Adapter default</option>
                      <option value="0">Keep forever</option>
                      <option value="30">1 month</option>
                      <option value="90">3 months</option>
                      <option value="180">6 months</option>
                      <option value="365">1 year</option>
                      <option value="730">2 years</option>
                      <option value="custom">Custom…</option>
                    </select>
                  </label>
                  {#if (draftRetention ?? retentionPresetOf(key)) === "custom"}
                    <label class="small">
                      <span class="label-mono">Days</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={draftRetentionDays}
                        disabled={saving}
                        oninput={(event) =>
                          (draftRetentionDays = event.currentTarget.value)}
                      />
                    </label>
                  {/if}
                </div>
                <p class="hint text-muted">
                  Retention is enforced by the history adapter. “Adapter
                  default” leaves the instance setting in charge; use 1 month
                  for most temperatures and 1–2 years for states you compare
                  yearly.
                </p>
              {:else}
                <p class="hint text-muted">
                  {key} keeps history per instance or database, not per state. Use
                  separate adapter instances or databases for different retention
                  tiers; the retention fields here would be ignored.
                </p>
              {/if}
              <div class="row wrap">
                <label class="small">
                  <span class="label-mono">Logging</span>
                  <select bind:value={draftMode} disabled={saving}>
                    <option value="raw">Raw (adapter logs)</option>
                    <option value="derived" disabled={!derivedAvailable}
                      >Derived (iHome computes)</option
                    >
                    <option value="off">Off</option>
                  </select>
                </label>
              </div>
              {#if !derivedAvailable && draftMode !== "derived"}
                <p class="hint text-muted">
                  Derived history needs a number or mixed state, storeState from
                  {key}, and an empty alias.
                </p>
              {/if}
              {#if draftMode === "derived"}
                <div class="row wrap">
                  <label class="small">
                    <span class="label-mono">Interval</span>
                    <input
                      type="text"
                      list="derived-intervals"
                      bind:value={draftInterval}
                      disabled={saving}
                      placeholder="15m"
                    />
                    <datalist id="derived-intervals">
                      <option value="5m"></option>
                      <option value="15m"></option>
                      <option value="30m"></option>
                      <option value="1h"></option>
                    </datalist>
                  </label>
                  <label class="small">
                    <span class="label-mono">Start delay</span>
                    <input
                      type="text"
                      list="derived-start-delays"
                      bind:value={draftStartDelay}
                      disabled={saving}
                      placeholder="0s"
                    />
                    <datalist id="derived-start-delays">
                      <option value="0s"></option>
                      <option value="5s"></option>
                      <option value="10s"></option>
                      <option value="30s"></option>
                      <option value="1m"></option>
                    </datalist>
                  </label>
                  <label class="check">
                    <input
                      type="checkbox"
                      bind:checked={draftChangesOnly}
                      disabled={saving}
                    />
                    <span>Skip unchanged</span>
                  </label>
                  <label class="small">
                    <span class="label-mono">Repeat at least every</span>
                    <input
                      type="text"
                      list="derived-relogs"
                      bind:value={draftRelog}
                      disabled={saving || !draftChangesOnly}
                      placeholder="1h"
                    />
                    <datalist id="derived-relogs">
                      <option value="0s"></option>
                      <option value="15m"></option>
                      <option value="1h"></option>
                      <option value="6h"></option>
                      <option value="24h"></option>
                    </datalist>
                  </label>
                </div>
                <CodeField
                  mode="statements"
                  label="Derived function"
                  code={draftFunction}
                  onchange={(code) => (draftFunction = code)}
                  minRows={4}
                  hint="samples, previous, from, to · mean, timeWeightedMean, median, sum, min, max · return NOOP to skip"
                />
                {#if derivedProblem}
                  <p class="hint text-danger">{derivedProblem}</p>
                {/if}
                <p class="hint text-muted">
                  The function runs once per interval and writes one point at
                  the scheduled interval end. Raw logging stays off; derived
                  points exist only while iHome is running.
                </p>
              {/if}
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
              <div class="row wrap">
                <span class="label-mono">Data file</span>
                <button
                  type="button"
                  class="btn btn-sm"
                  disabled={fileBusy || !rangeBounds.valid}
                  onclick={() => void exportRange("csv")}>Export CSV</button
                >
                <button
                  type="button"
                  class="btn btn-sm"
                  disabled={fileBusy || !rangeBounds.valid}
                  onclick={() => void exportRange("json")}>Export JSON</button
                >
                {#if hasHistoryFeature(featuresReply, "storeState")}
                  <button
                    type="button"
                    class="btn btn-sm"
                    disabled={fileBusy}
                    onclick={() => fileInput?.click()}
                    >{fileBusy ? "Working…" : "Import…"}</button
                  >
                  <input
                    bind:this={fileInput}
                    type="file"
                    accept=".csv,.json,text/csv,application/json"
                    hidden
                    onchange={(event) => void importFile(event)}
                  />
                {/if}
              </div>
              <p class="hint text-muted">
                Export uses the From/To range. Import adds rows to this state's
                {adapter} history; it never deletes. To replace a range, delete it
                first.
              </p>
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
              <HistoryTransfer
                {adapter}
                {stateId}
                {featuresReply}
                {adapters}
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
