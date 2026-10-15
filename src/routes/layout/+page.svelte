<script lang="ts">
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import LayoutTree from "$lib/components/layout/LayoutTree.svelte";
  import {
    addPage,
    deletePage,
    deleteSection,
    type LayoutSelection,
  } from "$lib/config/layout-ops";
  import {
    commitLayout,
    getLayoutSaveFailed,
    getPageRegistry,
  } from "$lib/stores/pages.svelte.js";
  import { devicesEnrichedStore } from "$lib/stores/devices";

  let selection = $state<LayoutSelection | null>(null);
  let pendingDelete = $state<LayoutSelection | null>(null);

  const registry = $derived(getPageRegistry());
  const devices = $derived($devicesEnrichedStore);
  const saveFailed = $derived(getLayoutSaveFailed());

  function confirmDelete(): void {
    const target = pendingDelete;
    pendingDelete = null;
    if (!target) return;
    if (target.kind === "page") {
      commitLayout(deletePage(registry, target.pageId));
    } else if (target.kind === "section") {
      commitLayout(deleteSection(registry, target.pageId, target.sectionId));
    }
  }

  function deleteTitle(target: LayoutSelection | null): string {
    if (target?.kind === "page") {
      const page = registry.pages.find((p) => p.id === target.pageId);
      return `Delete “${page?.title || "page"}”?`;
    }
    if (target?.kind === "section") {
      const section = registry.pages
        .find((p) => p.id === target.pageId)
        ?.groups.find((g) => g.id === target.sectionId);
      return `Delete “${section?.title || "section"}”?`;
    }
    return "Delete?";
  }
</script>

<svelte:head>
  <title>Layout - iHome</title>
</svelte:head>

<div class="layout-page">
  <div class="page-header">
    <div class="page-heading">
      <span class="label-mono">Configuration</span>
      <h1>Layout</h1>
    </div>
    {#if saveFailed}
      <span class="badge badge-danger" title="The last write to pageList failed"
        >not saved</span
      >
    {/if}
    <button
      type="button"
      class="icon-btn primary"
      title="Add page"
      aria-label="Add page"
      onclick={() => commitLayout(addPage(registry))}
    >
      <span class="material-symbols-outlined">add</span>
    </button>
  </div>

  <div class="cols">
    <div class="card tree-card">
      <LayoutTree
        {registry}
        {devices}
        {selection}
        onSelect={(next) => (selection = next)}
        onChange={commitLayout}
        onDelete={(target) => (pendingDelete = target)}
      />
    </div>

    <aside class="card details-card">
      {#if selection}
        <p class="label-mono">{selection.kind}</p>
        <p class="text-muted">
          The fields for this {selection.kind} come next.
        </p>
      {:else}
        <p class="text-muted">Select a page, a section or a tile.</p>
      {/if}
    </aside>
  </div>
</div>

{#if pendingDelete}
  <ConfirmModal
    title={deleteTitle(pendingDelete)}
    confirmLabel="Delete"
    onConfirm={confirmDelete}
    onCancel={() => (pendingDelete = null)}
  >
    The tiles disappear from this page. The devices themselves stay in the
    registry.
  </ConfirmModal>
{/if}

<style>
  .layout-page {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .page-header {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .page-heading {
    flex: 1 1 auto;
  }

  .cols {
    display: grid;
    grid-template-columns: minmax(280px, 1fr) minmax(260px, 1fr);
    gap: 1rem;
    align-items: start;
  }

  @media (max-width: 820px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }

  .tree-card,
  .details-card {
    padding: 0.75rem;
    min-width: 0;
  }
</style>
