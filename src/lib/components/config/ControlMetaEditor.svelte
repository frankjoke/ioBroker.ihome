<script lang="ts">
  import type { Control } from "$lib/types/device";
  import { effectiveCommon, normalizeStates } from "$lib/config/state-meta";
  import { enumLabelFromObject } from "$lib/config/rooms";
  import { stateIdFor } from "$lib/config/variables";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import MultiSelect from "$lib/components/common/MultiSelect.svelte";

  /**
   * The correction layer (spec §7): what this control's state really is when the
   * broker object is decorated badly. Every field is optional; the effective
   * value is shown as the placeholder, so an untouched field keeps inheriting.
   */
  let {
    control,
    onChange,
  }: {
    control: Control;
    onChange: (c: Control) => void;
  } = $props();

  const object = $derived(
    ioBroker.objects.get(
      stateIdFor(control.stateId ?? "", getVariables()) || "",
    ),
  );
  const meta = $derived(effectiveCommon(control, object));
  const states = $derived(normalizeStates(control.states) ?? meta.states ?? {});

  const roles = $derived(
    [
      ...new Set(
        [...ioBroker.objects.values()]
          .map((o: any) => o?.common?.role)
          .filter((r: unknown): r is string => !!r),
      ),
    ].sort(),
  );
  const roomOptions = $derived(
    (ioBroker.enums?.getList?.("rooms") ?? []).map((e: any) => ({
      value: e._id,
      label: enumLabelFromObject(e),
      icon: e.common?.icon || undefined,
    })),
  );
  const functionOptions = $derived(
    (ioBroker.enums?.getList?.("functions") ?? []).map((e: any) => ({
      value: e._id,
      label: enumLabelFromObject(e),
    })),
  );

  let newValue = $state("");
  let newLabel = $state("");

  function patch(next: Partial<Control>): void {
    onChange({ ...control, ...next });
  }

  function numberOrUndefined(raw: string): number | undefined {
    if (raw.trim() === "") return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }

  function setState(value: string, label: string): void {
    if (!value.trim()) return;
    patch({ states: { ...states, [value]: label } });
  }

  function removeState(value: string): void {
    const next = { ...states };
    delete next[value];
    patch({ states: Object.keys(next).length ? next : undefined });
  }

  function addState(): void {
    if (!newValue.trim()) return;
    setState(newValue, newLabel);
    newValue = "";
    newLabel = "";
  }

  function reset(): void {
    const next = { ...control };
    for (const key of [
      "role",
      "type",
      "states",
      "hideUnit",
      "min",
      "max",
      "step",
      "read",
      "write",
      "room",
      "functions",
      "common",
    ] as const) {
      delete (next as any)[key];
    }
    onChange(next);
  }
</script>

<div class="meta">
  <div class="row">
    <label class="field"
      ><span class="label-mono">Role</span>
      <input
        type="text"
        list="ihome-roles"
        value={control.role ?? ""}
        placeholder={meta.role ?? "— inherit —"}
        oninput={(e) =>
          patch({
            role: e.currentTarget.value.trim() || undefined,
          })}
      /></label
    >
    <datalist id="ihome-roles">
      {#each roles as role (role)}<option value={role}>{role}</option>{/each}
    </datalist>
    <label class="field"
      ><span class="label-mono">Type</span>
      <select
        value={control.type ?? ""}
        onchange={(e) => patch({ type: e.currentTarget.value || undefined })}
      >
        <option value="">— inherit ({meta.type ?? "—"}) —</option>
        {#each ["boolean", "number", "string", "mixed", "array", "object"] as t (t)}
          <option value={t}>{t}</option>
        {/each}
      </select></label
    >
    <label class="check"
      ><input
        type="checkbox"
        checked={control.hideUnit ?? false}
        onchange={(e) => patch({ hideUnit: e.currentTarget.checked })}
      /> hide unit</label
    >
  </div>

  <div class="row">
    <label class="field"
      ><span class="label-mono">Min</span>
      <input
        type="number"
        value={control.min ?? ""}
        placeholder={meta.min !== undefined ? String(meta.min) : ""}
        oninput={(e) =>
          patch({ min: numberOrUndefined(e.currentTarget.value) })}
      /></label
    >
    <label class="field"
      ><span class="label-mono">Max</span>
      <input
        type="number"
        value={control.max ?? ""}
        placeholder={meta.max !== undefined ? String(meta.max) : ""}
        oninput={(e) =>
          patch({ max: numberOrUndefined(e.currentTarget.value) })}
      /></label
    >
    <label class="field"
      ><span class="label-mono">Step</span>
      <input
        type="number"
        value={control.step ?? ""}
        placeholder={meta.step !== undefined ? String(meta.step) : ""}
        oninput={(e) =>
          patch({ step: numberOrUndefined(e.currentTarget.value) })}
      /></label
    >
    <label class="check"
      ><input
        type="checkbox"
        checked={control.read ?? meta.read ?? false}
        onchange={(e) => patch({ read: e.currentTarget.checked })}
      /> readable</label
    >
    <label class="check"
      ><input
        type="checkbox"
        checked={control.write ?? meta.write ?? false}
        onchange={(e) => patch({ write: e.currentTarget.checked })}
      /> state writable (metadata)</label
    >
  </div>

  <div class="row">
    <div class="field grow">
      <span class="label-mono">Room</span>
      <MultiSelect
        options={roomOptions}
        selected={control.room ? [control.room] : []}
        enums={ioBroker.enums}
        multiple={false}
        placeholder="— inherit —"
        onChange={(v) => patch({ room: v[0] })}
      />
    </div>
    <div class="field grow">
      <span class="label-mono">Functions</span>
      <MultiSelect
        options={functionOptions}
        selected={control.functions ?? []}
        enums={ioBroker.enums}
        placeholder="— inherit —"
        onChange={(v) => patch({ functions: v.length ? v : undefined })}
      />
    </div>
  </div>

  <div class="states">
    <span class="label-mono">States (value → label)</span>
    {#each Object.entries(states) as [value, label] (value)}
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
      <button type="button" class="icon-btn" title="Add" onclick={addState}>
        <span class="material-symbols-outlined">add</span>
      </button>
    </div>
    {#if Array.isArray(control.states)}
      <p class="hint text-muted">
        Array form — editing converts it to value → label.
      </p>
    {/if}
  </div>

  <div class="row">
    <button type="button" class="btn small" onclick={reset}>
      Reset overrides
    </button>
    <span class="hint text-muted">
      A set field wins over the broker object; empty inherits.
    </span>
  </div>
</div>

<style>
  .meta {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding-top: 0.4rem;
    border-top: 1px dashed var(--border-color);
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    min-width: 6rem;
  }

  .field.grow {
    flex: 1 1 12rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.85rem;
  }

  .states {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .state-row {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .state-row input:first-child {
    width: 5rem;
  }

  .state-row input:nth-child(2) {
    flex: 1 1 auto;
  }

  .hint {
    font-size: 0.8rem;
  }

  .btn.small {
    padding: 0.2rem 0.5rem;
    font-size: 0.85rem;
  }
</style>
