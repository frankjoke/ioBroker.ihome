<script lang="ts">
  import {
    addSection,
    appendDevices,
    deletePlacement,
    duplicatePage,
    duplicatePlacement,
    duplicateSection,
    movePage,
    movePlacement,
    moveSection,
    type LayoutSelection,
  } from "$lib/config/layout-ops";
  import {
    matchesMember,
    toFilterable,
    type FilterableDevice,
  } from "$lib/config/pages-ops";
  import type { Group, PageRegistry } from "$lib/types/display";
  import type { EnrichedDevice } from "$lib/types/device";

  let {
    registry,
    devices,
    selection,
    onSelect,
    onChange,
    onDelete,
    onAddTile,
  }: {
    registry: PageRegistry;
    devices: EnrichedDevice[];
    selection: LayoutSelection | null;
    onSelect: (selection: LayoutSelection) => void;
    onChange: (next: PageRegistry) => void;
    /** Page and section deletion asks first — the route owns the dialog. */
    onDelete: (selection: LayoutSelection) => void;
    /** Opens the device picker for a section — the route owns the dialog. */
    onAddTile: (pageId: string, sectionId: string) => void;
  } = $props();

  // Folded tree nodes. Local and transient: how the tree looks is a view of the
  // config, never config itself.
  let folded = $state<Record<string, boolean>>({});

  const toggleFold = (id: string): void => {
    folded = { ...folded, [id]: !folded[id] };
  };

  const deviceOf = (id: string): EnrichedDevice | undefined =>
    devices.find((d) => d.id === id);

  /**
   * The devices the section's filter hint matches that are not in it yet — the
   * "these belong here too" line under a migrated section.
   */
  function hintMissing(section: Group): FilterableDevice[] {
    if (!section.member) return [];
    const listed = new Set((section.tiles ?? []).map((t) => t.device));
    return devices
      .map((d) => toFilterable(d))
      .filter((d) => !listed.has(d.id) && matchesMember(d, section.member!));
  }
</script>

<div class="tree" role="tree" aria-label="Pages, sections and tiles">
  {#each registry.pages as page, pageIndex (page.id)}
    <div
      class="node"
      class:selected={selection?.kind === "page" &&
        selection.pageId === page.id}
      role="treeitem"
      aria-selected={selection?.kind === "page" && selection.pageId === page.id}
    >
      <button
        type="button"
        class="fold"
        aria-label={folded[page.id] ? "Expand page" : "Fold page"}
        onclick={() => toggleFold(page.id)}
      >
        <span class="material-symbols-outlined" aria-hidden="true"
          >{folded[page.id] ? "chevron_right" : "expand_more"}</span
        >
      </button>
      <button
        type="button"
        class="label"
        onclick={() => onSelect({ kind: "page", pageId: page.id })}
      >
        {#if page.icon}<span
            class="material-symbols-outlined"
            aria-hidden="true">{page.icon}</span
          >{/if}
        <span class="title">{page.title || "—"}</span>
      </button>
      <span class="row-actions">
        <button
          type="button"
          class="icon-btn"
          title="Add section"
          aria-label="Add section"
          onclick={() => onChange(addSection(registry, page.id))}
        >
          <span class="material-symbols-outlined">add</span>
        </button>
        <button
          type="button"
          class="icon-btn"
          title="Duplicate page"
          aria-label="Duplicate page"
          onclick={() => onChange(duplicatePage(registry, page.id))}
        >
          <span class="material-symbols-outlined">content_copy</span>
        </button>
        <button
          type="button"
          class="icon-btn"
          title="Move up"
          aria-label="Move up"
          disabled={pageIndex === 0}
          onclick={() => onChange(movePage(registry, pageIndex, pageIndex - 1))}
        >
          <span class="material-symbols-outlined">arrow_upward</span>
        </button>
        <button
          type="button"
          class="icon-btn"
          title="Move down"
          aria-label="Move down"
          disabled={pageIndex === registry.pages.length - 1}
          onclick={() => onChange(movePage(registry, pageIndex, pageIndex + 1))}
        >
          <span class="material-symbols-outlined">arrow_downward</span>
        </button>
        <button
          type="button"
          class="icon-btn danger"
          title="Delete page"
          aria-label="Delete page"
          onclick={() => onDelete({ kind: "page", pageId: page.id })}
        >
          <span class="material-symbols-outlined">delete</span>
        </button>
      </span>
    </div>

    {#if !folded[page.id]}
      {#each page.groups as section, sectionIndex (section.id)}
        <div
          class="node section"
          class:selected={selection?.kind === "section" &&
            selection.sectionId === section.id}
          class:no-tiles={(section.tiles ?? []).length === 0}
          role="treeitem"
          aria-selected={selection?.kind === "section" &&
            selection.sectionId === section.id}
        >
          <button
            type="button"
            class="fold"
            aria-label={folded[section.id] ? "Expand section" : "Fold section"}
            onclick={() => toggleFold(section.id)}
          >
            <span class="material-symbols-outlined" aria-hidden="true"
              >{folded[section.id] ? "chevron_right" : "expand_more"}</span
            >
          </button>
          <button
            type="button"
            class="label"
            onclick={() =>
              onSelect({
                kind: "section",
                pageId: page.id,
                sectionId: section.id,
              })}
          >
            {#if section.icon}<span
                class="material-symbols-outlined"
                aria-hidden="true">{section.icon}</span
              >{/if}
            <span class="title">{section.title || "—"}</span>
            {#if (section.tiles ?? []).length === 0}
              <span class="hint-badge text-muted">empty</span>
            {/if}
          </button>
          <span class="row-actions">
            <button
              type="button"
              class="icon-btn"
              title="Duplicate section"
              aria-label="Duplicate section"
              onclick={() =>
                onChange(duplicateSection(registry, page.id, section.id))}
            >
              <span class="material-symbols-outlined">content_copy</span>
            </button>
            <button
              type="button"
              class="icon-btn"
              title="Move up"
              aria-label="Move up"
              disabled={sectionIndex === 0}
              onclick={() =>
                onChange(
                  moveSection(
                    registry,
                    page.id,
                    sectionIndex,
                    sectionIndex - 1,
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
              disabled={sectionIndex === page.groups.length - 1}
              onclick={() =>
                onChange(
                  moveSection(
                    registry,
                    page.id,
                    sectionIndex,
                    sectionIndex + 1,
                  ),
                )}
            >
              <span class="material-symbols-outlined">arrow_downward</span>
            </button>
            <button
              type="button"
              class="icon-btn danger"
              title="Delete section"
              aria-label="Delete section"
              onclick={() =>
                onDelete({
                  kind: "section",
                  pageId: page.id,
                  sectionId: section.id,
                })}
            >
              <span class="material-symbols-outlined">delete</span>
            </button>
          </span>
        </div>

        {#if !folded[section.id]}
          {#each section.tiles ?? [] as tile, tileIndex (tile.id)}
            <div
              class="node tile"
              class:selected={selection?.kind === "tile" &&
                selection.placementId === tile.id}
              role="treeitem"
              aria-selected={selection?.kind === "tile" &&
                selection.placementId === tile.id}
            >
              <span class="fold"></span>
              <button
                type="button"
                class="label"
                onclick={() =>
                  onSelect({
                    kind: "tile",
                    pageId: page.id,
                    sectionId: section.id,
                    placementId: tile.id,
                  })}
              >
                {#if !deviceOf(tile.device)}
                  <span
                    class="material-symbols-outlined warn"
                    title="This device is not in the registry any more"
                    aria-hidden="true">warning</span
                  >
                {/if}
                <span class="title"
                  >{tile.title ||
                    deviceOf(tile.device)?.name ||
                    tile.device}</span
                >
                {#if tile.tile?.size}
                  <span class="hint-badge text-muted"
                    >{tile.tile.size.w}×{tile.tile.size.h}</span
                  >
                {/if}
              </button>
              <span class="row-actions">
                <button
                  type="button"
                  class="icon-btn"
                  title="Duplicate tile"
                  aria-label="Duplicate tile"
                  onclick={() =>
                    onChange(
                      duplicatePlacement(
                        registry,
                        page.id,
                        section.id,
                        tile.id,
                      ),
                    )}
                >
                  <span class="material-symbols-outlined">content_copy</span>
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  title="Move up"
                  aria-label="Move up"
                  disabled={tileIndex === 0}
                  onclick={() =>
                    onChange(
                      movePlacement(
                        registry,
                        {
                          pageId: page.id,
                          sectionId: section.id,
                          index: tileIndex,
                        },
                        {
                          pageId: page.id,
                          sectionId: section.id,
                          index: tileIndex - 1,
                        },
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
                  disabled={tileIndex === (section.tiles ?? []).length - 1}
                  onclick={() =>
                    onChange(
                      movePlacement(
                        registry,
                        {
                          pageId: page.id,
                          sectionId: section.id,
                          index: tileIndex,
                        },
                        {
                          pageId: page.id,
                          sectionId: section.id,
                          index: tileIndex + 1,
                        },
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
                  onclick={() =>
                    onChange(
                      deletePlacement(registry, page.id, section.id, tile.id),
                    )}
                >
                  <span class="material-symbols-outlined">delete</span>
                </button>
              </span>
            </div>
          {/each}

          <!-- A placeholder until the picker dialog (Task 9) replaces it: pick a
               device that is not in this section yet and add it as a tile. -->
          <div class="add-tile">
            <button
              type="button"
              class="btn"
              onclick={() => onAddTile(page.id, section.id)}
            >
              Add tile
            </button>
            {#if hintMissing(section).length}
              <span class="text-muted hint-missing"
                >{hintMissing(section).length} matching this section's filter
                {hintMissing(section).length === 1 ? "is" : "are"} not here</span
              >
              <button
                type="button"
                class="btn"
                onclick={() =>
                  onChange(
                    appendDevices(
                      registry,
                      page.id,
                      section.id,
                      hintMissing(section).map((d) => d.id),
                    ),
                  )}
              >
                Add them
              </button>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  {/each}

  {#if registry.pages.length === 0}
    <p class="text-muted empty-tree">No pages yet — add one.</p>
  {/if}
</div>

<style>
  .tree {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }

  .node {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 1px 2px;
    border-radius: var(--border-radius-sm, 6px);
  }

  .node:hover {
    background-color: var(--surface-container);
  }

  .node.selected {
    background-color: var(--surface-container-high, var(--surface-container));
    outline: 1px solid var(--primary-color);
  }

  .node.section {
    margin-left: 1rem;
  }

  .node.tile {
    margin-left: 2rem;
  }

  .fold {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .fold .material-symbols-outlined {
    font-size: 18px;
  }

  .label {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    flex: 1 1 auto;
    min-width: 0;
    padding: 3px 2px;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .label .material-symbols-outlined {
    font-size: 17px;
    color: var(--text-muted);
  }

  .label .warn {
    color: var(--warning-color);
  }

  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .node.no-tiles .title {
    color: var(--text-muted);
  }

  .hint-badge {
    font-size: 0.7rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
    padding: 0 6px;
  }

  .row-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    opacity: 0.35;
  }

  .node:hover .row-actions,
  .node.selected .row-actions {
    opacity: 1;
  }

  .add-tile {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin: 2px 0 6px 3rem;
  }

  .hint-missing {
    font-size: 0.75rem;
  }

  .empty-tree {
    padding: 1rem 0;
  }
</style>
