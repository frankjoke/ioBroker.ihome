<script lang="ts">
  import { untrack } from "svelte";
  import TransformEditor from "$lib/components/config/TransformEditor.svelte";
  import HistoryEditor from "$lib/components/config/HistoryEditor.svelte";
  import CodeField from "$lib/components/logic/CodeField.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { getOverrideRegistry } from "$lib/stores/overrides.svelte";
  import { registerProgramStateId } from "$lib/stores/program-states.svelte";
  import { getLogicDocument } from "$lib/stores/logics.svelte";
  import {
    evaluateOverride,
    overrideGroup,
    overrideNameTaken,
    seedOverrideName,
  } from "$lib/config/source-overrides";
  import { normalizeStates } from "$lib/config/state-meta";
  import { statesForOverride } from "$lib/config/override-states";
  import { isInfrastructure } from "$lib/config/template-suggest";
  import { formatValue, localizeName } from "$lib/config/format";
  import { stateIdFor } from "$lib/config/variables";
  import { applyRead } from "$lib/utils/transform";
  import { newId } from "$lib/utils/ids";
  import type { Control } from "$lib/types/device";
  import type { SourceOverride } from "$lib/types/overrides";

  /**
   * One state override: a repair of the broker object's metadata, or a value
   * derived from the state's group. Every field is optional — an absent one
   * keeps the object's value. The modal is opened from the state picker; the
   * picker owns the store write and reports a conflict back through `onSave`.
   */
  let {
    stateId,
    object,
    override = undefined,
    existingNames = [],
    onSave,
    onDelete,
    onClose,
    inline = false,
    historyAvailable = true,
  }: {
    stateId: string;
    object: any;
    override?: SourceOverride;
    /** The names this state already uses, for the hint line. */
    existingNames?: string[];
    onSave: (override: SourceOverride) => void | Promise<void>;
    onDelete: (id: string) => void | Promise<void>;
    onClose: () => void;
    /** Render in place, under the override row, instead of as a modal. */
    inline?: boolean;
    /** Show the history/sparkline editor only when the state has history. */
    historyAvailable?: boolean;
  } = $props();

  const common = $derived(object?.common ?? {});
  const objectName = $derived(localizeName(common.name));
  const variables = getVariables();

  function text(value: unknown): string {
    return typeof value === "string" ? value : "";
  }

  function numOrUndef(raw: string): number | undefined {
    if (raw.trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  function seed(): SourceOverride {
    if (override) {
      return { ...override, states: statesForOverride(override, common) };
    }
    const { name, label } = seedOverrideName(stateId, object, existingNames);
    return {
      id: newId(),
      stateId,
      kind: "repair",
      name,
      label,
      unit: text(common.unit) || undefined,
      type: text(common.type) || undefined,
      role: text(common.role) || undefined,
      states: statesForOverride(undefined, common),
      min: typeof common.min === "number" ? common.min : undefined,
      max: typeof common.max === "number" ? common.max : undefined,
      step: typeof common.step === "number" ? common.step : undefined,
      read: typeof common.read === "boolean" ? common.read : undefined,
      write: typeof common.write === "boolean" ? common.write : undefined,
    };
  }

  let draft = $state<SourceOverride>(untrack(seed));
  let confirmDelete = $state(false);
  let error = $state("");
  let busy = $state(false);
  let newValue = $state("");
  let newLabel = $state("");

  const objects = $derived(ioBroker.objects as Map<string, any>);
  const states = $derived(ioBroker.states as Map<string, any>);
  const anchorId = $derived(stateIdFor(stateId, variables));
  const liveValue = $derived(states.get(anchorId)?.val);
  const stateRows = $derived(
    Object.entries(normalizeStates(draft.states) ?? {}),
  );
  const roleOptions = $derived.by(() => {
    const list = [
      ...new Set(
        [...objects.values()]
          .map((entry: any) => entry?.common?.role)
          .filter((role: unknown): role is string => !!role),
      ),
    ].sort();
    for (const value of [draft.role, text(common.role)]) {
      if (value && !list.includes(value)) list.unshift(value);
    }
    return list;
  });

  const group = $derived(
    overrideGroup(stateId, objects, getOverrideRegistry(), variables),
  );
  const draftDerived = $derived({
    id: draft.id,
    stateId,
    kind: "derived" as const,
    name: draft.name,
    expr: draft.expr,
    precision: draft.precision,
  });
  // The derived preview needs live sibling values even before the override is
  // saved: register the group and let the connection subscribe it.
  $effect(() => {
    if (draft.kind !== "derived") return;
    for (const id of group.stateIds) {
      if (id.includes(".")) registerProgramStateId(id);
    }
    ioBroker.syncSubscriptions();
  });

  const preview = $derived.by(() => {
    if (draft.kind !== "derived") return undefined;
    try {
      return evaluateOverride(draftDerived, {
        group,
        states,
        registry: getOverrideRegistry(),
        objects,
      });
    } catch (e) {
      return {
        value: undefined,
        error: e instanceof Error ? e.message : String(e),
        inputs: [],
      };
    }
  });
  /** The `$.` names the expression may use: overrides first, then real siblings,
   *  with the config/availability leaves left out (the template rule). A raw
   *  state's broker-name alias is not a second chip — the leaf stands for it. */
  const siblings = $derived.by(() => {
    const seen: Record<string, boolean> = {};
    return [...group.names.entries()]
      .filter(([, entry]) => {
        if (entry.override === draft.id) return false;
        if (entry.override) return true;
        if (seen[entry.stateId]) return false;
        seen[entry.stateId] = true;
        return !isInfrastructure({ stateId: entry.stateId });
      })
      .map(([name, entry]) => {
        const sibling = entry.override
          ? getOverrideRegistry().overrides.find((o) => o.id === entry.override)
          : undefined;
        const value =
          sibling?.kind === "repair"
            ? applyRead(states.get(entry.stateId)?.val, sibling.transform)
            : states.get(entry.stateId)?.val;
        return {
          name,
          value: formatValue(
            value,
            sibling?.unit ?? objects.get(entry.stateId)?.common?.unit,
          ),
        };
      });
  });

  /** The feed the history editor writes back: an override is a control with no
   *  device, so the same editor works with a synthetic one. */
  const historyControl = $derived<Control>({
    id: draft.id,
    feature: draft.name || "override",
    stateId: anchorId,
    writable: draft.write === true,
    label: draft.label || draft.name,
    unit: draft.unit,
    history: draft.history,
  });

  const historyText = $derived(
    draft.history
      ? `${draft.history.duration ?? "?"} ${draft.history.durationUnit ?? "hours"}${
          draft.history.count ? ` · ${draft.history.count} samples` : ""
        }`
      : "no history — the chart stays off",
  );

  function setKind(next: "repair" | "derived"): void {
    draft.kind = next;
    error = "";
  }

  function setState(value: string, label: string): void {
    if (!value.trim()) return;
    draft.states = { ...(normalizeStates(draft.states) ?? {}), [value]: label };
  }

  function removeState(value: string): void {
    const next = { ...(normalizeStates(draft.states) ?? {}) };
    delete next[value];
    draft.states = Object.keys(next).length ? next : undefined;
  }

  function addState(): void {
    if (!newValue.trim()) return;
    setState(newValue.trim(), newLabel);
    newValue = "";
    newLabel = "";
  }

  function clean(): SourceOverride {
    const name = draft.name.trim();
    const base: SourceOverride = {
      id: draft.id,
      stateId,
      kind: draft.kind,
      name,
      ...(text(draft.label).trim() ? { label: text(draft.label).trim() } : {}),
      ...(text(draft.unit).trim() ? { unit: text(draft.unit).trim() } : {}),
      ...(text(draft.type) ? { type: text(draft.type) } : {}),
      ...(text(draft.role).trim() ? { role: text(draft.role).trim() } : {}),
    };
    if (draft.kind === "derived") {
      return {
        ...base,
        ...(text(draft.expr).trim() ? { expr: text(draft.expr).trim() } : {}),
        ...(draft.precision !== undefined
          ? { precision: draft.precision }
          : {}),
      };
    }
    const stateMap = normalizeStates(draft.states);
    return {
      ...base,
      ...(stateMap ? { states: stateMap } : {}),
      ...(draft.min !== undefined ? { min: draft.min } : {}),
      ...(draft.max !== undefined ? { max: draft.max } : {}),
      ...(draft.step !== undefined ? { step: draft.step } : {}),
      ...(draft.decimals !== undefined ? { decimals: draft.decimals } : {}),
      ...(draft.read !== undefined ? { read: draft.read } : {}),
      ...(draft.write !== undefined ? { write: draft.write } : {}),
      ...(draft.hideUnit === true ? { hideUnit: true } : {}),
      ...(draft.transform ? { transform: draft.transform } : {}),
      ...(draft.history ? { history: draft.history } : {}),
    };
  }

  async function save(): Promise<void> {
    error = "";
    const name = draft.name.trim();
    if (!/[A-Za-z0-9]/.test(name)) {
      error = "Give the override a name (letters or digits).";
      return;
    }
    if (
      overrideNameTaken(
        getOverrideRegistry(),
        stateId,
        name,
        draft.id,
        variables,
      )
    ) {
      error = `“${name}” is already used on this state.`;
      return;
    }
    if (draft.kind === "derived" && !text(draft.expr).trim()) {
      error = "Enter an expression for the derived value.";
      return;
    }
    busy = true;
    try {
      await onSave(clean());
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    confirmDelete = false;
    busy = true;
    try {
      await onDelete(draft.id);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }

  // Capture at the window: the source picker behind this modal listens for
  // Escape too, and one Escape must close one layer (history, delete confirm,
  // then this modal) — never the picker and this draft with it.
  $effect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The code editor's own state picker owns Escape while it is open.
      if (document.querySelector('[aria-label="Insert state reference"]')) {
        return;
      }
      event.stopPropagation();
      if (confirmDelete) {
        confirmDelete = false;
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
</script>

{#snippet body()}
  <div class="option-tabs" role="tablist" aria-label="Override kind">
    <button
      type="button"
      role="tab"
      aria-selected={draft.kind === "repair"}
      class="option-tab"
      class:active={draft.kind === "repair"}
      onclick={() => setKind("repair")}
    >
      Repair
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={draft.kind === "derived"}
      class="option-tab"
      class:active={draft.kind === "derived"}
      onclick={() => setKind("derived")}
    >
      Derived
    </button>
  </div>

  <div class="grid">
    <label class="field">
      <span class="label-mono">Name (rules use it)</span>
      <input
        type="text"
        bind:value={draft.name}
        placeholder="power"
        autocomplete="off"
      />
    </label>
    <label class="field">
      <span class="label-mono">Label</span>
      <input
        type="text"
        bind:value={draft.label}
        placeholder={draft.name || "falls back to the name"}
      />
    </label>
  </div>

  {#if existingNames.length}
    <p class="hint text-muted">
      Names on this state: {existingNames.join(", ")}
    </p>
  {/if}

  {#if draft.kind === "repair"}
    <div class="grid">
      <label class="field">
        <span class="label-mono">Type</span>
        <select bind:value={draft.type}>
          <option value="">— inherit —</option>
          {#each ["boolean", "number", "string", "mixed", "multistate", "array", "object"] as t (t)}
            <option value={t}>{t}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="label-mono">Role</span>
        <select bind:value={draft.role}>
          <option value="">— inherit —</option>
          {#each roleOptions as role (role)}
            <option value={role}>{role}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="label-mono">Unit</span>
        <input
          type="text"
          bind:value={draft.unit}
          placeholder={text(common.unit) || "— none —"}
        />
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={draft.hideUnit === true}
          onchange={(e) =>
            (draft.hideUnit = e.currentTarget.checked || undefined)}
        /> hide unit
      </label>
    </div>

    <div class="grid">
      <label class="field">
        <span class="label-mono">Min</span>
        <input
          type="number"
          value={draft.min ?? ""}
          oninput={(e) => (draft.min = numOrUndef(e.currentTarget.value))}
        />
      </label>
      <label class="field">
        <span class="label-mono">Max</span>
        <input
          type="number"
          value={draft.max ?? ""}
          oninput={(e) => (draft.max = numOrUndef(e.currentTarget.value))}
        />
      </label>
      <label class="field">
        <span class="label-mono">Step</span>
        <input
          type="number"
          value={draft.step ?? ""}
          oninput={(e) => (draft.step = numOrUndef(e.currentTarget.value))}
        />
      </label>
      <label class="field">
        <span class="label-mono">Decimals</span>
        <input
          type="number"
          min="0"
          max="10"
          value={draft.decimals ?? ""}
          oninput={(e) => (draft.decimals = numOrUndef(e.currentTarget.value))}
        />
      </label>
    </div>

    <div class="checks">
      <label class="check">
        <input
          type="checkbox"
          checked={draft.read ?? common.read === true}
          onchange={(e) => (draft.read = e.currentTarget.checked)}
        /> readable
      </label>
      <label class="check">
        <input
          type="checkbox"
          checked={draft.write ?? common.write === true}
          onchange={(e) => (draft.write = e.currentTarget.checked)}
        /> writable (metadata)
      </label>
    </div>

    <div class="section-panel states">
      <span class="label-mono">States (value → label)</span>
      {#each stateRows as [value, label] (value)}
        <div class="state-row">
          <input
            class="mono"
            type="text"
            {value}
            aria-label={`Value ${value}`}
            onchange={(e) => {
              if (e.currentTarget.value === value) return;
              removeState(value);
              setState(e.currentTarget.value, label);
            }}
          />
          <input
            type="text"
            value={label}
            aria-label={`Label for ${value}`}
            oninput={(e) => setState(value, e.currentTarget.value)}
          />
          <button
            type="button"
            class="icon-btn"
            title="Remove"
            aria-label={`Remove state ${value}`}
            onclick={() => removeState(value)}
          >
            <span class="material-symbols-outlined">delete</span>
          </button>
        </div>
      {/each}
      <div class="state-row">
        <input
          class="mono"
          type="text"
          placeholder="value"
          bind:value={newValue}
        />
        <input type="text" placeholder="label" bind:value={newLabel} />
        <button
          type="button"
          class="icon-btn"
          title="Add"
          aria-label="Add state label"
          onclick={addState}
        >
          <span class="material-symbols-outlined">add</span>
        </button>
      </div>
    </div>

    <TransformEditor
      transform={draft.transform}
      sampleValue={liveValue}
      onChange={(t) => (draft.transform = t)}
    />
  {:else}
    <div class="grid">
      <label class="field">
        <span class="label-mono">Type</span>
        <select bind:value={draft.type}>
          <option value="">— none —</option>
          {#each ["number", "string", "boolean"] as t (t)}
            <option value={t}>{t}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="label-mono">Unit</span>
        <input type="text" bind:value={draft.unit} placeholder="°C" />
      </label>
      <label class="field">
        <span class="label-mono">Role</span>
        <select bind:value={draft.role}>
          <option value="">— none —</option>
          {#each roleOptions as role (role)}
            <option value={role}>{role}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="label-mono">Precision</span>
        <input
          type="number"
          min="0"
          max="10"
          value={draft.precision ?? ""}
          oninput={(e) => (draft.precision = numOrUndef(e.currentTarget.value))}
        />
      </label>
    </div>

    <CodeField
      label="Expression"
      mode="expression"
      minRows={2}
      code={draft.expr ?? ""}
      onchange={(code) => (draft.expr = code)}
      placeholder="$.humidity * 0.5 + $.temperature * 0.5"
      logics={getLogicDocument().logics}
      quickInserts={siblings.map((sibling) => ({
        label: `$.${sibling.name}`,
        insert: `$.${sibling.name}`,
        title: `$.${sibling.name} = ${sibling.value}`,
      }))}
    />

    <div class="preview">
      <span class="label-mono">Result</span>
      {#if preview?.error}
        <span class="err">{preview.error}</span>
      {:else if preview}
        <span class="mono">{formatValue(preview.value, draft.unit)}</span>
      {:else}
        <span class="text-muted">—</span>
      {/if}
    </div>
  {/if}

  {#if historyAvailable}
    <div class="history-section">
      {#if draft.history}
        <HistoryEditor
          inline
          control={historyControl}
          onChange={(c) => (draft.history = c.history)}
          onClose={() => undefined}
        />
      {:else}
        <div class="feed">
          <span class="label-mono">History / sparkline</span>
          <span class="text-muted hint">{historyText}</span>
          <button
            type="button"
            class="btn btn-sm"
            onclick={() =>
              (draft.history = {
                duration: 24,
                durationUnit: "hours",
                count: 200,
              })}
          >
            <span class="material-symbols-outlined">timeline</span>
            Add history
          </button>
        </div>
      {/if}
    </div>
  {/if}

  {#if error}
    <p class="error">{error}</p>
  {/if}
{/snippet}

{#if inline}
  <div class="override-inline">
    {@render body()}
    <div class="actions">
      <div class="actions-left">
        {#if override}
          <button
            type="button"
            class="btn btn-danger"
            disabled={busy}
            onclick={() => (confirmDelete = true)}
          >
            <span class="material-symbols-outlined">delete</span>
            Delete
          </button>
        {/if}
      </div>
      <div class="actions-buttons">
        <button type="button" class="btn" onclick={onClose}>
          <span class="material-symbols-outlined" aria-hidden="true">close</span
          >
          Close
        </button>
        <button
          type="button"
          class="btn btn-primary"
          disabled={busy}
          onclick={save}
        >
          Save
        </button>
      </div>
    </div>
  </div>
{:else}
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Source override"
  >
    <div class="modal-content">
      <div class="modal-head">
        <div>
          <h3>Override — {objectName || stateId}</h3>
          <span class="state-id mono">{stateId}</span>
        </div>
        <button
          type="button"
          class="icon-btn"
          aria-label="Close"
          onclick={onClose}
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      {@render body()}
      <div class="actions">
        <div class="actions-left">
          {#if override}
            <button
              type="button"
              class="btn btn-danger"
              disabled={busy}
              onclick={() => (confirmDelete = true)}
            >
              <span class="material-symbols-outlined">delete</span>
              Delete
            </button>
          {/if}
        </div>
        <div class="actions-buttons">
          <button type="button" class="btn" onclick={onClose}>Cancel</button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={busy}
            onclick={save}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if confirmDelete}
  <ConfirmModal
    title={`Delete override “${draft.name}”?`}
    confirmLabel="Delete"
    onConfirm={remove}
    onCancel={() => (confirmDelete = false)}
  >
    <p class="text-muted">
      Slots bound to it fall back to the raw state; rules naming it lose the
      local.
    </p>
  </ConfirmModal>
{/if}

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1050;
    padding: 1rem;
  }

  .modal-content {
    background: var(--surface-color);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(720px, 100%);
    max-height: 90vh;
    overflow: auto;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .modal-head h3 {
    margin: 0;
  }

  .state-id {
    font-size: var(--body-sm);
    color: var(--text-muted);
    overflow-wrap: anywhere;
  }

  .option-tabs {
    --option-tab-bg: var(--surface-color);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem;
    align-items: end;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .checks {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
  }

  .states {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .state-row {
    display: flex;
    gap: 0.35rem;
  }

  .state-row input {
    flex: 1 1 auto;
    min-width: 0;
  }

  .feed {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .history-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .preview {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    padding: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-container-low);
  }

  .hint {
    font-size: var(--body-sm);
    margin: 0;
  }

  .error {
    color: var(--danger-color);
    font-size: var(--body-sm);
    margin: 0;
  }

  .err {
    color: var(--danger-color);
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .actions-left,
  .actions-buttons {
    display: flex;
    gap: 0.5rem;
  }

  @media (max-width: 640px) {
    .grid {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
