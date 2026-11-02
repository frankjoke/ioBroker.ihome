<script lang="ts">
  import IconButton from "$lib/components/common/IconButton.svelte";
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";

  /** Several states bound to one input name: a button in the corridor and one
   *  by the door both arrive as the same local event. */
  let {
    value,
    label,
    onchange,
    logics = [],
    selfId = "",
  }: {
    value: string[];
    label: string;
    onchange: (ids: string[]) => void;
    /** Other logics, selectable as `$logic.<id>` sources (D29). */
    logics?: { id: string; name: string }[];
    selfId?: string;
  } = $props();

  let picking = $state(false);
  const logicOptions = $derived(
    logics.filter((source) => source.id !== selfId),
  );

  function remove(id: string) {
    onchange(value.filter((entry) => entry !== id));
  }

  function add(id: string) {
    if (!value.includes(id)) onchange([...value, id]);
  }

  /** A logic source reads by name; a state keeps its id. */
  function chipLabel(id: string): string {
    if (!id.startsWith("$logic.")) return id;
    const sourceId = id.slice("$logic.".length);
    return logics.find((source) => source.id === sourceId)?.name ?? sourceId;
  }
</script>

<div class="multi-state">
  {#each value as id (id)}
    <span class="chip">
      <span class="mono" title={id}>{chipLabel(id)}</span>
      <button
        type="button"
        class="chip-x"
        aria-label={`Remove ${id}`}
        title="Remove"
        onclick={() => remove(id)}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </span>
  {/each}
  <IconButton
    icon="add"
    label={`Add a state to ${label}`}
    title="Add state"
    onclick={() => (picking = true)}
  />
  {#if logicOptions.length}
    <select
      class="logic-add"
      aria-label={`Add a logic event to ${label}`}
      value=""
      onchange={(e) => {
        const id = e.currentTarget.value;
        if (id) add(id);
        e.currentTarget.value = "";
      }}
    >
      <option value="">+ logic event</option>
      {#each logicOptions as source (source.id)}
        <option value={`$logic.${source.id}`}>{source.name}</option>
      {/each}
    </select>
  {/if}
</div>

{#if picking}
  <SourcePicker
    mode="state"
    title={label}
    onState={(id) => {
      add(id);
      picking = false;
    }}
    onClose={() => (picking = false)}
  />
{/if}

<style>
  .multi-state {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.15rem 0.2rem 0.15rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill, 999px);
    background: var(--surface-container);
    font-size: var(--body-sm);
  }

  .chip-x {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .chip-x:hover {
    background: var(--surface-container-high);
    color: var(--text-color);
  }

  .logic-add {
    max-width: 12rem;
    font-size: var(--body-sm);
  }

  .chip-x .material-symbols-outlined {
    font-size: 1rem;
  }
</style>
