<script lang="ts">
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";

  let {
    value,
    label = "State",
    onchange,
  }: {
    value: string;
    label?: string;
    onchange: (id: string) => void;
  } = $props();

  let picking = $state(false);
</script>

<div class="ref-field">
  <input
    class="mono"
    {value}
    placeholder="state id or variable name"
    aria-label={label}
    onchange={(e) => onchange(e.currentTarget.value.trim())}
  />
  <button type="button" class="btn btn-sm" onclick={() => (picking = true)}>
    Browse
  </button>
</div>

{#if picking}
  <SourcePicker
    mode="state"
    title={label}
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
  }

  .ref-field input {
    flex: 1 1 auto;
    min-width: 120px;
  }
</style>
