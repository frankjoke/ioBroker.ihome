<script lang="ts">
  import { base } from "$app/paths";
  import { page as route } from "$app/state";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    getPageRegistry,
    setLastPage,
    view,
  } from "$lib/stores/pages.svelte.js";
  import { openSheet } from "$lib/stores/sheet.svelte.js";
  import {
    pages as configPages,
    pageHref,
    requestLayoutConfig,
    wantsDeviceConfig,
  } from "$lib/pages.js";
  import Icon from "$lib/components/common/Icon.svelte";
  import ThemeToggle from "$lib/ThemeToggle.svelte";

  /**
   * One bar for the whole app, in two states. The left half follows the state:
   * the tree's pages + a pencil (which opens the layout editor) on the display,
   * the editor's own tabs + an eye (back to the display) in the editor. The
   * right half — theme, connection, system settings — never moves.
   */
  const routeId = $derived(route.route?.id ?? "/");
  const isDisplay = $derived(routeId === "/" || routeId.startsWith("/p/"));

  const treePages = $derived(getPageRegistry().pages ?? []);
  /**
   * Which tree page the display is showing (a bookmarked id, else the last one).
   * A stale or empty value — the page it names was deleted meanwhile — falls back
   * to the first page, so a tab is always highlighted (A29).
   */
  const currentId = $derived.by(() => {
    if (!isDisplay) return "";
    const wanted = route.params?.id ?? view.lastPage ?? "";
    return treePages.some((p) => p.id === wanted)
      ? wanted
      : (treePages[0]?.id ?? "");
  });
  const isConnected = $derived(!!ioBroker.connected);

  /** Ctrl/Cmd+click a page tab → open that page in the layout sheet. */
  function onPageClick(event: MouseEvent, id: string) {
    if (wantsDeviceConfig(event)) {
      // Also suppresses the browser's open-in-new-tab for this hash link.
      event.preventDefault();
      requestLayoutConfig({ pageId: id });
      openSheet();
      return;
    }
    setLastPage(id);
  }

  /**
   * The pencil opens the sheet on the page being viewed — the same handoff as
   * Ctrl/Cmd+click on its tab. It is a mode of this page, not a place to go, so
   * nothing navigates.
   */
  function onPencilClick() {
    if (currentId) requestLayoutConfig({ pageId: currentId });
    openSheet();
  }
</script>

<header class="bar">
  <nav class="tabs" aria-label={isDisplay ? "Pages" : "Configuration"}>
    {#if isDisplay}
      {#each treePages as p (p.id)}
        <a
          class="tab"
          class:active={p.id === currentId}
          href={`${base}/#/p/${p.id}`}
          aria-current={p.id === currentId ? "page" : undefined}
          onclick={(e) => onPageClick(e, p.id)}
        >
          {#if p.icon}<Icon value={p.icon} size={18} />{/if}
          <span class="tab-label">{p.title}</span>
        </a>
      {/each}
      <a
        class="tab icon-tab"
        href={`${base}/#/`}
        title="Edit the layout"
        aria-label="Edit the layout"
        onclick={onPencilClick}
      >
        <span class="material-symbols-outlined">edit</span>
      </a>
    {:else}
      {#each configPages as p (p.id)}
        <a
          class="tab"
          class:active={routeId === p.id}
          href={pageHref(p.id, base)}
          aria-current={routeId === p.id ? "page" : undefined}
        >
          <span class="material-symbols-outlined" aria-hidden="true"
            >{p.icon}</span
          >
          <span class="tab-label">{p.label}</span>
        </a>
      {/each}
      <a
        class="tab icon-tab"
        href={`${base}/#/`}
        title="Back to the display"
        aria-label="Back to the display"
      >
        <span class="material-symbols-outlined">visibility</span>
      </a>
    {/if}
  </nav>

  <div class="actions">
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

  .tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .tabs::-webkit-scrollbar {
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

  /* The pencil (display) and the eye (editor) sit in the tab row as the last
     entry, so both states read as one bar. */
  .icon-tab {
    padding: 6px 10px;
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
    border-radius: var(--border-radius-pill);
    color: var(--text-muted);
  }

  .icon-btn:hover {
    text-decoration: none;
    background-color: var(--surface-container);
    color: var(--text-color);
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
