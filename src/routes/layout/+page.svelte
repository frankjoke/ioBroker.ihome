<script lang="ts">
  import { onMount } from "svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import PageView from "$lib/components/display/PageView.svelte";
  import DevicePicker from "$lib/components/layout/DevicePicker.svelte";
  import LayoutDetails from "$lib/components/layout/LayoutDetails.svelte";
  import SlotPicker from "$lib/components/layout/SlotPicker.svelte";
  import { takeRequestedLayout } from "$lib/pages.js";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { roomList } from "$lib/config/rooms";
  import {
    addPage,
    addSection,
    appendDevices,
    deletePage,
    deletePlacement,
    deleteSection,
    duplicatePlacement,
    duplicateSection,
    movePlacement,
    patchPlacement,
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
  import type { PageRegistry, Slot } from "$lib/types/display";

  let selection = $state<LayoutSelection | null>(null);
  let pendingDelete = $state<LayoutSelection | null>(null);
  /** Change device: the anchor whose device is being swapped, then the confirm. */
  let swapFor = $state<PlacementAnchor | null>(null);
  let pendingSwap = $state<{
    anchor: PlacementAnchor;
    deviceId: string;
    oldName: string;
  } | null>(null);
  let pickerFor = $state<
    | { kind: "device"; pageId: string; sectionId: string; at?: number }
    | { kind: "slot"; anchor: PlacementAnchor; at?: number }
    | null
  >(null);

  const registry = $derived(getPageRegistry());
  const devices = $derived($devicesEnrichedStore);
  const rooms = $derived(roomList(ioBroker.enums));
  const saveFailed = $derived(getLayoutSaveFailed());
  // No document has been read (or it is unreadable): every write is refused, so
  // the editor says so rather than looking like it works.
  const writable = $derived(isLayoutWritable());

  // ------------------------------------------------ the drill-down (spike B)
  // Page → section → the section's tiles. The selection leads: the selectors
  // follow it and picking in one sets it. No tree and no second pane.
  let pageOpen = $state(false);
  let sectionOpen = $state(false);

  /** The page being edited: the selection's, else the first. */
  const page = $derived(
    registry.pages.find((p) => p.id === selection?.pageId) ?? registry.pages[0],
  );
  const pageId = $derived(page?.id ?? "");
  /** The section a non-page selection points into, if any. */
  const selectedSectionId = $derived(
    selection && selection.kind !== "page" ? selection.sectionId : undefined,
  );
  /** The section being edited: the selection's, else the page's first. */
  const section = $derived(
    page?.groups.find((g) => g.id === selectedSectionId) ?? page?.groups[0],
  );
  const sectionId = $derived(section?.id ?? "");
  const tiles = $derived(section?.tiles ?? []);
  /** The tile whose editor is open, if the selection is one. */
  const tileSelection = $derived(selection?.kind === "tile" ? selection : null);

  function selectPage(id: string): void {
    selection = { kind: "page", pageId: id };
  }

  function selectSection(id: string): void {
    selection = { kind: "section", pageId, sectionId: id };
  }

  // A tile (or a section/page) on the display handed us its address (Ctrl/Cmd+
  // click): select it, so the drill-down opens on what was clicked.
  onMount(() => {
    const requested = takeRequestedLayout();
    if (requested) selection = requested;
  });

  /** The placement a tree/pane address points at, if it still exists. */
  function placementOfAnchor(anchor: PlacementAnchor) {
    return registry.pages
      .find((p) => p.id === anchor.pageId)
      ?.groups.find((g) => g.id === anchor.sectionId)
      ?.tiles?.find((t) => t.id === anchor.placementId);
  }

  /** The device a tile's placement points at, if it is still in the registry. */
  function deviceOfAnchor(anchor: PlacementAnchor): EnrichedDevice | undefined {
    const placement = placementOfAnchor(anchor);
    return placement
      ? devices.find((d) => d.id === placement.device)
      : undefined;
  }

  /** A dangling device is refused: the tree already warns on the row. `at`
   * inserts the new slot there instead of appending (the list-end `+`). */
  function openSlotPicker(anchor: PlacementAnchor, at?: number): void {
    if (!deviceOfAnchor(anchor)) return;
    pickerFor = { kind: "slot", anchor, at };
  }

  function addSlotTo(anchor: PlacementAnchor, slot: Slot, at?: number): void {
    const device = deviceOfAnchor(anchor);
    if (!device) return;
    commitLayout(
      editTile(registry, anchor, device, getTemplateRegistry().templates, (t) =>
        addSlot(t, slot, at),
      ),
    );
    pickerFor = null;
  }

  /** The device picker's add: place them, then select the first new tile, so the
   * tree opens its section and the pane shows it ready for its slots (A40). */
  function addDevicesTo(
    pageId: string,
    sectionId: string,
    deviceIds: string[],
    at?: number,
  ): void {
    const sectionIn = (reg: PageRegistry) =>
      reg.pages
        .find((p) => p.id === pageId)
        ?.groups.find((g) => g.id === sectionId);
    const before = new Set((sectionIn(registry)?.tiles ?? []).map((t) => t.id));
    const next = appendDevices(registry, pageId, sectionId, deviceIds, at);
    commitLayout(next);
    pickerFor = null;
    const added = sectionIn(next)?.tiles.find((t) => !before.has(t.id));
    if (added) {
      selection = { kind: "tile", pageId, sectionId, placementId: added.id };
    }
  }

  /** Change device (A25): a materialised tile asks first — its own config goes. */
  function pickSwapDevice(deviceId: string): void {
    const anchor = swapFor;
    swapFor = null;
    if (!anchor) return;
    const placement = placementOfAnchor(anchor);
    if (!placement) return;
    if (placement.tile) {
      const oldName =
        devices.find((d) => d.id === placement.device)?.name ??
        placement.device;
      pendingSwap = { anchor, deviceId, oldName };
      return;
    }
    applySwap(anchor, deviceId);
  }

  function applySwap(anchor: PlacementAnchor, deviceId: string): void {
    commitLayout(
      patchPlacement(
        registry,
        anchor.pageId,
        anchor.sectionId,
        anchor.placementId,
        { device: deviceId, tile: undefined },
      ),
    );
    pendingSwap = null;
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
  <!-- The page being edited, rendered by the display itself: it *is* the
       preview (spike B). Inert, so nothing on the wall switches by accident. -->
  <div class="stage">
    {#if page}
      <PageView {page} />
    {:else}
      <p class="empty text-muted">
        No pages yet. They are created from your rooms and functions on first
        load.
      </p>
    {/if}
  </div>

  <aside class="sheet" aria-label="Layout editor">
    <header class="sheet-head">
      <span class="label-mono">Layout</span>
      {#if saveFailed}
        <span
          class="badge badge-danger"
          title="The last write to pageList failed">not saved</span
        >
      {:else if !writable}
        <span
          class="badge badge-danger"
          title="The page document could not be read from the broker, so nothing is written back. Check the connection, then reload."
          >not editable</span
        >
      {/if}
      {#if registry.pages.length === 0}
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
      {/if}
    </header>

    <!-- Page: a selector; its own attributes live behind the fold-out. -->
    <div class="line">
      <span class="label-mono">Page</span>
      <select
        value={pageId}
        aria-label="Page"
        onchange={(e) => selectPage(e.currentTarget.value)}
      >
        {#each registry.pages as p (p.id)}
          <option value={p.id}>{p.title || p.id}</option>
        {/each}
      </select>
      <button
        type="button"
        class="icon-btn"
        class:on={pageOpen}
        title="Page settings"
        aria-label="Page settings"
        aria-expanded={pageOpen}
        onclick={() => (pageOpen = !pageOpen)}
      >
        <span class="material-symbols-outlined">tune</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        title="Add page"
        aria-label="Add page"
        onclick={() => commitLayout(addPage(registry))}
      >
        <span class="material-symbols-outlined">add</span>
      </button>
      <button
        type="button"
        class="icon-btn danger"
        title="Delete page"
        aria-label="Delete page"
        onclick={() => (pendingDelete = { kind: "page", pageId })}
      >
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>
    {#if pageOpen && page}
      <div class="fold">
        <LayoutDetails
          {registry}
          {devices}
          selection={{ kind: "page", pageId }}
          onChange={commitLayout}
          onSelect={(next) => (selection = next)}
          showPreview={false}
        />
      </div>
    {/if}

    <!-- Section: the same, scoped to the page above. -->
    <div class="line">
      <span class="label-mono">Section</span>
      <select
        value={sectionId}
        aria-label="Section"
        onchange={(e) => selectSection(e.currentTarget.value)}
      >
        {#each page?.groups ?? [] as g (g.id)}
          <option value={g.id}>{g.title || g.id}</option>
        {/each}
      </select>
      <button
        type="button"
        class="icon-btn"
        class:on={sectionOpen}
        title="Section settings"
        aria-label="Section settings"
        aria-expanded={sectionOpen}
        onclick={() => (sectionOpen = !sectionOpen)}
      >
        <span class="material-symbols-outlined">tune</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        title="Add section"
        aria-label="Add section"
        onclick={() => commitLayout(addSection(registry, pageId))}
      >
        <span class="material-symbols-outlined">add</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        title="Duplicate section"
        aria-label="Duplicate section"
        onclick={() =>
          commitLayout(duplicateSection(registry, pageId, sectionId))}
      >
        <span class="material-symbols-outlined">content_copy</span>
      </button>
      <button
        type="button"
        class="icon-btn danger"
        title="Delete section"
        aria-label="Delete section"
        onclick={() => (pendingDelete = { kind: "section", pageId, sectionId })}
      >
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>
    {#if sectionOpen && section}
      <div class="fold">
        <LayoutDetails
          {registry}
          {devices}
          selection={{ kind: "section", pageId, sectionId }}
          onChange={commitLayout}
          onSelect={(next) => (selection = next)}
          showPreview={false}
        />
      </div>
    {/if}

    <!-- The section's tiles: one line each, and the picked one opens its
         editor directly under its own line. -->
    <div class="tiles">
      {#each tiles as t, i (t.id)}
        {@const anchor = { pageId, sectionId, placementId: t.id }}
        {@const tileDevice = deviceOfAnchor(anchor)}
        <div
          class="tile-line"
          class:selected={tileSelection?.placementId === t.id}
        >
          <button
            type="button"
            class="tile-head"
            onclick={() => (selection = { kind: "tile", ...anchor })}
          >
            {#if tileDevice?.icon}
              <span class="tree-icon"
                ><Icon value={tileDevice.icon} size={16} /></span
              >
            {/if}
            <span class="name">{t.title || tileDevice?.name || t.device}</span>
            {#if t.tile?.size}
              <span class="hint-badge text-muted"
                >{t.tile.size.w}×{t.tile.size.h}</span
              >
            {/if}
          </button>
          <span class="row-actions">
            {#if i === 0}
              <button
                type="button"
                class="icon-btn"
                title="Add tile above"
                aria-label="Add tile above"
                onclick={() =>
                  (pickerFor = { kind: "device", pageId, sectionId, at: 0 })}
              >
                <span class="material-symbols-outlined">add</span>
              </button>
            {:else}
              <button
                type="button"
                class="icon-btn"
                title="Move up"
                aria-label="Move up"
                onclick={() =>
                  commitLayout(
                    movePlacement(
                      registry,
                      { pageId, sectionId, index: i },
                      { pageId, sectionId, index: i - 1 },
                    ),
                  )}
              >
                <span class="material-symbols-outlined">arrow_upward</span>
              </button>
            {/if}
            <button
              type="button"
              class="icon-btn"
              title="Duplicate tile"
              aria-label="Duplicate tile"
              onclick={() =>
                commitLayout(
                  duplicatePlacement(registry, pageId, sectionId, t.id),
                )}
            >
              <span class="material-symbols-outlined">content_copy</span>
            </button>
            {#if i === tiles.length - 1}
              <button
                type="button"
                class="icon-btn"
                title="Add tile below"
                aria-label="Add tile below"
                onclick={() =>
                  (pickerFor = {
                    kind: "device",
                    pageId,
                    sectionId,
                    at: i + 1,
                  })}
              >
                <span class="material-symbols-outlined">add</span>
              </button>
            {:else}
              <button
                type="button"
                class="icon-btn"
                title="Move down"
                aria-label="Move down"
                onclick={() =>
                  commitLayout(
                    movePlacement(
                      registry,
                      { pageId, sectionId, index: i },
                      { pageId, sectionId, index: i + 1 },
                    ),
                  )}
              >
                <span class="material-symbols-outlined">arrow_downward</span>
              </button>
            {/if}
            <button
              type="button"
              class="icon-btn danger"
              title="Remove tile"
              aria-label="Remove tile"
              onclick={() =>
                commitLayout(
                  deletePlacement(registry, pageId, sectionId, t.id),
                )}
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </span>
        </div>
        {#if tileSelection?.placementId === t.id}
          <div class="fold tile-editor">
            <LayoutDetails
              {registry}
              {devices}
              selection={tileSelection}
              onChange={commitLayout}
              onSelect={(next) => (selection = next)}
              onSwapDevice={(anchor) => (swapFor = anchor)}
              onAddSlot={openSlotPicker}
              showPreview={false}
            />
          </div>
        {/if}
      {/each}

      <button
        type="button"
        class="btn add-tile"
        title="Add a tile to this section"
        onclick={() => (pickerFor = { kind: "device", pageId, sectionId })}
      >
        <span class="material-symbols-outlined">add</span>
        Add tile
      </button>
    </div>
  </aside>
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
        addDevicesTo(target.pageId, target.sectionId, deviceIds, target.at);
      }}
      onClose={() => (pickerFor = null)}
    />
  {:else}
    {@const device = deviceOfAnchor(target.anchor)}
    {#if device}
      <SlotPicker
        {device}
        onAdd={(slot) => addSlotTo(target.anchor, slot, target.at)}
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

{#if swapFor}
  {@const swapTarget = placementOfAnchor(swapFor)}
  <DevicePicker
    {devices}
    {rooms}
    enums={ioBroker.enums}
    listed={swapTarget ? [swapTarget.device] : []}
    onAdd={(ids) => {
      if (ids[0]) pickSwapDevice(ids[0]);
    }}
    onClose={() => (swapFor = null)}
  />
{/if}

{#if pendingSwap}
  <ConfirmModal
    title={`Change to “${
      devices.find((d) => d.id === pendingSwap!.deviceId)?.name ??
      pendingSwap.deviceId
    }”?`}
    confirmLabel="Change"
    onConfirm={() => applySwap(pendingSwap!.anchor, pendingSwap!.deviceId)}
    onCancel={() => (pendingSwap = null)}
  >
    Its own slots, background and active condition are dropped — they were built
    for {pendingSwap.oldName}. The title and the position stay.
  </ConfirmModal>
{/if}

<style>
  /* Spike B: the display fills the view, the editor is a sheet on top of it. */
  .layout-page {
    min-height: calc(100vh - 44px);
  }

  /* The page being edited, at its real size. Inert: this is a preview, and a
     stray tap must not switch a lamp. */
  .stage {
    pointer-events: none;
  }

  /* Wide: the sheet takes the right-hand strip, the display keeps the rest (it
     reflows to whatever width it gets). */
  @media (min-width: 821px) {
    .stage {
      padding-right: 440px;
    }
  }

  /* Narrow — a tablet in portrait, a phone: no room beside, so the sheet is a
     bottom sheet and the live preview stays visible above it. */
  @media (max-width: 820px) {
    .stage {
      padding-bottom: 62vh;
    }
  }

  .sheet {
    position: fixed;
    top: 44px;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    width: min(440px, 100vw);
    padding: 0.75rem;
    overflow-y: auto;
    background-color: var(--surface-container-lowest);
    border-left: 1px solid var(--border-color);
    color: var(--text-color);
  }

  /* A phone has no room for a sheet beside the display: it takes the screen. */
  @media (max-width: 820px) {
    .sheet {
      top: auto;
      width: 100%;
      height: 62vh;
      border-top: 1px solid var(--border-color);
      border-left: 0;
    }
  }

  .sheet-head {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 1.6rem;
  }

  .line {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .line select {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* A fold-out reads as belonging to the line above it. */
  .fold {
    padding-left: 0.6rem;
    border-left: 2px solid var(--border-color);
  }

  .tiles {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .tile-line {
    display: flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }

  .tile-line.selected {
    background-color: var(--surface-container);
    border-radius: var(--border-radius-sm, 6px);
  }

  .tile-head {
    display: flex;
    flex: 1 1 auto;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
    text-align: left;
  }

  .tile-head .name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .tile-editor {
    margin-bottom: 0.4rem;
  }

  .add-tile {
    align-self: flex-start;
  }

  /* The row's controls. `.icon-btn` is per-component in this codebase, and the
     tree (whose rows this sheet replaces) is where these styles lived. */
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: var(--border-radius-pill);
    color: var(--text-muted);
  }

  .icon-btn:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .icon-btn.danger:hover {
    color: var(--error-color, var(--danger-color, #b3261e));
  }

  .icon-btn.on {
    color: var(--primary-color);
  }

  .icon-btn .material-symbols-outlined {
    font-size: 20px;
  }

  .tree-icon {
    display: inline-flex;
    color: var(--text-muted);
  }

  .hint-badge {
    font-size: 0.7rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
    padding: 0 6px;
  }
</style>
