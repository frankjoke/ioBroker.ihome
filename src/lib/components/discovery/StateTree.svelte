<script lang="ts">
  import { nodeKey, type StateNode } from "$lib/config/state-tree";
  import {
    getPickerValue,
    isPickerFetched,
  } from "$lib/picker-values.svelte.js";
  import { formatAge, formatValue } from "$lib/config/format";
  import { pickerExpanded } from "$lib/picker-state.svelte.js";

  let {
    nodes,
    selection,
    onToggle,
  }: {
    nodes: StateNode[];
    selection: Set<string>;
    onToggle: (id: string) => void;
  } = $props();

  function toggleExpand(id: string) {
    if (pickerExpanded.has(id)) pickerExpanded.delete(id);
    else pickerExpanded.add(id);
  }

  function leafValue(node: StateNode): string {
    const pv = getPickerValue(node.id);
    if (pv) {
      return `${formatValue(pv.val, node.obj?.common?.unit)} · ${formatAge(pv.ts)}`;
    }
    return isPickerFetched(node.id) ? "unavailable" : "…";
  }
</script>

{#snippet nodeList(list: StateNode[])}
  <ul class="tree">
    {#each list as node (nodeKey(node))}
      {#if node.kind === "state"}
        <li class="leaf" class:selected={selection.has(node.id)}>
          <label>
            <input
              type="checkbox"
              checked={selection.has(node.id)}
              onchange={() => onToggle(node.id)}
            />
            <span class="leaf-main">
              <span class="leaf-name">{node.label}</span>
              <span class="leaf-id">{node.id}</span>
            </span>
            <span class="leaf-value">{leafValue(node)}</span>
          </label>
        </li>
      {:else}
        <li class="branch">
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

  .leaf label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.25rem 0.5rem;
    border-radius: var(--border-radius-sm, 4px);
    cursor: pointer;
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
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .leaf-value {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
  }
</style>
