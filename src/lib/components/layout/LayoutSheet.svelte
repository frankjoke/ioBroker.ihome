<script lang="ts">
  import { onMount, untrack } from "svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import NameModal from "$lib/components/common/NameModal.svelte";
  import Tile from "$lib/components/display/Tile.svelte";
  import { breakpointFor, type Breakpoint } from "$lib/config/size-ops";
  import LayoutDetails from "$lib/components/layout/LayoutDetails.svelte";
  import MoveSectionModal from "$lib/components/layout/MoveSectionModal.svelte";
  import MoveTileModal from "$lib/components/layout/MoveTileModal.svelte";
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";
  import { takeRequestedLayout } from "$lib/pages.js";
  import {
    getCanonicalRegistry,
    setCanonicalRegistry,
  } from "$lib/stores/devices.svelte.js";
  import { saveRegistry } from "$lib/registry.svelte.js";
  import {
    addPage,
    addSection,
    appendTile,
    deletePage,
    deletePlacement,
    deleteSection,
    duplicatePlacement,
    duplicateSection,
    movePlacement,
    movePage,
    moveSectionToPage,
    pageTitleTaken,
    patchPlacement,
    sectionTitleTaken,
    type LayoutSelection,
    type PlacementAnchor,
  } from "$lib/config/layout-ops";
  import { addSlot, editTile } from "$lib/config/tile-ops";
  import { tileSeed } from "$lib/config/slot-create";
  import { sheetCursor, tileLabel } from "$lib/config/sheet-cursor";
  import {
    commitLayout,
    getLayoutSaveFailed,
    getPageRegistry,
    isLayoutWritable,
  } from "$lib/stores/pages.svelte.js";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { devicesEnrichedStore } from "$lib/stores/devices";
  import { sheet } from "$lib/stores/sheet.svelte";
  import type { Device } from "$lib/types/device";
  import type { PageRegistry, Slot } from "$lib/types/display";

  let {
    pageId = "",
    onPage,
    onClose,
    picked,
  }: {
    /** The display's page: the sheet's cursor page is the display's page (A45). */
    pageId?: string;
    onPage: (id: string) => void;
    onClose: () => void;
    /** The tile a click in the display landed on (A48). */
    picked?: PlacementAnchor | null;
  } = $props();

  let selection = $state<LayoutSelection | null>(sheet.selection);
  let pendingDelete = $state<LayoutSelection | null>(null);
  /** The '+' asks for a name first; nothing is created until it is submitted. */
  let pendingCreate = $state<
    { kind: "page" } | { kind: "section"; pageId: string } | null
  >(null);
  let tileMoveOpen = $state(false);
  let pickerFor = $state<
    | { kind: "slot"; anchor: PlacementAnchor; at?: number }
    | { kind: "newTile"; pageId: string; sectionId: string; at?: number }
    | null
  >(null);

  const registry = $derived(getPageRegistry());
  const devices = $derived($devicesEnrichedStore);
  const saveFailed = $derived(getLayoutSaveFailed());
  // No document has been read (or it is unreadable): every write is refused, so
  // the editor says so rather than looking like it works.
  const writable = $derived(isLayoutWritable());

  // ------------------------------------------------ the drill-down (spike B)
  // Page → section → the section's tiles. The selection leads: the selectors
  // follow it and picking in one sets it. No tree and no second pane.
  let pageOpen = $state(false);
  let sectionOpen = $state(false);
  /** The section line's move button shows the page destination at the pane's end. */
  let sectionModalOpen = $state(false);

  // The cursor itself is a pure module (A45): page → section → tile, each with
  // its fallback, and its page is the display's (the `pageId` prop).
  const cursor = $derived(sheetCursor(registry, selection, pageId));
  const page = $derived(cursor.page);
  const pageIndex = $derived(registry.pages.findIndex((p) => p.id === pageId));
  const section = $derived(cursor.section);
  const sectionId = $derived(cursor.sectionId);
  const tiles = $derived(cursor.tiles);
  const tileId = $derived(cursor.tileId);
  const tileIndex = $derived(cursor.tileIndex);
  const tileAnchor = $derived(
    tileId ? { pageId, sectionId, placementId: tileId } : null,
  );
  const tileSelection = $derived(
    tileAnchor ? { kind: "tile" as const, ...tileAnchor } : null,
  );

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

  // The eye/pencil toggle unmounts the sheet: remember the cursor so the
  // return lands on the tile that was being edited, not the page's first tile.
  $effect(() => {
    sheet.selection = selection;
  });

  // A click in the display points the cursor at its tile (A48). The page moves
  // with it, but that already happened at the click (+page.svelte): calling
  // back into the display's page state from here would track it, and every
  // later page change would drag the cursor back to this tile.
  $effect(() => {
    const hit = picked;
    if (!hit) return;
    pageOpen = false;
    sectionOpen = false;
    selection = { kind: "tile", ...hit };
  });

  function selectSection(id: string): void {
    selection = { kind: "section", pageId, sectionId: id };
  }

  function selectTile(id: string): void {
    pageOpen = false;
    sectionOpen = false;
    selection = { kind: "tile", pageId, sectionId, placementId: id };
  }

  /** Create the named page and move the cursor onto it (and its first section). */
  function createPage(title: string): void {
    const next = addPage(registry, title);
    const created = next.pages[next.pages.length - 1]; // addPage appends here
    if (!commitLayout(next)) return;
    onPage(created.id);
    const first = created.groups?.[0];
    selection = first
      ? { kind: "section", pageId: created.id, sectionId: first.id }
      : { kind: "page", pageId: created.id };
    pendingCreate = null;
  }

  /** Create the named section in this page and select it (the device picker follows). */
  function createSection(title: string): void {
    if (!pageId) return;
    const next = addSection(registry, pageId, title);
    const created = next.pages.find((p) => p.id === pageId)?.groups?.at(-1);
    if (!created || !commitLayout(next)) return;
    selection = { kind: "section", pageId, sectionId: created.id };
    pendingCreate = null;
  }

  /** The move-section modal: keep the section selected and follow its new page. */
  function moveSectionToPageAndFollow(toPageId: string): void {
    if (!page || !section || toPageId === page.id) return;
    const movedId = section.id;
    const next = moveSectionToPage(registry, page.id, movedId, toPageId);
    if (next === registry) {
      sectionModalOpen = false;
      return;
    }
    if (!commitLayout(next)) return;
    sectionModalOpen = false;
    selection = { kind: "section", pageId: toPageId, sectionId: movedId };
    if (toPageId !== pageId) onPage(toPageId);
  }

  /** The move-tile modal: append the tile to the target section and follow it. */
  function moveTileToSection(toPageId: string, toSectionId: string): void {
    const anchor = tileAnchor;
    if (!anchor || tileIndex < 0) return;
    if (toPageId === anchor.pageId && toSectionId === anchor.sectionId) return;
    const target = registry.pages
      .find((p) => p.id === toPageId)
      ?.groups?.find((g) => g.id === toSectionId);
    if (!target) return;
    const next = movePlacement(
      registry,
      {
        pageId: anchor.pageId,
        sectionId: anchor.sectionId,
        index: tileIndex,
      },
      {
        pageId: toPageId,
        sectionId: toSectionId,
        index: (target.tiles ?? []).length,
      },
    );
    if (!commitLayout(next)) return;
    tileMoveOpen = false;
    selection = {
      kind: "tile",
      pageId: toPageId,
      sectionId: toSectionId,
      placementId: anchor.placementId,
    };
    if (toPageId !== pageId) onPage(toPageId);
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

  // The modal view belongs to the tile it was opened for (A50): move to another
  // tile and it closes, rather than showing the new tile's preview.
  $effect(() => {
    void tileId;
    untrack(() => {
      modalShown = false;
      tileMoveOpen = false;
    });
  });

  /** Whether anything of this tile lives in the detail page. The hidden Tile
   *  below reports its own resolution (A47), so the checkbox cannot lie about
   *  raw slots, active rules or badge chips. */
  let hasDetail = $state(false);
  function noteDetail(has: boolean): void {
    hasDetail = has;
    if (!has) modalShown = false;
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

  /** The panel's Add slot: the source picker decides what is read. `at`
   *  inserts the new slot there instead of appending (the row's `+`). */
  function openSlotPicker(anchor: PlacementAnchor, at?: number): void {
    pickerFor = { kind: "slot", anchor, at };
  }

  /** A new tile starts with the picker's first slot (S8): never an empty tile. */
  function openNewTile(pageId: string, sectionId: string, at?: number): void {
    if (!pageId || !sectionId) return;
    pickerFor = { kind: "newTile", pageId, sectionId, at };
  }

  function addSlotsTo(
    anchor: PlacementAnchor,
    slots: Slot[],
    at?: number,
  ): void {
    if (!slots.length) return;
    commitLayout(
      editTile(registry, anchor, (t) =>
        slots.reduce(
          (tile, slot, i) =>
            addSlot(tile, slot, at === undefined ? undefined : at + i),
          t,
        ),
      ),
    );
    pickerFor = null;
  }

  function addTileWith(
    pageId: string,
    sectionId: string,
    slots: Slot[],
    at?: number,
  ): void {
    if (!slots.length) return;
    const sectionIn = (reg: PageRegistry) =>
      reg.pages
        .find((p) => p.id === pageId)
        ?.groups.find((g) => g.id === sectionId);
    const before = new Set((sectionIn(registry)?.tiles ?? []).map((t) => t.id));
    // A new tile takes its name, size and default glyph from its first slot
    // once (S11) — a frozen offer, not a live device link.
    const seed = tileSeed(slots, devices, getTemplateRegistry().templates);
    const first =
      seed.icon && !slots[0].icon?.glyph
        ? { ...slots[0], icon: { ...slots[0].icon, glyph: seed.icon } }
        : slots[0];
    let next = appendTile(registry, pageId, sectionId, first, at);
    const added = sectionIn(next)?.tiles.find((t) => !before.has(t.id));
    if (!added) {
      pickerFor = null;
      return;
    }
    const anchor = { pageId, sectionId, placementId: added.id };
    const seedSize = seed.size;
    if (seedSize) {
      next = editTile(next, anchor, (t) => ({ ...t, size: seedSize }));
    }
    const seedTitle = seed.title;
    if (seedTitle) {
      next = patchPlacement(next, pageId, sectionId, added.id, {
        title: seedTitle,
      });
    }
    // The type's glyph is the tile's face even when the headline slot is a
    // value or another slot: the first slot offers it once (S11).
    const seedIcon = seed.icon;
    if (seedIcon) {
      next = editTile(next, anchor, (t) => ({
        ...t,
        look: {
          ...t.look,
          inactive: { ...t.look?.inactive, glyph: seedIcon },
        },
      }));
    }
    if (slots.length > 1) {
      next = editTile(next, { pageId, sectionId, placementId: added.id }, (t) =>
        slots.slice(1).reduce((tile, slot) => addSlot(tile, slot), t),
      );
    }
    commitLayout(next);
    pickerFor = null;
    selection = { kind: "tile", pageId, sectionId, placementId: added.id };
  }

  /** Persist a device created from the slot picker; it is not placed by itself
   *  (S9: the picker only returns it as the selected source collection). */
  function saveNewDevice(d: Device): void {
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
  }

  function confirmDelete(): void {
    const target = pendingDelete;
    pendingDelete = null;
    if (!target) return;
    if (target.kind === "page") {
      commitLayout(deletePage(registry, target.pageId));
    } else if (target.kind === "section") {
      commitLayout(deleteSection(registry, target.pageId, target.sectionId));
    } else if (target.kind === "tile") {
      commitLayout(
        deletePlacement(
          registry,
          target.pageId,
          target.sectionId,
          target.placementId,
        ),
      );
    }
  }

  function deleteTitle(target: LayoutSelection | null): string {
    if (target?.kind === "page") {
      const page = registry.pages.find((p) => p.id === target.pageId);
      return `Delete page “${page?.title || "page"}”`;
    }
    if (target?.kind === "section") {
      const page = registry.pages.find((p) => p.id === target.pageId);
      const section = page?.groups.find((g) => g.id === target.sectionId);
      return `Delete section “${section?.title || "section"}” from page “${page?.title || "page"}”`;
    }
    if (target?.kind === "tile") {
      const page = registry.pages.find((p) => p.id === target.pageId);
      const section = page?.groups.find((g) => g.id === target.sectionId);
      const tile = section?.tiles.find((t) => t.id === target.placementId);
      return `Delete tile “${tile?.title || "tile"}” from section “${section?.title || "section"}”`;
    }
    return "Delete";
  }
</script>

<aside class="sheet" aria-label="Layout editor">
  {#if saveFailed || !writable || registry.pages.length === 0}
    <header class="sheet-head">
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
          onclick={() => (pendingCreate = { kind: "page" })}
        >
          <span class="material-symbols-outlined">add</span>
        </button>
      {/if}
    </header>
  {/if}

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
      onclick={() => {
        pageOpen = !pageOpen;
        if (pageOpen) {
          sectionOpen = false;
        }
      }}
    >
      <span class="material-symbols-outlined"
        >{pageOpen ? "close" : "edit"}</span
      >
    </button>
    <button
      type="button"
      class="icon-btn"
      title="Add page"
      aria-label="Add page"
      onclick={() => (pendingCreate = { kind: "page" })}
    >
      <span class="material-symbols-outlined">add</span>
    </button>
    <button
      type="button"
      class="icon-btn"
      title="Move page up"
      aria-label="Move page up"
      disabled={pageIndex <= 0}
      onclick={() => commitLayout(movePage(registry, pageIndex, pageIndex - 1))}
    >
      <span class="material-symbols-outlined">arrow_upward</span>
    </button>
    <button
      type="button"
      class="icon-btn"
      title="Move page down"
      aria-label="Move page down"
      disabled={pageIndex < 0 || pageIndex >= registry.pages.length - 1}
      onclick={() => commitLayout(movePage(registry, pageIndex, pageIndex + 1))}
    >
      <span class="material-symbols-outlined">arrow_downward</span>
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
    <div>
      <LayoutDetails
        {registry}
        {devices}
        selection={{ kind: "page", pageId }}
        onChange={commitLayout}
      />
    </div>
  {/if}

  {#if !pageOpen}
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
        onclick={() => {
          sectionOpen = !sectionOpen;
          if (sectionOpen) {
            pageOpen = false;
          }
        }}
      >
        <span class="material-symbols-outlined"
          >{sectionOpen ? "close" : "edit"}</span
        >
      </button>
      <button
        type="button"
        class="icon-btn"
        title="Add section"
        aria-label="Add section"
        onclick={() => (pendingCreate = { kind: "section", pageId })}
      >
        <span class="material-symbols-outlined">add</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        title="Move to another page"
        aria-label="Move to another page"
        aria-haspopup="dialog"
        disabled={!section}
        onclick={() => (sectionModalOpen = true)}
      >
        <span class="material-symbols-outlined">drive_file_move</span>
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
      <div>
        <LayoutDetails
          {registry}
          {devices}
          selection={{ kind: "section", pageId, sectionId }}
          onChange={commitLayout}
        />
      </div>
    {/if}
  {/if}

  {#if !pageOpen && !sectionOpen}
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
        disabled={!sectionId}
        onclick={() => openNewTile(pageId, sectionId)}
      >
        <span class="material-symbols-outlined">add</span>
      </button>
      <button
        type="button"
        class="icon-btn"
        title="Move to another section"
        aria-label="Move to another section"
        aria-haspopup="dialog"
        disabled={!tileAnchor}
        onclick={() => (tileMoveOpen = true)}
      >
        <span class="material-symbols-outlined">drive_file_move</span>
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
          (pendingDelete = {
            kind: "tile",
            pageId,
            sectionId,
            placementId: tileId,
          })}
      >
        <span class="material-symbols-outlined">delete</span>
      </button>
    </div>
  {/if}

  <!-- The sheet's body is always the tile editor: the device is a reusable
       control collection on the Devices page, never a tile's identity. -->
  <!-- The sheet's own hidden Tile: it answers whether there is a detail page
         (A47, via `noteDetail`) and opens that modal for real when the box is
         ticked — only the tile resolves its rows. Non-modal, so it appears over
         the display and the sheet stays usable. -->
  {#if currentTile}
    <div class="modal-view">
      <Tile
        placement={currentTile}
        bp={previewBp}
        openModal={modalShown ? modalRequest : null}
        onModalClose={() => (modalShown = false)}
        onDetail={noteDetail}
      />
    </div>
  {/if}

  <!-- One editor at a time: the selected tile's layout. Page/section edits
       fold out under their own line and close the tile editor. -->
  {#if tileSelection && !pageOpen && !sectionOpen}
    <div class="tile-editor">
      <LayoutDetails
        {registry}
        {devices}
        selection={tileSelection}
        onChange={commitLayout}
        onAddSlot={openSlotPicker}
        {hasDetail}
        detailShown={modalShown}
        onDetailToggle={(shown) => (modalShown = shown)}
      />
    </div>
  {/if}
</aside>

{#if pickerFor}
  {@const target = pickerFor}
  <SourcePicker
    mode="slot"
    {devices}
    templates={getTemplateRegistry().templates ?? []}
    slots={target.kind === "slot" ? (currentTile?.tile?.slots ?? []) : []}
    title={target.kind === "newTile" ? "Add a tile" : "Add a slot"}
    onSlots={(slots) => {
      // Snapshot before closing: `target` reads the reactive value, which
      // becomes null the moment `pickerFor` is cleared.
      if (target.kind === "newTile") {
        addTileWith(target.pageId, target.sectionId, slots, target.at);
      } else {
        addSlotsTo(target.anchor, slots, target.at);
      }
    }}
    onSaveDevice={saveNewDevice}
    onClose={() => (pickerFor = null)}
  />
{/if}

{#if sectionModalOpen && section}
  <MoveSectionModal
    title={`Move “${section.title || "section"}”`}
    pages={registry.pages.map((p) => ({ id: p.id, title: p.title }))}
    current={page?.id ?? pageId}
    onMove={moveSectionToPageAndFollow}
    onClose={() => (sectionModalOpen = false)}
  />
{/if}

{#if tileMoveOpen && tileAnchor && currentTile}
  <MoveTileModal
    title={`Move “${tileLabel(currentTile)}”`}
    pages={registry.pages.map((p) => ({
      id: p.id,
      title: p.title,
      sections: (p.groups ?? []).map((g) => ({ id: g.id, title: g.title })),
    }))}
    currentPageId={tileAnchor.pageId}
    currentSectionId={tileAnchor.sectionId}
    onMove={moveTileToSection}
    onClose={() => (tileMoveOpen = false)}
  />
{/if}

{#if pendingDelete}
  <ConfirmModal
    title={deleteTitle(pendingDelete)}
    confirmLabel="Delete"
    onConfirm={confirmDelete}
    onCancel={() => (pendingDelete = null)}
  />
{/if}

{#if pendingCreate}
  {@const target = pendingCreate}
  <NameModal
    title={target.kind === "page" ? "New page" : "New section"}
    label={target.kind === "page" ? "Page name" : "Section name"}
    validate={(value) => {
      if (!value) return "Enter a name";
      const taken =
        target.kind === "page"
          ? pageTitleTaken(registry, value)
          : sectionTitleTaken(page, value);
      return taken ? "That name is already used" : null;
    }}
    onSubmit={(name) =>
      target.kind === "page" ? createPage(name) : createSection(name)}
    onCancel={() => (pendingCreate = null)}
  />
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

  .line {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  /* Keep the label off the select while the icons sit 2px apart, like the
     slot rows' action buttons. */
  .line > .label-mono {
    margin-right: 2.8px;
  }

  .line select {
    flex: 1 1 auto;
    min-width: 0;
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

  /* The row's controls, matching the slot rows' bare icons (A71's editor). */
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0 2px;
  }

  .icon-btn:hover:not(:disabled) {
    color: var(--text-color);
  }

  .icon-btn:disabled {
    color: var(--border-color);
    cursor: default;
  }

  .icon-btn.danger:hover:not(:disabled) {
    color: var(--error-color, var(--danger-color, #b3261e));
  }

  .icon-btn.on {
    color: var(--primary-color);
  }
</style>
