<script lang="ts">
  import { page } from "$app/state";
  import FormulaTemplates from "$lib/components/templates/FormulaTemplates.svelte";
  import FunctionTemplates from "$lib/components/templates/FunctionTemplates.svelte";
  import VisualTemplates from "$lib/components/templates/VisualTemplates.svelte";
  import LogicTemplates from "$lib/components/templates/LogicTemplates.svelte";
  import LogicDeviceTemplates from "$lib/components/templates/LogicDeviceTemplates.svelte";

  type Kind = "formula" | "function" | "device" | "logic" | "logic-device";

  const kinds: Array<{ id: Kind; label: string }> = [
    { id: "formula", label: "Formula" },
    { id: "function", label: "Function" },
    { id: "device", label: "Device" },
    { id: "logic", label: "Logic" },
    { id: "logic-device", label: "Logic + device" },
  ];
  const fromQuery = page.url.searchParams.get("type");
  let kind = $state<Kind>(
    kinds.some((entry) => entry.id === fromQuery)
      ? (fromQuery as Kind)
      : "formula",
  );
  let logicDeviceOpen = $state(false);
</script>

<svelte:head>
  <title>Templates - iHome</title>
</svelte:head>

<div class="templates-page">
  <div class="page-heading">
    <h1>Templates</h1>
  </div>

  <nav class="type-tabs" aria-label="Template type">
    {#each kinds as entry (entry.id)}
      <button
        type="button"
        class="btn btn-sm"
        class:btn-primary={kind === entry.id}
        aria-current={kind === entry.id ? "page" : undefined}
        onclick={() => (kind = entry.id)}
      >
        {entry.label}
      </button>
    {/each}
  </nav>

  {#if kind === "formula"}
    <FormulaTemplates />
  {:else if kind === "function"}
    <FunctionTemplates />
  {:else if kind === "device"}
    <VisualTemplates />
  {:else if kind === "logic"}
    <LogicTemplates />
  {:else if kind === "logic-device"}
    <div class="card logic-device-card">
      <p class="text-muted">
        API templates that generate states, a machine and an optional device.
      </p>
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onclick={() => (logicDeviceOpen = true)}
      >
        Open logic + device templates
      </button>
    </div>
    {#if logicDeviceOpen}
      <LogicDeviceTemplates
        open={logicDeviceOpen}
        onClose={() => (logicDeviceOpen = false)}
        onGenerated={() => (logicDeviceOpen = false)}
      />
    {/if}
  {:else}
    <p class="text-muted">This template type is being added.</p>
  {/if}
</div>

<style>
  .templates-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .type-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .logic-device-card {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.5rem;
    max-width: 640px;
    margin: 0 auto;
    width: 100%;
  }
</style>
