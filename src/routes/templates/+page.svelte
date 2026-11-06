<script lang="ts">
  import { page } from "$app/state";
  import FormulaTemplates from "$lib/components/templates/FormulaTemplates.svelte";
  import FunctionTemplates from "$lib/components/templates/FunctionTemplates.svelte";

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
</style>
