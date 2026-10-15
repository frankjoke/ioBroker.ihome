<script lang="ts">
  import { base } from "$app/paths";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    getPageRegistry,
    layoutEdit,
    setLastPage,
  } from "$lib/stores/pages.svelte.js";
  import ThemeToggle from "$lib/ThemeToggle.svelte";

  let { currentId }: { currentId?: string } = $props();

  const pages = $derived(getPageRegistry().pages ?? []);
  const isConnected = $derived(!!ioBroker.connected);
  // One page is not a navigation: the tabs appear as soon as there is a second
  // one, and the first page is the display's default.
  const showTabs = $derived(pages.length > 1);
</script>

<header class="bar">
  {#if showTabs}
    <nav class="page-tabs" aria-label="Pages">
      {#each pages as p (p.id)}
        <a
          class="tab"
          class:active={p.id === currentId}
          href={`${base}/#/p/${p.id}`}
          aria-current={p.id === currentId ? "page" : undefined}
          onclick={() => setLastPage(p.id)}
        >
          {#if p.icon}<span class="material-symbols-outlined" aria-hidden="true"
              >{p.icon}</span
            >{/if}
          <span class="tab-label">{p.title}</span>
        </a>
      {/each}
    </nav>
  {/if}

  <div class="actions">
    <button
      type="button"
      class="icon-btn"
      class:active={layoutEdit.on}
      title={layoutEdit.on ? "Leave edit mode" : "Edit the layout"}
      aria-pressed={layoutEdit.on}
      onclick={() => (layoutEdit.on = !layoutEdit.on)}
    >
      <span class="material-symbols-outlined"
        >{layoutEdit.on ? "edit_off" : "edit"}</span
      >
    </button>

    <ThemeToggle />

    <a
      class="icon-btn status-btn"
      class:connected={isConnected}
      href={`${base}/#/settings`}
      title={isConnected
        ? "Connected — open the connection settings"
        : "Not connected — open the connection settings"}
      aria-label={isConnected ? "Connected" : "Not connected"}
    >
      <span class="material-symbols-outlined"
        >{isConnected ? "wifi" : "wifi_off"}</span
      >
    </a>

    <a
      class="icon-btn"
      href={`${base}/#/settings`}
      title="System settings"
      aria-label="System settings"
    >
      <span class="material-symbols-outlined">settings</span>
    </a>
  </div>
</header>

<style>
  /* The display owns the viewport, so the bar is only what the display needs:
     the tree's page tabs (when there is more than one page), the edit toggle,
     the theme switch, the connection state and the system settings. */
  .bar {
    position: sticky;
    top: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-height: 44px;
    padding: 0.3rem 12px;
    background-color: var(--surface-container-low);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: blur(8px);
  }

  .page-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .page-tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--border-radius-pill);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  .tab:hover {
    text-decoration: none;
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .tab.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .tab .material-symbols-outlined {
    font-size: 18px;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: none;
    background: transparent;
    border-radius: var(--border-radius-pill);
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-btn:hover {
    text-decoration: none;
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  /* Edit mode on: the toggle says so; the tiles only change how they respond. */
  .icon-btn.active {
    color: var(--primary-color);
    background-color: var(--surface-container);
  }

  .icon-btn .material-symbols-outlined {
    font-size: 20px;
  }

  .status-btn.connected .material-symbols-outlined {
    color: var(--tertiary);
    font-variation-settings:
      "FILL" 1,
      "wght" 400,
      "GRAD" 0,
      "opsz" 24;
  }

  .status-btn:not(.connected) .material-symbols-outlined {
    color: var(--warning-color);
  }
</style>
