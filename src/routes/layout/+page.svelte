<script lang="ts">
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import DevicePicker from "$lib/components/layout/DevicePicker.svelte";
  import LayoutDetails from "$lib/components/layout/LayoutDetails.svelte";
  import LayoutTree from "$lib/components/layout/LayoutTree.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { roomList } from "$lib/config/rooms";
  import {
    addPage,
    appendDevices,
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
  let pickerFor = $state<{ pageId: string; sectionId: string } | null>(null);

  const registry = $derived(getPageRegistry());
  const devices = $derived($devicesEnrichedStore);
  const rooms = $derived(roomList(ioBroker.enums));
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
        onAddTile={(pageId, sectionId) => (pickerFor = { pageId, sectionId })}
      />
    </div>

    <aside class="card details-card">
      {#if selection}
        <LayoutDetails
          {registry}
          {devices}
          {selection}
          onChange={commitLayout}
        />
      {:else}
        <p class="text-muted">Select a page, a section or a tile.</p>
      {/if}
    </aside>
  </div>
</div>

{#if pickerFor}
  {@const target = pickerFor}
  <DevicePicker
    {devices}
    {rooms}
    enums={ioBroker.enums}
    listed={(
      registry.pages
        .find((p) => p.id === target.pageId)
        ?.groups.find((g) => g.id === target.sectionId)?.tiles ?? []
    ).map((t) => t.device)}
    onAdd={(deviceIds) => {
      commitLayout(
        appendDevices(registry, target.pageId, target.sectionId, deviceIds),
      );
      pickerFor = null;
    }}
    onClose={() => (pickerFor = null)}
  />
{/if}

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
