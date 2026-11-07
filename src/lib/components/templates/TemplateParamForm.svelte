<script lang="ts">
  import StateRefField from "$lib/components/logic/StateRefField.svelte";
  import type { ApplyParam } from "$lib/config/template-apply";

  let {
    params,
    values = $bindable({}),
  }: {
    params: ApplyParam[];
    values?: Record<string, string | number | boolean>;
  } = $props();
</script>

{#each params as param (param.name)}
  <div class="param">
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
    {#if param.description}
      <p class="param-help text-muted">{param.description}</p>
    {/if}
  </div>
{/each}

<style>
  .param {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .param-label {
    min-width: 8rem;
  }

  .param-help {
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
