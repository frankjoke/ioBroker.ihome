<script lang="ts">
  import PageView from "$lib/components/display/PageView.svelte";
  import LayoutSheet from "$lib/components/layout/LayoutSheet.svelte";
  import DisplayLayoutMenu from "$lib/components/display/DisplayLayoutMenu.svelte";
  import { onMount } from "svelte";
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
    dropTargetFrom,
    planDrop,
    planUndo,
    type DragSection,
    type DragTile,
    type DropPlan,
    type DropTarget,
  } from "$lib/config/drag-drop";
  import {
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

  interface DragState {
    anchor: PlacementAnchor;
    x: number;
    y: number;
    target: DropTarget | null;
  }

  /** Pointer drag in edit mode: mouse/pen moves immediately; touch arms after
   *  a short hold so a normal swipe still scrolls the page. */
  let drag = $state<DragState | null>(null);
  let dragStart: {
    x: number;
    y: number;
    anchor: PlacementAnchor;
  } | null = null;
  interface TouchDrag {
    x: number;
    y: number;
    anchor: PlacementAnchor;
    pointerId: number;
    armed: boolean;
    timer: ReturnType<typeof setTimeout>;
  }
  let touchDrag: TouchDrag | null = null;
  let suppressClick = false;
  /** One-step undo for the last drag drop, cleared when another edit lands. */
  let lastMove: {
    plan: DropPlan;
    /** The store's registry object after the commit (a Svelte proxy). */
    committed: PageRegistry;
  } | null = null;

  const longPress = createLongPress({
    onTrigger: (x, y) => {
      clearTouchDrag();
      openContext(x, y);
    },
  });

  /** View-mode touch: long-press opens the eye-view menu; tap still opens the
   *  tile detail. The tile's own long-press-to-detail was removed for this. */
  const viewLongPress = createLongPress({
    onTrigger: (x, y) => {
      showViewMenu(x, y);
    },
  });

  /** A click that follows the view long-press is not a tile tap. */
  function catchViewClick(node: HTMLElement) {
    const capture = (event: MouseEvent) => {
      if (!viewLongPress.consume()) return;
      event.preventDefault();
      event.stopPropagation();
    };
    node.addEventListener("click", capture, true);
    return {
      destroy: () => node.removeEventListener("click", capture, true),
    };
  }

  function showViewMenu(x: number, y: number): boolean {
    if (sheet.open || tileDetailOpen()) return false;
    const hit = hitAt(x, y);
    const targetPageId = hit && "pageId" in hit ? hit.pageId : (page?.id ?? "");
    if (!targetPageId) return false;
    displayMenu = { x, y, pageId: targetPageId, selection: hit };
    return true;
  }

  function clearTouchDrag(): void {
    if (touchDrag) clearTimeout(touchDrag.timer);
    touchDrag = null;
  }

  /** While a touch drag runs, do not let the page scroll under the finger. */
  function stopDragScroll(node: HTMLElement) {
    const stop = (event: TouchEvent) => {
      // Block scroll on the first move after the hold too, or the browser
      // cancels the pointer before the drag can start.
      if (drag || touchDrag?.armed) event.preventDefault();
    };
    node.addEventListener("touchmove", stop, { passive: false });
    return {
      destroy: () => node.removeEventListener("touchmove", stop),
    };
  }

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
  /** A tile detail is a native top-layer dialog: a fixed menu cannot sit over
   *  it. The detail wins; the eye-view menu is suppressed while it is open. */
  function tileDetailOpen(): boolean {
    return !!document.querySelector("dialog.modal[open]");
  }

  function onStageContextMenu(event: MouseEvent): void {
    if (sheet.open) return;
    if (tileDetailOpen()) {
      event.preventDefault();
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']"))
      return;
    if (!showViewMenu(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onViewPointerDown(event: PointerEvent): void {
    if (sheet.open || event.pointerType !== "touch" || event.button !== 0)
      return;
    const target = event.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']"))
      return;
    viewLongPress.down(event.clientX, event.clientY);
  }

  function onViewPointerMove(event: PointerEvent): void {
    if (sheet.open) return;
    viewLongPress.move(event.clientX, event.clientY);
  }

  function onViewPointerUp(): void {
    viewLongPress.up();
  }

  function onViewPointerCancel(): void {
    viewLongPress.cancel();
  }

  /** Where a dragged tile would land, with the line to show between tiles. */
  function dropTargetAt(x: number, y: number): DropTarget | null {
    const tiles: DragTile[] = [
      ...document.querySelectorAll<HTMLElement>(".stage [data-placement-id]"),
    ].map((element) => ({
      pageId: element.dataset.pageId ?? "",
      sectionId: element.dataset.sectionId ?? "",
      placementId: element.dataset.placementId ?? "",
      rect: element.getBoundingClientRect(),
    }));
    const sections: DragSection[] = [
      ...document.querySelectorAll<HTMLElement>(".stage [data-section-box]"),
    ].map((element) => ({
      pageId: element.dataset.pageId ?? "",
      sectionId: element.dataset.sectionId ?? "",
      rect: element.getBoundingClientRect(),
      contentRect: element
        .querySelector<HTMLElement>(".grid")
        ?.getBoundingClientRect(),
    }));
    return dropTargetFrom(tiles, sections, x, y);
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    if (event.pointerType === "touch") {
      if (!sheet.open) return;
      const hit = hitAt(event.clientX, event.clientY);
      if (hit?.kind === "tile") {
        picked = hit;
        clearTouchDrag();
        const anchor = {
          pageId: hit.pageId,
          sectionId: hit.sectionId,
          placementId: hit.placementId,
        };
        touchDrag = {
          x: event.clientX,
          y: event.clientY,
          anchor,
          pointerId: event.pointerId,
          armed: false,
          timer: setTimeout(() => {
            if (touchDrag) touchDrag.armed = true;
          }, 300),
        };
      }
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
    if (touchDrag) {
      const distance = Math.hypot(
        event.clientX - touchDrag.x,
        event.clientY - touchDrag.y,
      );
      // Before the hold: a swipe is a page scroll, not a drag.
      if (!touchDrag.armed) {
        if (distance > 8) {
          clearTouchDrag();
          longPress.cancel();
        } else {
          longPress.move(event.clientX, event.clientY);
        }
        return;
      }
      // After the hold: moving lifts the tile; the menu still wins if the
      // finger stays still until the long-press delay.
      if (distance <= 6) return;
      const current = touchDrag;
      clearTouchDrag();
      longPress.cancel();
      try {
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      } catch {
        /* no capture: the layer still receives moves over itself */
      }
      drag = {
        anchor: current.anchor,
        x: event.clientX,
        y: event.clientY,
        target: dropTargetAt(event.clientX, event.clientY),
      };
      event.preventDefault();
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
      clearTouchDrag();
      suppressClick = true;
      window.setTimeout(() => {
        suppressClick = false;
      }, 300);
      longPress.consume();
      if (current.target) commitDrop(current.anchor, current.target);
      return;
    }
    dragStart = null;
    clearTouchDrag();
    longPress.up();
  }

  function onPointerCancel(): void {
    drag = null;
    dragStart = null;
    clearTouchDrag();
    longPress.cancel();
  }

  function onPointerLeave(): void {
    if (!drag) {
      clearTouchDrag();
      longPress.cancel();
    }
  }

  function commitDrop(anchor: PlacementAnchor, target: DropTarget): void {
    const plan = planDrop(getPageRegistry(), anchor, target);
    if (!plan || !commitLayout(plan.after)) return;
    picked = { kind: "tile", ...plan.to };
    lastMove = { plan, committed: getPageRegistry() };
    toast.success(`Moved “${plan.title}”`, {
      key: "layout-move",
      timeout: 8000,
      action: { label: "Undo", run: undoMove },
    });
  }

  function undoMove(): void {
    const move = lastMove;
    lastMove = null;
    if (!move) return;
    const restore = planUndo(move.plan, move.committed, getPageRegistry());
    if (!restore || !commitLayout(restore)) return;
    picked = { kind: "tile", ...move.plan.from };
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

  // The tile detail is a native dialog above every z-index; close the eye-view
  // menu as soon as one opens so it cannot be left hidden underneath.
  onMount(() => {
    const observer = new MutationObserver(() => {
      if (tileDetailOpen()) displayMenu = null;
    });
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["open"],
      subtree: true,
    });
    return () => observer.disconnect();
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
      use:catchViewClick
      inert={sheet.open}
      oncontextmenu={onStageContextMenu}
      onpointerdown={onViewPointerDown}
      onpointermove={onViewPointerMove}
      onpointerup={onViewPointerUp}
      onpointercancel={onViewPointerCancel}
      onpointerleave={onViewPointerCancel}
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
      use:stopDragScroll
      tabindex="-1"
      aria-hidden="true"
      title="Click to select, drag to move (hold first on touch), right-click for actions"
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
