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
    logicTrigger = false,
  }: {
    value: string;
    label?: string;
    onchange: (id: string) => void;
    /** The document's logics, for the picker's Logic tab. */
    logics?: LogicDef[];
    /** Offer logics as `$logic.<id>` sources (a logic input) instead of their
     *  output state (a template parameter). */
    logicTrigger?: boolean;
  } = $props();

  let picking = $state(false);
  /** A logic source reads by name; a state keeps its id. */
  const shown = $derived.by(() => {
    if (!value) return "";
    if (!value.startsWith("$logic."))
      return variableNameFor(value, getVariables());
    const id = value.slice("$logic.".length);
    return logics.find((logic) => logic.id === id)?.name ?? id;
  });
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
    logicPick={logicTrigger ? "trigger" : "state"}
    currentState={value}
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
    /* A column field (InputsEditor, TemplateInsert) must not turn 240px into a
       height — the button stays one line and the row fills the width. */
    flex: 0 1 auto;
    width: 100%;
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
