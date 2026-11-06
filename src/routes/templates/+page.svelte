<script lang="ts">
  import { page } from "$app/state";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
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

  /** The app is hash-routed, so `?type=` lives inside `page.url.hash`. */
  function requestedKind(): string | null {
    const hash = page.url.hash;
    const hashQuery = hash.includes("?")
      ? hash.slice(hash.indexOf("?") + 1)
      : "";
    return (
      page.url.searchParams.get("type") ??
      new URLSearchParams(hashQuery).get("type")
    );
  }

  const fromQuery = requestedKind();
  let kind = $state<Kind>(
    kinds.some((entry) => entry.id === fromQuery)
      ? (fromQuery as Kind)
      : "formula",
  );
  let dirty = $state(false);
  let pendingKind = $state<Kind | null>(null);
  let askSwitch = $state(false);
  let logicDeviceOpen = $state(false);

  function go(next: Kind) {
    dirty = false;
    kind = next;
  }

  function requestKind(next: Kind) {
    if (next === kind) return;
    if (dirty) {
      pendingKind = next;
      askSwitch = true;
      return;
    }
    go(next);
  }
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
        onclick={() => requestKind(entry.id)}
      >
        {entry.label}
      </button>
    {/each}
  </nav>

  {#if kind === "formula"}
    <FormulaTemplates bind:dirty />
  {:else if kind === "function"}
    <FunctionTemplates bind:dirty />
  {:else if kind === "device"}
    <VisualTemplates bind:dirty />
  {:else if kind === "logic"}
    <LogicTemplates bind:dirty />
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

  {#if askSwitch}
    <ConfirmModal
      title="Discard unsaved changes?"
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      onConfirm={() => {
        askSwitch = false;
        const next = pendingKind;
        pendingKind = null;
        if (next) go(next);
      }}
      onCancel={() => {
        askSwitch = false;
        pendingKind = null;
      }}
    />
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
