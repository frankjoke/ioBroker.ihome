<script lang="ts">
  import { base } from "$app/paths";
  import Icon from "$lib/components/common/Icon.svelte";
  import {
    filterLibrary,
    libraryKeywordCounts,
    splitTwins,
  } from "$lib/config/icon-library";
  import { getIconPool, initIconPool } from "$lib/stores/icon-pool.svelte";
  import { getPageRegistry } from "$lib/stores/pages.svelte.js";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { collectDocumentIcons, isImageIcon } from "$lib/utils/icon-url";
  import { isHtmlIcon } from "$lib/config/icon-html";

  /** The one editor picker: the library, narrowed by keywords. The main tile
   *  icon may pick an on/off pair; every other consumer sees the same grid. */
  let {
    icon = undefined,
    onPick,
    onClose,
  }: {
    /** The current value, for marking and the custom prefill. */
    icon?: string;
    /** The picked value; "" clears the icon. `active` comes with a twin. */
    onPick: (value: string, meta?: { active?: string }) => void;
    onClose: () => void;
  } = $props();

  let search = $state("");
  let selected = $state<string[]>([]);
  let inUse = $state(false);
  let customOpen = $state(false);
  // svelte-ignore state_referenced_locally
  let url = $state(icon && (isImageIcon(icon) || isHtmlIcon(icon)) ? icon : "");

  $effect(() => {
    void initIconPool();
  });

  const library = $derived(getIconPool().library);
  const keywordCounts = $derived(libraryKeywordCounts(library));
  const inUseValues = $derived(
    new Set(
      collectDocumentIcons(getPageRegistry(), getTemplateRegistry()),
    ) as Set<string>,
  );
  const shown = $derived.by(() => {
    const list = filterLibrary(library, selected, search);
    return inUse ? list.filter((entry) => inUseValues.has(entry.value)) : list;
  });
  const { twins, singles } = $derived(splitTwins(shown));

  function toggleKeyword(word: string): void {
    selected = selected.includes(word)
      ? selected.filter((item) => item !== word)
      : [...selected, word];
  }

  function onKey(event: KeyboardEvent): void {
    if (event.key === "Escape") onClose();
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="modal" role="dialog" aria-modal="true" aria-label="Choose an icon">
  <div class="modal-content">
    <div class="modal-head">
      <h3>Choose an icon</h3>
      <button
        type="button"
        class="icon-btn"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <input type="search" placeholder="Search keywords…" bind:value={search} />

    <div class="chips">
      <button
        type="button"
        class="chip"
        class:active={inUse}
        title="Only icons already used in pages or templates"
        onclick={() => (inUse = !inUse)}
      >
        In use
      </button>
      {#each keywordCounts as entry (entry.keyword)}
        <button
          type="button"
          class="chip"
          class:active={selected.includes(entry.keyword)}
          onclick={() => toggleKeyword(entry.keyword)}
        >
          {entry.keyword}
          <span class="chip-count">{entry.count}</span>
        </button>
      {/each}
    </div>

    <div class="results">
      {#if twins.length > 0}
        <p class="label-mono group-title">On / Off pairs</p>
        <div class="grid">
          {#each twins as entry (entry.id)}
            <button
              type="button"
              class="pair"
              class:current={entry.value === icon || entry.activeValue === icon}
              title={`${entry.name ?? entry.value} (pair)`}
              aria-label={`${entry.name ?? entry.value} (pair)`}
              onclick={() => onPick(entry.value, { active: entry.activeValue })}
            >
              <Icon value={entry.value} size={22} />
              <span class="pair-twin">
                <Icon value={entry.activeValue} size={16} />
              </span>
            </button>
          {/each}
        </div>
      {/if}

      {#if singles.length > 0}
        <p class="label-mono group-title">Icons</p>
        <div class="grid">
          {#each singles as entry (entry.id)}
            <button
              type="button"
              class="cell"
              class:current={entry.value === icon}
              title={entry.name ?? entry.value}
              aria-label={entry.name ?? entry.value}
              onclick={() => onPick(entry.value)}
            >
              <Icon value={entry.value} size={22} />
            </button>
          {/each}
        </div>
      {/if}

      {#if twins.length === 0 && singles.length === 0}
        <p class="empty text-muted">
          No icons match. Add some in
          <a href={`${base}/#/templates?type=icons`} target="_blank"
            >Templates → Icons</a
          >.
        </p>
      {/if}
    </div>

    <div class="foot">
      <button
        type="button"
        class="btn btn-outline btn-sm"
        onclick={() => (customOpen = !customOpen)}>Custom…</button
      >
      {#if customOpen}
        <div class="custom">
          <input
            type="text"
            aria-label="Custom icon"
            placeholder="URL, path, SVG or HTML"
            bind:value={url}
          />
          <button
            type="button"
            class="btn btn-primary btn-sm"
            disabled={!url.trim()}
            onclick={() => onPick(url.trim())}>Use</button
          >
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--surface-color);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(620px, 100%);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.6rem;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-head h3 {
    margin: 0;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    max-height: 6.5rem;
    overflow-y: auto;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--body-sm);
    cursor: pointer;
  }

  .chip.active {
    border-color: var(--primary-color);
    color: var(--primary-color);
  }

  .chip-count {
    color: var(--text-muted);
    font-size: 10px;
  }

  .results {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.35rem;
    min-height: 12rem;
    max-height: 55vh;
  }

  .group-title {
    margin: 0.25rem 0 0.2rem;
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  .cell,
  .pair {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border: 1px solid transparent;
    background: transparent;
    border-radius: var(--border-radius-sm, 4px);
    color: var(--text-muted);
    cursor: pointer;
  }

  .cell:hover,
  .pair:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .cell.current,
  .pair.current {
    border-color: var(--primary-color);
    color: var(--primary-color);
  }

  .pair {
    position: relative;
    width: 48px;
  }

  .pair-twin {
    position: absolute;
    right: 1px;
    bottom: 1px;
    display: inline-flex;
    color: var(--text-muted);
    opacity: 0.85;
  }

  .empty {
    padding: 2rem 1rem;
    text-align: center;
    font-size: var(--body-sm);
  }

  .foot {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .custom {
    display: flex;
    gap: 0.4rem;
  }

  .custom input {
    flex: 1 1 auto;
    min-width: 0;
  }
</style>
