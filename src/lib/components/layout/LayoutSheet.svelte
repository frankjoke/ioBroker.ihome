<script lang="ts">
  import { onMount, untrack } from "svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import DeviceForm from "$lib/components/config/DeviceForm.svelte";
  import Tile from "$lib/components/display/Tile.svelte";
  import { breakpointFor, type Breakpoint } from "$lib/config/size-ops";
  import DevicePicker from "$lib/components/layout/DevicePicker.svelte";
  import LayoutDetails from "$lib/components/layout/LayoutDetails.svelte";
  import SlotPicker from "$lib/components/layout/SlotPicker.svelte";
  import { takeRequestedLayout } from "$lib/pages.js";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    getCanonicalRegistry,
    setCanonicalRegistry,
  } from "$lib/stores/devices.svelte.js";
  import { saveRegistry } from "$lib/registry.svelte.js";
  import { roomList, roomsOf as roomsOfEnum } from "$lib/config/rooms";
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
  import { addSlot, editTile, slotWhere } from "$lib/config/tile-ops";
  import { resolveTemplate } from "$lib/config/template-ops";
  import {
    commitLayout,
    getLayoutSaveFailed,
    getPageRegistry,
    isLayoutWritable,
  } from "$lib/stores/pages.svelte.js";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { devicesEnrichedStore } from "$lib/stores/devices";
  import type { EnrichedDevice } from "$lib/types/device";
  import type { Device } from "$lib/types/device";
  import type { PageRegistry, Placement, Slot } from "$lib/types/display";

  let {
    pageId = "",
    onPage,
    onClose,
  }: {
    /** The display's page: the sheet's cursor page is the display's page (A45). */
    pageId?: string;
    onPage: (id: string) => void;
    onClose: () => void;
  } = $props();

  let selection = $state<LayoutSelection | null>(null);
  let pendingDelete = $state<LayoutSelection | null>(null);
  /** Change device: the anchor whose device is being swapped, then the confirm. */
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

  /** The page being edited: the display's (the sheet never picks its own). */
  const page = $derived(
    registry.pages.find((p) => p.id === pageId) ?? registry.pages[0],
  );
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
  /** The tile the editor is on: the selection's, else the section's first. */
  const tileId = $derived(
    (selection?.kind === "tile" ? selection.placementId : undefined) ??
      tiles[0]?.id ??
      "",
  );
  const tileAnchor = $derived(
    tileId ? { pageId, sectionId, placementId: tileId } : null,
  );
  const tileIndex = $derived(tiles.findIndex((t) => t.id === tileId));
  const tileSelection = $derived(
    tileAnchor ? { kind: "tile" as const, ...tileAnchor } : null,
  );

  /** A tile line's label: what it is called, plus its size when it has one. */
  function tileLabel(t: Placement): string {
    const name =
      t.title ||
      deviceOfAnchor({ pageId, sectionId, placementId: t.id })?.name ||
      t.device;
    return t.tile?.size ? `${name} · ${t.tile.size.w}×${t.tile.size.h}` : name;
  }

  function selectPage(id: string): void {
    onPage(id);
  }

  // A page change (here or in the app bar) moves the cursor with it — but only
  // when the selection is on another page, so a handoff that set both survives.
  $effect(() => {
    if (selection?.pageId !== pageId) {
      selection = { kind: "page", pageId };
    }
  });

  function selectSection(id: string): void {
    selection = { kind: "section", pageId, sectionId: id };
  }

  function selectTile(id: string): void {
    selection = { kind: "tile", pageId, sectionId, placementId: id };
  }

  // The "modal view": a checkbox on the Tile title's line asks the sheet's own
  // Tile to open its modal — non-modally, so it appears over the display and
  // nothing is blocked. The display behind cannot show it by itself: a modal
  // needs a press, and the stage is inert by design.
  let modalShown = $state(false);
  const modalRequest = $derived({ inline: true });
  /** The docked panel's Tile call wants a breakpoint; the modal's rows do not
   *  use it, so the window's is fine (the sheet is not the tile's surface). */
  let previewBp = $state<Breakpoint>(breakpointFor(1400));
  const currentTile = $derived(tiles.find((t) => t.id === tileId));
  const tileDevice = $derived(
    tileAnchor ? deviceOfAnchor(tileAnchor) : undefined,
  );

  // The sheet's body is one editor at a time: the tile's layout, or the tile's
  // device. The Device line switches between them — the tile editor's details
  // are replaced, not stacked under a second long form.
  let mode = $state<"tile" | "device">("tile");
  const canonicalDevice = $derived(
    tileDevice
      ? (getCanonicalRegistry().devices.find((d) => d.id === tileDevice.id) ??
          null)
      : null,
  );

  function saveDevice(d: Device): void {
    const reg = getCanonicalRegistry();
    const idx = reg.devices.findIndex((x) => x.id === d.id);
    setCanonicalRegistry({
      version: (reg.version ?? 0) + 1,
      updatedAt: Date.now(),
      devices:
        idx >= 0
          ? reg.devices.map((x) => (x.id === d.id ? d : x))
          : [...reg.devices, d],
    });
    saveRegistry();
    mode = "tile";
  }

  // The modal view belongs to the tile it was opened for: move to another tile
  // and it closes (rather than following along or showing an empty panel).
  $effect(() => {
    void tileId;
    untrack(() => (modalShown = false));
  });

  /**
   * Spike shortcut: does anything of this tile live in the modal? The display's
   * tile answers this properly — it resolves every slot and honours rules — so
   * here we only look at the chain's `where`, and a rule-hidden modal slot would
   * still offer the button. The real pass asks the resolver (one helper, used by
   * both).
   */
  function hasModalParts(t: Placement | undefined): boolean {
    if (!t) return false;
    const device = deviceOfAnchor({ pageId, sectionId, placementId: t.id });
    const slots =
      t.tile?.slots ??
      (device
        ? resolveTemplate(device, getTemplateRegistry().templates).slots
        : []);
    return slots.some((s) => slotWhere(s) !== "tile");
  }

  // A tile (or a section/page) on the display handed us its address (Ctrl/Cmd+
  // click): select it, so the drill-down opens on what was clicked.
  onMount(() => {
    const requested = takeRequestedLayout();
    if (requested) {
      onPage(requested.pageId);
      selection = requested;
    }
    const onResize = () => (previewBp = breakpointFor(window.innerWidth));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
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

  /** Change device (A25): the Device line's selector picks one. A materialised
   *  tile asks first — its own config goes with the old device. */
  function pickSwapDevice(deviceId: string): void {
    const anchor = tileAnchor;
    if (!anchor || !deviceId) return;
    const placement = placementOfAnchor(anchor);
    if (!placement || placement.device === deviceId) return;
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

<aside class="sheet" aria-label="Layout editor">
  <header class="sheet-head">
    <span class="label-mono">Layout</span>
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
      class="icon-btn close"
      title="Close the editor"
      aria-label="Close the editor"
      onclick={onClose}
    >
      <span class="material-symbols-outlined">close</span>
    </button>
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

  <!-- Tile: the same shape a third time — pick one, and its editor is the
         sheet's body. No list: the display behind shows the tiles. -->
  <div class="line">
    <span class="label-mono">Tile</span>
    <select
      value={tileId}
      aria-label="Tile"
      onchange={(e) => selectTile(e.currentTarget.value)}
    >
      {#if tiles.length === 0}
        <option value="">no tiles yet</option>
      {/if}
      {#each tiles as t (t.id)}
        <option value={t.id}>{tileLabel(t)}</option>
      {/each}
    </select>
    <button
      type="button"
      class="icon-btn"
      title="Add tile"
      aria-label="Add tile"
      onclick={() => (pickerFor = { kind: "device", pageId, sectionId })}
    >
      <span class="material-symbols-outlined">add</span>
    </button>
    <button
      type="button"
      class="icon-btn"
      title="Duplicate tile"
      aria-label="Duplicate tile"
      disabled={!tileAnchor}
      onclick={() =>
        commitLayout(duplicatePlacement(registry, pageId, sectionId, tileId))}
    >
      <span class="material-symbols-outlined">content_copy</span>
    </button>
    <button
      type="button"
      class="icon-btn"
      title="Move up"
      aria-label="Move up"
      disabled={!tileAnchor || tileIndex <= 0}
      onclick={() =>
        commitLayout(
          movePlacement(
            registry,
            { pageId, sectionId, index: tileIndex },
            { pageId, sectionId, index: tileIndex - 1 },
          ),
        )}
    >
      <span class="material-symbols-outlined">arrow_upward</span>
    </button>
    <button
      type="button"
      class="icon-btn"
      title="Move down"
      aria-label="Move down"
      disabled={!tileAnchor || tileIndex === tiles.length - 1}
      onclick={() =>
        commitLayout(
          movePlacement(
            registry,
            { pageId, sectionId, index: tileIndex },
            { pageId, sectionId, index: tileIndex + 1 },
          ),
        )}
    >
      <span class="material-symbols-outlined">arrow_downward</span>
    </button>
    <button
      type="button"
      class="icon-btn danger"
      title="Remove tile"
      aria-label="Remove tile"
      disabled={!tileAnchor}
      onclick={() =>
        commitLayout(deletePlacement(registry, pageId, sectionId, tileId))}
    >
      <span class="material-symbols-outlined">delete</span>
    </button>
  </div>

  <!-- Device: the fourth line — a selector of devices (changing it is the
       change-device action) and the switch into the device's own editor. The
       editor replaces the tile editor below rather than stacking with it. -->
  <div class="line">
    <span class="label-mono">Device</span>
    <select
      value={tileDevice?.id ?? ""}
      aria-label="Device"
      disabled={!tileAnchor}
      onchange={(e) => pickSwapDevice(e.currentTarget.value)}
    >
      {#if !tileDevice}
        <option value="">no device</option>
      {/if}
      {#each devices as d (d.id)}
        <option value={d.id}>{d.name || d.id}</option>
      {/each}
    </select>
    <button
      type="button"
      class="icon-btn"
      class:on={mode === "device"}
      title={mode === "device"
        ? "Back to the tile's layout"
        : "Edit this device"}
      aria-label={mode === "device"
        ? "Back to the tile's layout"
        : "Edit this device"}
      aria-expanded={mode === "device"}
      disabled={!canonicalDevice}
      onclick={() => (mode = mode === "device" ? "tile" : "device")}
    >
      <span class="material-symbols-outlined"
        >{mode === "device" ? "arrow_back" : "tune"}</span
      >
    </button>
  </div>

  <!-- The modal view. A Tile of its own, hidden except for the modal it opens
         (the display behind is where the tile itself is judged): non-modal, so
         it appears over the display and the sheet stays usable. -->
  {#if modalShown && currentTile && tileDevice}
    <div class="modal-view">
      <Tile
        device={tileDevice}
        bp={previewBp}
        title={currentTile.title}
        tile={currentTile.tile}
        openModal={modalRequest}
        onModalClose={() => (modalShown = false)}
      />
    </div>
  {/if}

  <!-- One editor at a time: the tile's layout, or the tile's device. -->
  {#if mode === "device" && canonicalDevice}
    <div class="fold device-editor">
      {#key canonicalDevice.id}
        <DeviceForm
          device={canonicalDevice}
          objects={ioBroker.objects}
          roomsOf={(id) => roomsOfEnum(ioBroker.enums, id)}
          {rooms}
          devices={getCanonicalRegistry().devices}
          onSave={saveDevice}
          onCancel={() => (mode = "tile")}
        />
      {/key}
    </div>
  {:else if tileSelection}
    {#snippet tileExtras()}
      <label
        class="check"
        title={hasModalParts(currentTile)
          ? "Show the detail page — the modal a long-press opens — over the display"
          : "Nothing of this tile lives in the detail page"}
      >
        <span>Detail Page</span>
        <input
          type="checkbox"
          checked={modalShown}
          disabled={!hasModalParts(currentTile)}
          onchange={(e) => (modalShown = e.currentTarget.checked)}
        />
      </label>
    {/snippet}
    <div class="fold tile-editor">
      <LayoutDetails
        {registry}
        {devices}
        selection={tileSelection}
        onChange={commitLayout}
        onSelect={(next) => (selection = next)}
        onAddSlot={openSlotPicker}
        titleExtra={tileExtras}
        showPreview={false}
      />
    </div>
  {/if}
</aside>

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
  /* Spike B: the editor is a sheet over the display, not a page of its own. */
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

  .sheet-head .close {
    margin-left: auto;
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

  .tile-editor {
    margin-bottom: 0.4rem;
  }

  /* The modal view: only the dialog, the tile in this call is hidden — the
     display behind is where the tile itself is judged. */
  .modal-view :global(.tile) {
    display: none;
  }

  /* The non-modal dialog places itself; here it belongs over the display, not
     over the sheet: the strip the sheet leaves on the left. */
  .sheet :global(dialog.modal.inline) {
    right: 440px;
    top: 44px;
  }

  @media (max-width: 820px) {
    .sheet :global(dialog.modal.inline) {
      right: 0;
      top: 44px;
      bottom: 62vh;
    }
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
</style>
