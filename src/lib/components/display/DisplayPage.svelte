<script lang="ts">
  import PageView from "$lib/components/display/PageView.svelte";
  import LayoutSheet from "$lib/components/layout/LayoutSheet.svelte";
  import DisplayLayoutMenu from "$lib/components/display/DisplayLayoutMenu.svelte";
  import {
    commitLayout,
    getPageRegistry,
    getPagesLoadKind,
    setLastPage,
  } from "$lib/stores/pages.svelte.js";
  import { pagePlaceholder } from "$lib/config/pages-ops";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { sheet } from "$lib/stores/sheet.svelte.js";
  import { goto } from "$app/navigation";
  import { placementUnder, sectionTitleUnder } from "$lib/config/tile-hit";
  import {
    dropIndex,
    movePlacement,
    type LayoutSelection,
    type PlacementAnchor,
  } from "$lib/config/layout-ops";
  import { createLongPress } from "$lib/utils/long-press";
  import { toast } from "$lib/stores/toasts.svelte";
  import type { Page, PageRegistry } from "$lib/types/display";

  /** The display as one page shows it — at "/" (the page the wall left behind)
   *  and at "/p/<id>" alike, so the editor is a mode of both and not just of
   *  the root route. The page itself is the route's business. */
  let { page }: { page?: Page } = $props();

  // Why there is no page to draw: still connecting (the document arrives a
  // moment after the socket, so a page-less first paint is not yet a verdict),
  // a read that came back empty-handed, or really no pages.
  const placeholder = $derived(
    pagePlaceholder(ioBroker.connected, getPagesLoadKind()),
  );

  /** The tile or section the last click in the display landed on (A48). */
  let picked = $state<LayoutSelection | null>(null);
  /** The eye-view menu: a right-click while the layout sheet is closed. */
  let displayMenu = $state<{
    x: number;
    y: number;
    pageId: string;
    selection: LayoutSelection | null;
  } | null>(null);
  /** The sheet's imperative corner: it owns the menu and its actions. */
  let layoutSheet = $state<{
    openContext: (event: {
      x: number;
      y: number;
      hit: LayoutSelection | null;
    }) => void;
  } | null>(null);

  interface DropTarget {
    pageId: string;
    sectionId: string;
    /** The gap index before which the tile is inserted. */
    index: number;
    line: { left: number; top: number; height: number };
  }
  interface DragState {
    anchor: PlacementAnchor;
    x: number;
    y: number;
    target: DropTarget | null;
  }

  /** Pointer drag in edit mode: a mouse/pen moves one tile. Touch keeps the
   *  long-press menu (a drag there would fight page scrolling). */
  let drag = $state<DragState | null>(null);
  let dragStart: {
    x: number;
    y: number;
    anchor: PlacementAnchor;
  } | null = null;
  let suppressClick = false;
  /** One-step undo for the last drag drop, cleared when another edit lands. */
  let lastMove: {
    before: PageRegistry;
    after: PageRegistry;
    from: PlacementAnchor;
  } | null = null;

  const longPress = createLongPress({
    onTrigger: (x, y) => openContext(x, y),
  });

  function hitAt(x: number, y: number): LayoutSelection | null {
    // The tiles are inside the inert stage, so they cannot be hit-tested: the
    // boxes are walked instead (the layer is the only target there is).
    const hit = placementUnder(
      [...document.querySelectorAll(".stage [data-placement-id]")],
      x,
      y,
    );
    if (hit) {
      // The cursor's page is the display's page (A45), so the page moves here —
      // one state write, in the click, not an effect reading the display's page
      // it would then re-apply on every later page change.
      setLastPage(hit.pageId);
      return { kind: "tile", ...hit };
    }
    const section = sectionTitleUnder(
      [...document.querySelectorAll(".stage [data-section-title]")],
      x,
      y,
    );
    if (!section) return null;
    setLastPage(section.pageId);
    return { kind: "section", ...section };
  }

  function pick(event: MouseEvent): void {
    // The click that follows a drop is not a second pick.
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    // A long-press already opened the menu; its click is not a new pick.
    if (longPress.consume()) return;
    const hit = hitAt(event.clientX, event.clientY);
    if (hit) picked = hit;
  }

  function openContext(x: number, y: number): void {
    if (!sheet.open) return;
    layoutSheet?.openContext({ x, y, hit: hitAt(x, y) });
  }

  function onContextMenu(event: MouseEvent): void {
    if (!sheet.open) return;
    event.preventDefault();
    longPress.cancel();
    longPress.consume(); // a native long-press menu must not swallow later clicks
    openContext(event.clientX, event.clientY);
  }

  /** In eye view a right-click opens the quick menu for a tile, a section
   *  title or free page space; the browser keeps its own menu over inputs and
   *  editable text. */
  function onStageContextMenu(event: MouseEvent): void {
    if (sheet.open) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']"))
      return;
    const hit = hitAt(event.clientX, event.clientY);
    const targetPageId = hit && "pageId" in hit ? hit.pageId : (page?.id ?? "");
    if (!targetPageId) return;
    event.preventDefault();
    event.stopPropagation();
    displayMenu = {
      x: event.clientX,
      y: event.clientY,
      pageId: targetPageId,
      selection: hit,
    };
  }

  /** Where a dragged tile would land, with the line to show between tiles. */
  function dropTargetAt(x: number, y: number): DropTarget | null {
    const tiles = [
      ...document.querySelectorAll<HTMLElement>(".stage [data-placement-id]"),
    ];
    const hit = placementUnder(tiles, x, y);
    if (hit) {
      const element = tiles.find(
        (tile) =>
          tile.dataset.pageId === hit.pageId &&
          tile.dataset.sectionId === hit.sectionId &&
          tile.dataset.placementId === hit.placementId,
      );
      if (!element) return null;
      const sectionTiles = tiles.filter(
        (tile) =>
          tile.dataset.pageId === hit.pageId &&
          tile.dataset.sectionId === hit.sectionId,
      );
      const index = sectionTiles.indexOf(element);
      const rect = element.getBoundingClientRect();
      const before = x < rect.left + rect.width / 2;
      return {
        pageId: hit.pageId,
        sectionId: hit.sectionId,
        index: before ? index : index + 1,
        line: {
          left: before ? rect.left - 4 : rect.right + 4,
          top: rect.top,
          height: rect.height,
        },
      };
    }
    const sections = [
      ...document.querySelectorAll<HTMLElement>(".stage [data-section-box]"),
    ];
    const section = sections.find((entry) => {
      const r = entry.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    });
    if (!section) return null;
    const sectionId = section.dataset.sectionId ?? "";
    const targetPageId = section.dataset.pageId ?? page?.id ?? "";
    if (!sectionId || !targetPageId) return null;
    const sectionTiles = tiles.filter(
      (tile) =>
        tile.dataset.pageId === targetPageId &&
        tile.dataset.sectionId === sectionId,
    );
    const last = sectionTiles.at(-1)?.getBoundingClientRect();
    const grid = section.querySelector<HTMLElement>(".grid");
    const box = section.getBoundingClientRect();
    const gridBox = grid?.getBoundingClientRect();
    return {
      pageId: targetPageId,
      sectionId,
      index: sectionTiles.length,
      line: {
        left: last ? last.right + 4 : (gridBox?.left ?? box.left) + 4,
        top: last ? last.top : (gridBox?.top ?? box.top) + 8,
        height: last ? last.height : 40,
      },
    };
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (event.pointerType === "touch") {
      longPress.down(event.clientX, event.clientY);
      return;
    }
    if (!sheet.open) return;
    const hit = hitAt(event.clientX, event.clientY);
    if (hit?.kind !== "tile") return;
    dragStart = {
      x: event.clientX,
      y: event.clientY,
      anchor: {
        pageId: hit.pageId,
        sectionId: hit.sectionId,
        placementId: hit.placementId,
      },
    };
    picked = hit;
    try {
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      /* synthetic events and browsers without capture: the layer still gets
         the moves while the pointer stays over it */
    }
  }

  function onPointerMove(event: PointerEvent): void {
    if (drag) {
      event.preventDefault();
      drag = {
        ...drag,
        x: event.clientX,
        y: event.clientY,
        target: dropTargetAt(event.clientX, event.clientY),
      };
      return;
    }
    if (dragStart) {
      if (
        Math.hypot(event.clientX - dragStart.x, event.clientY - dragStart.y) < 6
      ) {
        return;
      }
      drag = {
        anchor: dragStart.anchor,
        x: event.clientX,
        y: event.clientY,
        target: dropTargetAt(event.clientX, event.clientY),
      };
      longPress.cancel();
      return;
    }
    longPress.move(event.clientX, event.clientY);
  }

  function onPointerUp(): void {
    if (drag) {
      const current = drag;
      drag = null;
      dragStart = null;
      suppressClick = true;
      window.setTimeout(() => {
        suppressClick = false;
      }, 300);
      longPress.consume();
      if (current.target) commitDrop(current.anchor, current.target);
      return;
    }
    dragStart = null;
    longPress.up();
  }

  function onPointerCancel(): void {
    drag = null;
    dragStart = null;
    longPress.cancel();
  }

  function onPointerLeave(): void {
    if (!drag) longPress.cancel();
  }

  function commitDrop(anchor: PlacementAnchor, target: DropTarget): void {
    const before = getPageRegistry();
    const sourceSection = before.pages
      .find((entry) => entry.id === anchor.pageId)
      ?.groups?.find((group) => group.id === anchor.sectionId);
    const targetSection = before.pages
      .find((entry) => entry.id === target.pageId)
      ?.groups?.find((group) => group.id === target.sectionId);
    const fromIndex =
      sourceSection?.tiles?.findIndex(
        (tile) => tile.id === anchor.placementId,
      ) ?? -1;
    if (fromIndex < 0 || !targetSection) return;
    const same =
      anchor.pageId === target.pageId && anchor.sectionId === target.sectionId;
    const toIndex = dropIndex(fromIndex, target.index, same);
    // Dropping on itself is a no-op only within the same section; moving to
    // index 0 of another section is a real move even when the indices match.
    if (same && toIndex === fromIndex) return;
    const next = movePlacement(
      before,
      {
        pageId: anchor.pageId,
        sectionId: anchor.sectionId,
        index: fromIndex,
      },
      {
        pageId: target.pageId,
        sectionId: target.sectionId,
        index: toIndex,
      },
    );
    if (next === before || !commitLayout(next)) return;
    picked = {
      kind: "tile",
      pageId: target.pageId,
      sectionId: target.sectionId,
      placementId: anchor.placementId,
    };
    lastMove = { before, after: getPageRegistry(), from: anchor };
    const title = sourceSection.tiles?.[fromIndex]?.title?.trim() || "Tile";
    toast.success(`Moved “${title}”`, {
      key: "layout-move",
      timeout: 8000,
      action: { label: "Undo", run: undoMove },
    });
  }

  function undoMove(): void {
    const move = lastMove;
    lastMove = null;
    if (!move) return;
    // A later edit is not overwritten by a stale undo.
    if (getPageRegistry() !== move.after) return;
    if (!commitLayout(move.before)) return;
    picked = { kind: "tile", ...move.from };
  }

  const dragTitle = $derived.by(() => {
    const anchor = drag?.anchor;
    if (!anchor) return "";
    const section = getPageRegistry()
      .pages.find((entry) => entry.id === anchor.pageId)
      ?.groups?.find((group) => group.id === anchor.sectionId);
    return (
      (
        section?.tiles?.find((tile) => tile.id === anchor.placementId)?.title ??
        ""
      ).trim() || "Tile"
    );
  });

  // A pick is spent when the sheet closes: reopening must not jump back to the
  // old tile, and a stale pick must not clobber a handoff that arrives with a
  // fresh sheet (the bug 3911929 fixed).
  $effect(() => {
    if (!sheet.open) picked = null;
  });

  // The eye-view menu belongs to view mode; opening the editor retires it.
  $effect(() => {
    if (sheet.open) displayMenu = null;
  });

  /**
   * The sheet's Page line moves the display with it. On a page route that also
   * means the route: `#/p/<id>` pins the page, so without this the dropdown
   * would show the new page while the pane kept editing the URL's one. `goto`,
   * not `location.hash = …` — the hash router reloads on a direct edit.
   */
  function showPage(id: string): void {
    setLastPage(id);
    void goto(`#/p/${id}`);
  }
</script>

<div class="display" class:editing={sheet.open}>
  {#if page}
    <!-- The display is a picture while the sheet is open (A43): inert takes it
         out of reach of keyboard as well as pointer — the pick layer below is
         the only thing a press can land on. -->
    <div
      class="stage"
      role="presentation"
      inert={sheet.open}
      oncontextmenu={onStageContextMenu}
    >
      {#key page.id}
        <PageView {page} />
      {/key}
    </div>
  {:else if placeholder === "connecting"}
    <p class="empty text-muted">
      <span class="spinner material-symbols-outlined">progress_activity</span>
      Trying to connect…
    </p>
  {:else if placeholder === "unreadable"}
    <p class="empty text-muted">
      The page list could not be read — check the connection, then reload.
    </p>
  {:else}
    <p class="empty text-muted">
      No pages yet. They are created from your rooms and functions on first
      load.
    </p>
  {/if}

  <!-- The selection layer (A48): transparent, over every tile, under the sheet
       (z 40) and outside the inert stage. A press on a tile hands its placement
       to the sheet; a gap or a heading answers null and selects nothing. It is
       not a control — pointer only, so no tab stop and nothing to announce. -->
  {#if sheet.open}
    <button
      type="button"
      class="pick-layer"
      class:dragging={!!drag}
      tabindex="-1"
      aria-hidden="true"
      title="Click to select, drag to move, right-click for actions"
      onclick={pick}
      oncontextmenu={onContextMenu}
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      onpointercancel={onPointerCancel}
      onpointerleave={onPointerLeave}
    ></button>
  {/if}

  {#if drag}
    <div class="drag-ghost" style="left: {drag.x + 14}px; top: {drag.y + 14}px">
      {dragTitle}
    </div>
    {#if drag.target}
      <div
        class="drop-line"
        style="left: {drag.target.line.left}px; top: {drag.target.line
          .top}px; height: {drag.target.line.height}px"
      ></div>
    {/if}
  {/if}

  {#if displayMenu}
    <DisplayLayoutMenu
      x={displayMenu.x}
      y={displayMenu.y}
      pageId={displayMenu.pageId}
      selection={displayMenu.selection}
      onclose={() => (displayMenu = null)}
    />
  {/if}
</div>

<!-- The editor is a mode of this page, not a place you go: the sheet opens over
     the display, and the display's page is the sheet's page (A43/A45). It also
     mounts with no page at all — that is where "Add page" lives (A44). -->
{#if sheet.open}
  <LayoutSheet
    bind:this={layoutSheet}
    pageId={page?.id ?? ""}
    onPage={showPage}
    onClose={() => (sheet.open = false)}
    {picked}
  />
{/if}

<style>
  .display {
    position: relative;
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* The circle's stage: it hands the remaining height to the page so a short
     page still paints the whole display without a 100vh overflow. */
  .stage {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
  }

  /* The display's selection layer (A48): transparent, over every tile, under
     the sheet (z 40). It is the whole of the display's inertness (A43) — a
     press can only report what it landed on, never act on it. */
  .pick-layer {
    position: absolute;
    inset: 0;
    z-index: 10;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: pointer;
    -webkit-touch-callout: none;
    user-select: none;
  }

  .pick-layer.dragging {
    cursor: grabbing;
  }

  .drag-ghost {
    position: fixed;
    z-index: 60;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--primary-color);
    border-radius: var(--border-radius);
    background-color: var(--surface-color);
    color: var(--text-color);
    font-size: var(--body-sm);
    box-shadow: var(--shadow-small);
    pointer-events: none;
  }

  .drop-line {
    position: fixed;
    z-index: 60;
    width: 3px;
    border-radius: 2px;
    background-color: var(--primary-color);
    box-shadow: 0 0 0 1px var(--surface-color);
    pointer-events: none;
  }

  /* Wide: the sheet takes the right-hand strip, the display keeps the rest (it
     reflows to whatever width it gets). Narrow: the sheet is a bottom sheet and
     the display keeps the top strip. */
  @media (min-width: 821px) {
    .display.editing {
      padding-right: 440px;
    }
  }

  @media (max-width: 820px) {
    .display.editing {
      padding-bottom: 62vh;
    }
  }

  .empty {
    padding: 2rem;
    text-align: center;
  }

  /* The connecting notice: a turning glyph, so a slow broker reads as "working
     on it" rather than as an empty app. */
  .spinner {
    display: inline-block;
    vertical-align: -4px;
    margin-right: 0.4rem;
    animation: spin 1.2s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
