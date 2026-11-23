<script lang="ts">
  import { untrack } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { formatValue, localizeName } from "$lib/config/format";

  const TYPES = [
    "boolean",
    "number",
    "string",
    "mixed",
    "object",
    "array",
    "json",
  ];

  interface Draft {
    name: string;
    type: string;
    role: string;
    unit: string;
    desc: string;
    min: string;
    max: string;
    step: string;
    read: boolean;
    write: boolean;
  }

  let {
    id,
    object,
    live,
    onchanged,
  }: {
    id: string;
    object: any;
    live: any;
    onchanged: () => void;
  } = $props();

  function draftOf(common: Record<string, any>): Draft {
    return {
      name: localizeName(common.name),
      type: String(common.type ?? ""),
      role: String(common.role ?? ""),
      unit: String(common.unit ?? ""),
      desc: String(common.desc ?? ""),
      min: common.min === undefined ? "" : String(common.min),
      max: common.max === undefined ? "" : String(common.max),
      step: common.step === undefined ? "" : String(common.step),
      read: common.read !== false,
      write: common.write === true,
    };
  }

  // The component is keyed by state id; it intentionally snapshots the object.
  let draft = $state<Draft>(
    untrack(() => draftOf((object?.common ?? {}) as Record<string, any>)),
  );
  let saved = $state<Draft>(untrack(() => ({ ...draft })));
  let busy = $state(false);
  let error = $state("");

  const dirty = $derived(JSON.stringify(draft) !== JSON.stringify(saved));
  const common = $derived((object?.common ?? {}) as Record<string, any>);
  const managed = $derived<string | undefined>(
    object?.native?.ihomeCollection?.plugin,
  );

  function numberOrNull(text: string): number | null | string {
    const value = text.trim();
    if (!value) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : text;
  }

  async function save(): Promise<void> {
    const name = draft.name.trim();
    if (name !== saved.name && !name) {
      error = "The state name must not be empty.";
      return;
    }
    if (draft.type !== saved.type && !draft.type) {
      error = "Choose a state type.";
      return;
    }
    const min = numberOrNull(draft.min);
    const max = numberOrNull(draft.max);
    const step = numberOrNull(draft.step);
    if (typeof min === "string") {
      error = "Min must be a number.";
      return;
    }
    if (typeof max === "string") {
      error = "Max must be a number.";
      return;
    }
    if (typeof step === "string") {
      error = "Step must be a number.";
      return;
    }
    if (min !== null && max !== null && min > max) {
      error = "Min must not be greater than max.";
      return;
    }
    const patch: Record<string, unknown> = {};
    if (name !== saved.name) patch.name = name;
    if (draft.type !== saved.type) patch.type = draft.type;
    if (draft.role !== saved.role) patch.role = draft.role;
    if (draft.unit !== saved.unit) patch.unit = draft.unit;
    if (draft.desc !== saved.desc) patch.desc = draft.desc;
    if (draft.min !== saved.min) patch.min = min;
    if (draft.max !== saved.max) patch.max = max;
    if (draft.step !== saved.step) patch.step = step;
    if (draft.read !== saved.read) patch.read = draft.read;
    if (draft.write !== saved.write) patch.write = draft.write;
    if (Object.keys(patch).length === 0) return;
    busy = true;
    error = "";
    try {
      const reply = (await ioBroker.sendTo(ioBroker.namespace, "states", {
        action: "common.write",
        id,
        common: patch,
      })) as { ok?: boolean; error?: string } | undefined;
      if (!reply?.ok) {
        throw new Error(reply?.error ?? "The adapter rejected the change.");
      }
      saved = { ...draft, name };
      onchanged();
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      busy = false;
    }
  }

  function reset(): void {
    draft = { ...saved };
    error = "";
  }
</script>

<div class="state-general">
  <p class="hint text-muted">
    Written to the state object. Most adapters keep these; a managed adapter or
    plugin may overwrite them later.
  </p>
  {#if managed}
    <p class="hint text-muted">
      This state is managed by plugin <span class="mono">{managed}</span>; a
      plugin update may reset these fields.
    </p>
  {/if}

  <div class="grid">
    <label class="field">
      <span class="label-mono">Name</span>
      <input bind:value={draft.name} />
    </label>
    <label class="field">
      <span class="label-mono">Type</span>
      <select bind:value={draft.type}>
        {#each TYPES as type (type)}
          <option value={type}>{type}</option>
        {/each}
        {#if draft.type && !TYPES.includes(draft.type)}
          <option value={draft.type}>{draft.type}</option>
        {/if}
      </select>
    </label>
    <label class="field">
      <span class="label-mono">Role</span>
      <input class="mono" bind:value={draft.role} />
    </label>
    <label class="field">
      <span class="label-mono">Unit</span>
      <input bind:value={draft.unit} />
    </label>
    <label class="field wide">
      <span class="label-mono">Description</span>
      <input bind:value={draft.desc} />
    </label>
  </div>

  <div class="three">
    <label class="field">
      <span class="label-mono">Min</span>
      <input inputmode="decimal" bind:value={draft.min} />
    </label>
    <label class="field">
      <span class="label-mono">Max</span>
      <input inputmode="decimal" bind:value={draft.max} />
    </label>
    <label class="field">
      <span class="label-mono">Step</span>
      <input inputmode="decimal" bind:value={draft.step} />
    </label>
  </div>

  <div class="checks">
    <label class="check">
      <input type="checkbox" bind:checked={draft.read} />
      <span>Read</span>
    </label>
    <label class="check">
      <input type="checkbox" bind:checked={draft.write} />
      <span>Write</span>
    </label>
  </div>

  <div class="actions">
    <button
      type="button"
      class="btn btn-sm"
      disabled={!dirty || busy}
      onclick={reset}>Reset</button
    >
    <button
      type="button"
      class="btn btn-primary btn-sm"
      disabled={!dirty || busy}
      onclick={() => void save()}>{busy ? "Saving…" : "Save"}</button
    >
  </div>

  {#if error}<p class="hint text-danger">{error}</p>{/if}

  <dl class="summary">
    <dt>Value</dt>
    <dd class="mono">
      {formatValue(live?.val, common.unit, common.role)}
      {#if live?.from}<span class="text-muted"> · {live.from}</span>{/if}
    </dd>
  </dl>
</div>

<style>
  .state-general {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    min-width: 0;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .wide {
    grid-column: 1 / -1;
  }

  .three {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  .checks {
    display: flex;
    flex-wrap: wrap;
    gap: 1rem;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.4rem;
  }

  .summary {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.3rem 0.8rem;
    margin: 0;
  }

  .summary dt {
    color: var(--text-muted);
    font-size: var(--body-sm);
  }

  .summary dd {
    margin: 0;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  @media (max-width: 560px) {
    .grid,
    .three {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
