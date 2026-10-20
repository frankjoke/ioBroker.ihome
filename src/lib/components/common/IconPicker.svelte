<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getPageRegistry } from "$lib/stores/pages.svelte.js";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { collectDocumentIcons } from "$lib/utils/icon-url";
  import { brokerIconPath, isImageIcon } from "$lib/config/icon-ops";
  import Icon from "$lib/components/common/Icon.svelte";
  import symbolNames from "$lib/assets/material-symbol-names.json";

  let {
    icon = undefined,
    onPick,
    onClose,
  }: {
    /** The current value, for highlighting and the URL prefill. */
    icon?: string;
    /** The picked value; "" clears the icon. */
    onPick: (icon: string) => void;
    onClose: () => void;
  } = $props();

  const TABS = [
    { id: "symbols", label: "Symbols" },
    { id: "document", label: "Document" },
    { id: "broker", label: "Broker" },
    { id: "url", label: "URL" },
  ] as const;

  let tab = $state<(typeof TABS)[number]["id"]>("symbols");
  let search = $state("");
  // The picker is mounted fresh per open, so capturing the initial value is the
  // point; a later `icon` change never arrives while it is up.
  // svelte-ignore state_referenced_locally
  let url = $state(icon && isImageIcon(icon) ? icon : "");

  /** The first 120 matches — the full list is thousands long. */
  const matches = $derived(
    symbolNames
      .filter((n) => !search.trim() || n.includes(search.trim().toLowerCase()))
      .slice(0, 120),
  );

  const documentIcons = $derived(
    collectDocumentIcons(getPageRegistry(), getTemplateRegistry()),
  );

  /** Every `common.icon` the broker has, deduped by value (one id shown). */
  const brokerIcons = $derived.by(() => {
    const seen = new SvelteMap<string, string>();
    for (const [id, obj] of (ioBroker.objects as Map<string, any>) ?? []) {
      const value = obj?.common?.icon;
      if (typeof value === "string" && value.trim() && !seen.has(value)) {
        seen.set(value, id);
      }
    }
    return [...seen.entries()]
      .map(([value, id]) => ({ value, id }))
      .sort((a, b) => a.value.localeCompare(b.value));
  });

  function onKey(event: KeyboardEvent) {
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

    <div class="tabs" role="tablist">
      {#each TABS as t (t.id)}
        <button
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          class="tab"
          class:active={tab === t.id}
          onclick={() => (tab = t.id)}>{t.label}</button
        >
      {/each}
    </div>

    {#if tab === "symbols"}
      <input type="search" placeholder="Search symbols…" bind:value={search} />
    {/if}

    <div class="results">
      {#if tab === "symbols"}
        {#if matches.length === 0}
          <p class="empty text-muted">No matching symbols.</p>
        {:else}
          <div class="grid">
            {#each matches as name (name)}
              <button
                type="button"
                class="cell"
                class:current={name === icon}
                title={name}
                aria-label={name}
                onclick={() => onPick(name)}
              >
                <Icon value={name} size={22} />
              </button>
            {/each}
          </div>
        {/if}
      {:else if tab === "document"}
        {#if documentIcons.length === 0}
          <p class="empty text-muted">
            No icons in the layout or the templates yet.
          </p>
        {:else}
          <div class="grid">
            {#each documentIcons as value (value)}
              <button
                type="button"
                class="cell"
                class:current={value === icon}
                title={value}
                aria-label={value}
                onclick={() => onPick(value)}
              >
                <Icon {value} size={22} />
              </button>
            {/each}
          </div>
        {/if}
      {:else if tab === "broker"}
        {#if brokerIcons.length === 0}
          <p class="empty text-muted">
            No broker objects carry a <code>common.icon</code>.
          </p>
        {:else}
          <ul class="list">
            {#each brokerIcons as entry (entry.value)}
              <li>
                <button
                  type="button"
                  class="row-btn"
                  class:current={entry.value === icon}
                  onclick={() => onPick(brokerIconPath(entry.value, entry.id))}
                >
                  <Icon value={entry.value} owner={entry.id} size={22} />
                  <span class="value">{entry.value}</span>
                  <span class="meta text-muted">{entry.id}</span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <div class="url-row">
          <input
            type="text"
            placeholder="https://… or adapter/name.png"
            bind:value={url}
          />
          <span class="preview" aria-hidden="true">
            <Icon value={url} size={22} />
          </span>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!url.trim()}
            onclick={() => onPick(url.trim())}>Use</button
          >
        </div>
      {/if}
    </div>

    <div class="actions">
      <button type="button" class="btn" onclick={() => onPick("")}>Clear</button
      >
      <button type="button" class="btn" onclick={onClose}>Cancel</button>
    </div>
  </div>
</div>

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }

  .modal-content {
    background: var(--surface-color, #fff);
    color: var(--text-color);
    border-radius: var(--border-radius-lg, 8px);
    width: min(560px, 100%);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    padding: 1rem;
    gap: 0.75rem;
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .modal-head h3 {
    margin: 0;
  }

  .icon-btn {
    border: none;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .tabs {
    display: flex;
    gap: 2px;
  }

  .tab {
    border: none;
    background: transparent;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    padding: 6px 12px;
    border-radius: var(--border-radius-pill);
    cursor: pointer;
  }

  .tab:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .tab.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .results {
    overflow: auto;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.35rem;
    min-height: 12rem;
  }

  .grid {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
  }

  .cell {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    background: transparent;
    border-radius: var(--border-radius-sm, 4px);
    color: var(--text-muted);
    cursor: pointer;
  }

  .cell:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .cell.current {
    background-color: var(--primary-container);
  }

  .list {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .row-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    padding: 2px 4px;
    border: none;
    background: transparent;
    color: inherit;
    text-align: left;
    cursor: pointer;
  }

  .row-btn:hover {
    background-color: var(--surface-container);
  }

  .row-btn.current {
    background-color: var(--primary-container);
  }

  .value {
    font-size: var(--body-sm);
    white-space: nowrap;
  }

  .meta {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 0.75rem;
  }

  .url-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .url-row input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 0.35rem;
  }

  .preview {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    color: var(--text-muted);
  }

  .empty {
    padding: 0.5rem;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
</style>
