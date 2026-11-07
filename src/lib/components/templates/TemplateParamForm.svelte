<script lang="ts">
  import StateRefField from "$lib/components/logic/StateRefField.svelte";
  import type { TemplateParam } from "$logic/types";

  let {
    params,
    values = $bindable({}),
  }: {
    params: TemplateParam[];
    values?: Record<string, string | number | boolean>;
  } = $props();
</script>

{#each params as param (param.name)}
  <div class="row">
    <span class="label-mono param-label">{param.label}</span>
    {#if param.type === "state"}
      <StateRefField
        value={String(values[param.name] ?? "")}
        label={param.label}
        onchange={(ref) => (values = { ...values, [param.name]: ref })}
      />
    {:else if param.type === "number"}
      <input
        type="number"
        aria-label={param.label}
        value={String(values[param.name] ?? "")}
        onchange={(e) =>
          (values = {
            ...values,
            [param.name]: Number(e.currentTarget.value),
          })}
      />
    {:else if param.type === "boolean"}
      <input
        type="checkbox"
        aria-label={param.label}
        checked={values[param.name] === true}
        onchange={(e) =>
          (values = {
            ...values,
            [param.name]: e.currentTarget.checked,
          })}
      />
    {:else}
      <input
        aria-label={param.label}
        placeholder={param.type === "duration" ? "2m" : ""}
        value={String(values[param.name] ?? "")}
        onchange={(e) =>
          (values = {
            ...values,
            [param.name]: e.currentTarget.value,
          })}
      />
    {/if}
  </div>
{/each}

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .param-label {
    min-width: 8rem;
  }
</style>
