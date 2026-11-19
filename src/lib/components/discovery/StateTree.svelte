<script lang="ts">
  import { nodeKey, type StateNode } from "$lib/config/state-tree";
  import {
    getPickerValue,
    isPickerFetched,
  } from "$lib/picker-values.svelte.js";
  import { formatAge, formatValue } from "$lib/config/format";
  import { pickerExpanded } from "$lib/picker-state.svelte.js";
  import { enumsOfState, enumLabel } from "$lib/config/rooms";
  import { aliasBaseIds } from "$lib/config/template-suggest";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import type { SourceOverride } from "$lib/types/overrides";

  let {
    nodes,
    selection,
    onToggle,
    onPick,
    enums = undefined,
    objects = undefined,
    onAlias = undefined,
    overridesOf = undefined,
    expandedOverrides = undefined,
    onToggleOverrides = undefined,
    onAddOverride = undefined,
    onEditOverride = undefined,
  }: {
    nodes: StateNode[];
    selection: Set<string>;
    onToggle: (id: string) => void;
    /** When set, a leaf is a one-click button instead of a checkbox. The
     *  optional id picks a sub-entry (an override of that state). */
    onPick?: (id: string, overrideId?: string) => void;
    /** The enum cache, so a leaf's tooltip says which room/function it is in. */
    enums?: any;
    /** The object cache, to link an alias only when its original exists. */
    objects?: Map<string, any>;
    /** Jump to the state an alias points at. */
    onAlias?: (id: string) => void;
    /** A state's overrides, keyed by its real broker id (variable leaves too). */
    overridesOf?: (id: string) => SourceOverride[];
    /** The states whose override sub-list is open. */
    expandedOverrides?: Set<string>;
    onToggleOverrides?: (id: string) => void;
    /** Offer "add override" on the row; the browser opens its modal. */
    onAddOverride?: (stateId: string, object: any) => void;
    onEditOverride?: (
      stateId: string,
      object: any,
      override: SourceOverride,
    ) => void;
  } = $props();

  /** The first alias source that exists in the broker, or "". */
  function aliasTarget(node: StateNode): string {
    return aliasBaseIds(node.obj).find((id) => objects?.has(id)) ?? "";
  }

  function toggleExpand(id: string) {
    if (pickerExpanded.has(id)) pickerExpanded.delete(id);
    else pickerExpanded.add(id);
  }

  /** The row's hover text: the id plus the metadata the filters use. */
  function leafTitle(node: StateNode): string {
    const id = node.obj?._id ?? node.id;
    const common = node.obj?.common ?? {};
    const rooms = enumsOfState(enums, id, "rooms").map((r: string) =>
      enumLabel(enums, r, "rooms"),
    );
    const functions = enumsOfState(enums, id, "functions").map((f: string) =>
      enumLabel(enums, f, "functions"),
    );
    return [
      id,
      rooms.length ? `room: ${rooms.join(", ")}` : "",
      functions.length ? `function: ${functions.join(", ")}` : "",
      common.role ? `role: ${common.role}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function leafValue(node: StateNode): string {
    const id = node.obj?._id ?? node.id;
    const pv = getPickerValue(id);
    if (pv) {
      return `${formatValue(pv.val, node.obj?.common?.unit, node.obj?.common?.role)} · ${formatAge(pv.ts)}`;
    }
    return isPickerFetched(id) ? "unavailable" : "…";
  }
</script>

{#snippet leafBody(node: StateNode)}
  <span class="leaf-main">
    <span class="leaf-name">{node.label}</span>
    <span class="leaf-id">{node.obj?._id ?? node.id}</span>
  </span>
  <span class="leaf-value">{leafValue(node)}</span>
{/snippet}

{#snippet nodeList(list: StateNode[])}
  <ul class="tree">
    {#each list as node (nodeKey(node))}
      {#if node.kind === "state"}
        {@const realId = node.obj?._id ?? node.id}
        {@const stateOverrides = overridesOf?.(realId) ?? []}
        {@const open = expandedOverrides?.has(realId) ?? false}
        <li class="leaf-item" data-node={nodeKey(node)}>
          <div
            class="leaf"
            class:selected={selection.has(node.id)}
            title={leafTitle(node)}
          >
            {#if onPick}
              <button
                type="button"
                class="leaf-pick"
                onclick={() => onPick?.(node.id)}
              >
                {@render leafBody(node)}
              </button>
            {:else}
              <label>
                <input
                  type="checkbox"
                  checked={selection.has(node.id)}
                  onchange={() => onToggle(node.id)}
                />
                {@render leafBody(node)}
              </label>
            {/if}
            {#if onAddOverride}
              {#if stateOverrides.length}
                <IconButton
                  icon={open ? "expand_more" : "chevron_right"}
                  label={`Show ${stateOverrides.length} override${stateOverrides.length === 1 ? "" : "s"} for ${node.label}`}
                  active={open}
                  onclick={() => onToggleOverrides?.(realId)}
                />
              {/if}
              <IconButton
                icon="add"
                label={`Add override for ${node.label}`}
                onclick={() => onAddOverride?.(realId, node.obj)}
              />
            {/if}
            {#if onAlias}
              {@const base = aliasTarget(node)}
              {#if base}
                <IconButton
                  icon="arrow_outward"
                  label={`Go to original state ${base}`}
                  title={`Original: ${base}`}
                  onclick={() => onAlias?.(base)}
                />
              {/if}
            {/if}
          </div>
          {#if open && stateOverrides.length}
            <ul class="overrides">
              {#each stateOverrides as entry (entry.id)}
                <li class="override-row">
                  <button
                    type="button"
                    class="override-pick"
                    title={`${entry.kind} override · ${entry.name}`}
                    onclick={() => onPick?.(node.id, entry.id)}
                  >
                    <span class="override-name">{entry.name}</span>
                    {#if entry.label && entry.label !== entry.name}
                      <span class="override-label text-muted"
                        >{entry.label}</span
                      >
                    {/if}
                    <span class="override-kind text-muted">{entry.kind}</span>
                  </button>
                  {#if onEditOverride}
                    <IconButton
                      icon="edit"
                      label={`Edit override ${entry.name}`}
                      onclick={() => onEditOverride?.(realId, node.obj, entry)}
                    />
                  {/if}
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {:else}
        <li class="branch" data-branch={node.id}>
          <button
            type="button"
            class="branch-btn"
            onclick={() => toggleExpand(node.id)}
          >
            <span class="material-symbols-outlined">
              {pickerExpanded.has(node.id) ? "expand_more" : "chevron_right"}
            </span>
            <span>{node.label}</span>
          </button>
          {#if pickerExpanded.has(node.id) && node.children}
            {@render nodeList(node.children)}
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
{/snippet}

{@render nodeList(nodes)}

<style>
  .tree {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .branch > .tree {
    padding-left: 1rem;
  }

  .branch-btn {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    width: 100%;
    padding: 0.25rem 0.35rem;
    border: none;
    background: transparent;
    color: var(--text-color);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
    border-radius: var(--border-radius-sm, 4px);
  }

  .branch-btn:hover {
    background-color: var(--surface-container);
  }

  .branch-btn .material-symbols-outlined {
    font-size: 18px;
    color: var(--text-muted);
  }

  .leaf-item {
    display: block;
  }

  .leaf {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }

  .leaf label,
  .leaf-pick {
    display: flex;
    align-items: center;
    flex: 1 1 auto;
    min-width: 0;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: var(--border-radius-sm, 4px);
    cursor: pointer;
  }

  .leaf-pick {
    width: 100%;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
  }

  .leaf label:hover,
  .leaf-pick:hover {
    background-color: var(--surface-container);
  }

  .leaf.selected label {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .leaf-main {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .leaf-name {
    font-size: var(--body-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .leaf-id {
    font-family: var(--font-family);
    font-size: 0.7rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .leaf-value {
    font-family: var(--font-family);
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .overrides {
    list-style: none;
    margin: 0;
    padding: 0 0 0 2.1rem;
  }

  .override-row {
    display: flex;
    align-items: center;
    gap: 0.15rem;
  }

  .override-pick {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.2rem 0.5rem;
    border: none;
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .override-pick:hover {
    background-color: var(--surface-container);
  }

  .override-name {
    font-size: var(--body-sm);
    font-weight: 600;
  }

  .override-label {
    font-size: var(--body-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .override-kind {
    margin-left: auto;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
</style>
