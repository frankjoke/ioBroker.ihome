<script lang="ts">
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import { variableNameFor } from "$lib/config/variables";
  import { getVariables } from "$lib/stores/variables.svelte";
  import type { LogicDef } from "$logic/types";

  let {
    value,
    label = "State",
    onchange,
    logics = [],
  }: {
    value: string;
    label?: string;
    onchange: (id: string) => void;
    /** The document's logics, for the picker's Logic tab. */
    logics?: LogicDef[];
  } = $props();

  let picking = $state(false);
  const shown = $derived(value ? variableNameFor(value, getVariables()) : "");
</script>

<div class="ref-field">
  <button
    type="button"
    class="btn btn-sm source-pick"
    title={value ? `Source: ${value} — click to change` : "Choose a state"}
    onclick={() => (picking = true)}
  >
    <Icon value="edit" size={15} />
    <span class="source-name">{shown || "Select…"}</span>
  </button>
  {#if value}
    <IconButton
      icon="close"
      label={`Clear ${label}`}
      title="Clear"
      onclick={() => onchange("")}
    />
  {/if}
</div>

{#if picking}
  <SourcePicker
    mode="state"
    title={label}
    {logics}
    logicPick="state"
    onState={(id) => {
      onchange(id);
      picking = false;
    }}
    onClose={() => (picking = false)}
  />
{/if}

<style>
  .ref-field {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex: 1 1 240px;
    min-width: 0;
  }

  .source-pick {
    flex: 1 1 auto;
    min-width: 0;
    justify-content: flex-start;
  }

  .source-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
