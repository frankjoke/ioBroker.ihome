<script lang="ts">
  import { onMount } from "svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import DevicePicker from "$lib/components/layout/DevicePicker.svelte";
  import LayoutDetails from "$lib/components/layout/LayoutDetails.svelte";
  import LayoutTree from "$lib/components/layout/LayoutTree.svelte";
  import SlotPicker from "$lib/components/layout/SlotPicker.svelte";
  import { takeRequestedLayout } from "$lib/pages.js";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { roomList } from "$lib/config/rooms";
  import {
    addPage,
    appendDevices,
    deletePage,
    deleteSection,
    type LayoutSelection,
    type PlacementAnchor,
  } from "$lib/config/layout-ops";
  import { addSlot, editTile } from "$lib/config/tile-ops";
  import {
    commitLayout,
    getLayoutSaveFailed,
    getPageRegistry,
    isLayoutWritable,
  } from "$lib/stores/pages.svelte.js";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { devicesEnrichedStore } from "$lib/stores/devices";
  import type { EnrichedDevice } from "$lib/types/device";
  import type { Slot } from "$lib/types/display";

  let selection = $state<LayoutSelection | null>(null);
  /** The handoff target, applied by the tree once (folding); selection stays. */
  let focus = $state<LayoutSelection | null>(null);
  let pendingDelete = $state<LayoutSelection | null>(null);
  let pickerFor = $state<
    | { kind: "device"; pageId: string; sectionId: string }
    | { kind: "slot"; anchor: PlacementAnchor }
    | null
  >(null);

  const registry = $derived(getPageRegistry());
  const devices = $derived($devicesEnrichedStore);
  const rooms = $derived(roomList(ioBroker.enums));
  const saveFailed = $derived(getLayoutSaveFailed());
  // No document has been read (or it is unreadable): every write is refused, so
  // the editor says so rather than looking like it works.
  const writable = $derived(isLayoutWritable());

  // A tile (or a section/page) on the display handed us its address (Ctrl/Cmd+
  // click): select it — and fold the tree to it — so the pane opens on what was
  // clicked. Clicking in the tree later changes only `selection`, never folding.
  onMount(() => {
    const requested = takeRequestedLayout();
    if (requested) {
      selection = requested;
      focus = requested;
    }
  });

  /** The device a tile's placement points at, if it is still in the registry. */
  function deviceOfAnchor(anchor: PlacementAnchor): EnrichedDevice | undefined {
    const placement = registry.pages
      .find((p) => p.id === anchor.pageId)
      ?.groups.find((g) => g.id === anchor.sectionId)
      ?.tiles?.find((t) => t.id === anchor.placementId);
    return placement
      ? devices.find((d) => d.id === placement.device)
      : undefined;
  }

  /** A dangling device is refused: the tree already warns on the row. */
  function openSlotPicker(anchor: PlacementAnchor): void {
    if (!deviceOfAnchor(anchor)) return;
    pickerFor = { kind: "slot", anchor };
  }

  function addSlotTo(anchor: PlacementAnchor, slot: Slot): void {
    const device = deviceOfAnchor(anchor);
    if (!device) return;
    commitLayout(
      editTile(registry, anchor, device, getTemplateRegistry().templates, (t) =>
        addSlot(t, slot),
      ),
    );
    pickerFor = null;
  }

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
    {:else if !writable}
      <span
        class="badge badge-danger"
        title="The page document could not be read from the broker, so nothing is written back. Check the connection, then reload."
        >not editable</span
      >
    {/if}
    <button
      type="button"
      class="icon-btn primary"
      title={writable
        ? "Add page"
        : "Not editable: the page document did not load"}
      aria-label="Add page"
      disabled={!writable}
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
        {focus}
        onSelect={(next) => (selection = next)}
        onChange={commitLayout}
        onDelete={(target) => (pendingDelete = target)}
        onAddTile={(pageId, sectionId) =>
          (pickerFor = { kind: "device", pageId, sectionId })}
        onAddSlot={(pageId, sectionId, placementId) =>
          openSlotPicker({ pageId, sectionId, placementId })}
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
  {#if target.kind === "device"}
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
  {:else}
    {@const device = deviceOfAnchor(target.anchor)}
    {#if device}
      <SlotPicker
        {device}
        onAdd={(slot) => addSlotTo(target.anchor, slot)}
        onClose={() => (pickerFor = null)}
      />
    {/if}
  {/if}
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
