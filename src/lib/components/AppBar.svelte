<script lang="ts">
  import { base } from "$app/paths";
  import { goto } from "$app/navigation";
  import { page as route } from "$app/state";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    getPageRegistry,
    setLastPage,
    view,
  } from "$lib/stores/pages.svelte.js";
  import {
    closeSheet,
    isPinAsked,
    openSheetGated,
    resolvePinAsk,
    sheet,
  } from "$lib/stores/sheet.svelte.js";
  import {
    clearRequestedLayout,
    pages as configPages,
    pageHref,
    requestLayoutConfig,
    wantsDeviceConfig,
  } from "$lib/pages.js";
  import Icon from "$lib/components/common/Icon.svelte";
  import { adapterIcon } from "$lib/config/icon-ops";
  import PinModal from "$lib/components/common/PinModal.svelte";
  import { contrastColor } from "$lib/config/format";
  import { inspectGradient, isHexColor } from "$lib/config/appearance";
  import { pluginPageHref } from "$lib/config/plugin-pages";
  import {
    getPluginPages,
    initPluginPages,
  } from "$lib/stores/plugin-pages.svelte";
  import { getStorage } from "$lib/tools.svelte";
  import { effectivePin, unlock } from "$lib/config/pin.svelte";
  import { getSettings, isSettingsLoaded } from "$lib/stores/settings.svelte";
  import { effectiveHidePencil } from "$lib/config/settings-ops";
  import {
    connectionState,
    registerAliveState,
  } from "$lib/stores/connection.svelte";

  /**
   * One bar for the whole app, in two states. The left half follows the state:
   * the tree's pages + a pencil (which opens the layout editor) on the display,
   * the editor's own tabs + an eye (back to the display) in the editor. The
   * right half — theme, connection, system settings — never moves.
   */
  const routeId = $derived(route.route?.id ?? "/");
  const isDisplay = $derived(routeId === "/" || routeId.startsWith("/p/"));
  const currentConfig = $derived(configPages.find((p) => p.id === routeId));
  const pluginPageList = $derived(getPluginPages().pages);
  const currentPluginPage = $derived.by(() => {
    if (routeId !== "/plugin/[id]") return undefined;
    const id = route.params?.id ?? "";
    return getPluginPages().pages.find((page) => page.id === id);
  });
  const currentLabel = $derived(
    isDisplay
      ? ""
      : currentPluginPage
        ? `Plugins › ${currentPluginPage.title}`
        : routeId === "/admin"
          ? "Plugins › Admin"
          : (currentConfig?.label ?? "Configuration"),
  );
  const currentIcon = $derived(
    currentPluginPage
      ? currentPluginPage.icon || "web_asset"
      : routeId === "/admin"
        ? "settings_applications"
        : (currentConfig?.icon ?? "settings"),
  );
  const homeAdapter = ioBroker.namespace.split(".")[0] ?? "ihome";
  const pluginsIcon = $derived(
    adapterIcon(ioBroker.objects as Map<string, any>, homeAdapter),
  );
  const adminIcon = $derived(
    adapterIcon(ioBroker.objects as Map<string, any>, "admin"),
  );
  const currentIconImage = $derived(
    routeId === "/admin" ? adminIcon : undefined,
  );

  // The cog menu: the static config pages around one Plugins group.
  const pluginGroupIndex = $derived(
    configPages.findIndex((p) => p.id === "/plugins"),
  );
  const menuBefore = $derived(
    configPages.slice(0, pluginGroupIndex).filter((p) => p.id !== "/admin"),
  );
  const menuAfter = $derived(
    configPages
      .slice(pluginGroupIndex + 1)
      .filter((p) => p.id !== "/admin" && p.id !== "/plugins"),
  );
  const pluginsPage = $derived(configPages.find((p) => p.id === "/plugins"));
  const adminPage = $derived(configPages.find((p) => p.id === "/admin"));
  /** The cog menu is the configuration navigation on every screen size. */
  let cogMenuOpen = $state(false);
  let pageMenuOpen = $state(false);
  $effect(() => {
    routeId;
    cogMenuOpen = false;
    pageMenuOpen = false;
  });

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
  const currentPage = $derived(treePages.find((p) => p.id === currentId));
  const status = $derived(connectionState());
  const statusText = $derived(
    status === "error"
      ? {
          title: "Configuration — not connected",
          label: "Configuration, not connected",
        }
      : status === "warning"
        ? {
            title: "Configuration — connected, iHome adapter is not active",
            label: "Configuration, connected, iHome adapter is not active",
          }
        : status === "pending"
          ? {
              title: "Configuration — connected, checking iHome adapter",
              label: "Configuration, connected, checking iHome adapter",
            }
          : {
              title: "Configuration — connected",
              label: "Configuration, connected",
            },
  );
  $effect(() => {
    registerAliveState();
  });
  $effect(() => {
    if (!ioBroker.connected) return;
    void initPluginPages();
  });
  /** The UI page can hide the pencil for everyone; until the settings document
   *  is read, hide it — an unauthorized pencil must not flash in. */
  const hidePencil = $derived(
    !isSettingsLoaded() || effectiveHidePencil(getSettings().hidePencil),
  );

  /**
   * A tab is a folder tab for its own page: it wears the page's solid
   * background, so the strip reads as the folder the display is open in, and
   * its label takes the colour that reads on that background — a cream page in
   * the dark theme stays legible. A page without one (or with a gradient/image
   * — too loud at tab size) wears the display's own background and keeps the
   * ambient text colour.
   */
  function tabTint(page: { background?: { kind?: string; value?: string } }) {
    const bg = page.background;
    // A solid page wears that colour; a gradient wears the colour it starts
    // with — which is what sits at the top of the page, right under the bar.
    const solid =
      bg?.kind === "solid" && isHexColor(bg.value) ? bg.value : undefined;
    const from =
      bg?.kind === "gradient" ? inspectGradient(bg.value)?.from : undefined;
    const colour = solid ?? (from && isHexColor(from) ? from : undefined);
    // What sits below the bar: the page's own colour, else the app background.
    const page_ = colour ?? "var(--background-color)";
    // A closed folder is invisible without a colour of its own — only the open
    // one wears the page, so the strip is folders and not a row of chips.
    const fill = colour ?? "transparent";
    const fg = colour ? `; --tab-fg: ${contrastColor(colour)}` : "";
    return `--tab-page: ${page_}; --tab-bg: ${fill}${fg};`;
  }

  const storage = getStorage();
  const storedPin = $derived(effectivePin(storage.pin));

  /** Ctrl/Cmd+click a page tab → open that page in the layout sheet.
   *  Capture phase: SvelteKit's router listens earlier than a delegated
   *  `onclick`, so a plain click would already have pushed the hash before a
   *  bubble handler could say no. */
  function onPageClick(event: MouseEvent, id: string) {
    if (wantsDeviceConfig(event)) {
      // Also suppresses the browser's open-in-new-tab for this hash link.
      event.preventDefault();
      requestLayoutConfig({ pageId: id });
      openSheetGated();
      return;
    }
    // In the editor the tabs move the sheet to that page. `goto` keeps the
    // sheet open (module state), unlike a hash edit, which reloads the router.
    if (sheet.open) {
      event.preventDefault();
      setLastPage(id);
      void goto(`#/p/${id}`);
      return;
    }
    setLastPage(id);
  }

  /**
   * The pencil opens the sheet on the page being viewed; the eye closes it
   * again. With the pencil lock on, a fresh open asks for the PIN first
   * (`openSheetGated`) — closing is never gated. It is a mode of this page,
   * not a place to go, so nothing navigates and nothing is handed off: the
   * cursor is already where the display is. (It must not set a handoff either
   * — that would clobber one already in flight, say the tile the devices page
   * is sending us back to.)
   *
   * The plain click is swallowed: from the installed URL (/ihome/index.html)
   * the anchor's href (/ihome/) is a different document, and that full reload
   * dropped the sheet that had just been opened.
   */
  function onPencilClick(event: MouseEvent) {
    event.preventDefault();
    if (sheet.open) {
      closeSheet();
      return;
    }
    openSheetGated();
  }
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape") {
      cogMenuOpen = false;
      pageMenuOpen = false;
    }
  }}
/>

<header
  class="bar"
  class:editing={isDisplay && sheet.open}
  class:view={isDisplay && !sheet.open}
  class:config={!isDisplay}
>
  <nav
    class="tabs"
    class:config={!isDisplay}
    class:pages-menu={isDisplay && treePages.length > 3}
    aria-label={isDisplay ? "Pages" : "Configuration"}
  >
    {#if isDisplay}
      {#each treePages as p (p.id)}
        <a
          class="tab"
          class:active={p.id === currentId}
          href={`${base}/#/p/${p.id}`}
          style={tabTint(p)}
          aria-current={p.id === currentId ? "page" : undefined}
          onclickcapture={(e) => onPageClick(e, p.id)}
        >
          {#if p.icon}<Icon value={p.icon} size={18} />{/if}
          <span class="tab-label">{p.title}</span>
        </a>
      {/each}
    {:else}
      <div class="current-page">
        {#if currentIconImage}
          <Icon
            value={currentIconImage.value}
            owner={currentIconImage.owner}
            size={18}
          />
        {:else}
          <span class="material-symbols-outlined" aria-hidden="true"
            >{currentIcon}</span
          >
        {/if}
        <span class="menu-current">{currentLabel}</span>
      </div>
    {/if}
  </nav>

  {#if isDisplay && treePages.length > 3}
    <div class="config-menu">
      <button
        type="button"
        class="icon-btn"
        aria-label="Pages menu"
        aria-haspopup="true"
        aria-expanded={pageMenuOpen}
        aria-controls="pages-menu-panel"
        title="Pages"
        onclick={() => (pageMenuOpen = !pageMenuOpen)}
      >
        <span class="material-symbols-outlined">menu</span>
      </button>
      <span class="menu-current">{currentPage?.title ?? "Pages"}</span>

      {#if pageMenuOpen}
        <button
          type="button"
          class="menu-backdrop"
          aria-label="Close the pages menu"
          onclick={() => (pageMenuOpen = false)}
        ></button>
        <nav id="pages-menu-panel" class="menu-panel" aria-label="Pages">
          {#each treePages as p (p.id)}
            <a
              class="menu-item"
              class:active={p.id === currentId}
              href={`${base}/#/p/${p.id}`}
              aria-current={p.id === currentId ? "page" : undefined}
              onclickcapture={(e) => onPageClick(e, p.id)}
              onclick={() => (pageMenuOpen = false)}
            >
              {#if p.icon}<Icon value={p.icon} size={18} />{/if}
              <span>{p.title}</span>
            </a>
          {/each}
        </nav>
      {/if}
    </div>
  {/if}

  <div class="actions">
    <!-- The editor's mode switch: it sits with the other action icons, not in
         the tab row, so the tabs stay pages and nothing else. The eye is the
         same switch, read the other way. -->
    {#if isDisplay}
      {#if !hidePencil || sheet.open}
        <a
          class="icon-btn"
          href={`${base}/#/`}
          title={sheet.open ? "Back to the display" : "Edit the layout"}
          aria-label={sheet.open ? "Back to the display" : "Edit the layout"}
          onclick={onPencilClick}
        >
          <span class="material-symbols-outlined"
            >{sheet.open ? "visibility" : "edit"}</span
          >
        </a>
      {/if}
    {/if}

    {#if !isDisplay}
      <a
        class="icon-btn"
        href={`${base}/#/`}
        title="Back to the display"
        aria-label="Back to the display"
      >
        <span class="material-symbols-outlined">visibility</span>
      </a>
    {/if}

    <div class="cog-menu">
      <button
        type="button"
        class="icon-btn status-btn"
        class:ok={status === "ok"}
        class:warning={status === "warning"}
        class:error={status === "error"}
        title={statusText.title}
        aria-label="Configuration menu"
        aria-haspopup="true"
        aria-expanded={cogMenuOpen}
        aria-controls="cog-menu-panel"
        onclick={() => (cogMenuOpen = !cogMenuOpen)}
      >
        <span class="material-symbols-outlined">
          {status === "error" ? "construction" : "settings"}
        </span>
      </button>

      {#if cogMenuOpen}
        <button
          type="button"
          class="menu-backdrop"
          aria-label="Close the configuration menu"
          onclick={() => (cogMenuOpen = false)}
        ></button>
        <nav id="cog-menu-panel" class="menu-panel" aria-label="Configuration">
          <a
            class="menu-item"
            class:active={isDisplay}
            href={`${base}/#/`}
            aria-current={isDisplay ? "page" : undefined}
            onclick={() => (cogMenuOpen = false)}
          >
            <span class="material-symbols-outlined" aria-hidden="true"
              >visibility</span
            >
            <span>UI</span>
          </a>
          <div class="menu-sep"></div>

          {#each menuBefore as p (p.id)}
            <a
              class="menu-item"
              class:active={routeId === p.id}
              href={pageHref(p.id, base)}
              aria-current={routeId === p.id ? "page" : undefined}
              onclick={() => (cogMenuOpen = false)}
            >
              <span class="material-symbols-outlined" aria-hidden="true"
                >{p.icon}</span
              >
              <span>{p.label}</span>
            </a>
          {/each}

          <a
            class="menu-item"
            class:active={routeId === "/plugins"}
            href={pageHref("/plugins", base)}
            aria-current={routeId === "/plugins" ? "page" : undefined}
            onclick={() => (cogMenuOpen = false)}
          >
            {#if pluginsIcon}
              <Icon
                value={pluginsIcon.value}
                owner={pluginsIcon.owner}
                size={18}
              />
            {:else}
              <span class="material-symbols-outlined" aria-hidden="true"
                >extension</span
              >
            {/if}
            <span>Plugins</span>
          </a>
          {#if adminPage}
            <a
              class="menu-item sub"
              class:active={routeId === "/admin"}
              href={pageHref("/admin", base)}
              aria-current={routeId === "/admin" ? "page" : undefined}
              onclick={() => (cogMenuOpen = false)}
            >
              {#if adminIcon}
                <Icon
                  value={adminIcon.value}
                  owner={adminIcon.owner}
                  size={18}
                />
              {:else}
                <span class="material-symbols-outlined" aria-hidden="true"
                  >settings_applications</span
                >
              {/if}
              <span>Admin</span>
            </a>
          {/if}
          {#each pluginPageList as page (page.id)}
            {#if page.open === "tab"}
              <a
                class="menu-item sub"
                href={page.url}
                target="_blank"
                rel="noopener"
                onclick={() => (cogMenuOpen = false)}
              >
                <span class="material-symbols-outlined" aria-hidden="true"
                  >{page.icon || "web_asset"}</span
                >
                <span>{page.title}</span>
              </a>
            {:else}
              <a
                class="menu-item sub"
                class:active={routeId === "/plugin/[id]" &&
                  route.params?.id === page.id}
                href={pluginPageHref(page.id, base)}
                aria-current={routeId === "/plugin/[id]" &&
                route.params?.id === page.id
                  ? "page"
                  : undefined}
                onclick={() => (cogMenuOpen = false)}
              >
                <span class="material-symbols-outlined" aria-hidden="true"
                  >{page.icon || "web_asset"}</span
                >
                <span>{page.title}</span>
              </a>
            {/if}
          {/each}

          {#each menuAfter as p (p.id)}
            <a
              class="menu-item"
              class:active={routeId === p.id}
              href={pageHref(p.id, base)}
              aria-current={routeId === p.id ? "page" : undefined}
              onclick={() => (cogMenuOpen = false)}
            >
              <span class="material-symbols-outlined" aria-hidden="true"
                >{p.icon}</span
              >
              <span>{p.label}</span>
            </a>
          {/each}
        </nav>
      {/if}
    </div>
  </div>
</header>

{#if isPinAsked()}
  <PinModal
    title="Enter PIN for the layout editor"
    expected={storedPin}
    onSubmit={() => {
      unlock();
      resolvePinAsk(true);
    }}
    onCancel={() => {
      // The entrance already handed its target over; a cancelled ask drops it,
      // so nothing stale can sit in the sheet or look like a way back in.
      clearRequestedLayout();
      resolvePinAsk(false);
    }}
  />
{/if}

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

  /* View mode: the page tabs sit on a stronger light gray so the menu is
     easier to pick out from the page below. */
  .bar.view {
    background-color: var(--surface-container-high);
  }

  /* Editing the layout is a different mode than viewing it — the bar tints
     red in both themes, so "am I editing?" is answerable at a glance. */
  .bar.editing {
    background-color: var(--edit-mode-bar);
  }

  /* Config pages are their own mode too: the bar wears a stronger blue and
     the open tab the page's own colour, so it is the folder that opens into
     the page — the display's tab style, on the config tint. */
  .bar.config {
    background-color: var(--config-bar);
    --tab-page: var(--config-bg);
  }

  /* The strip is the folders' edge: tabs stand on the bar's own border line,
     and the strip reaches 1px past it so the open folder's bottom edge can
     paint the line away (see .tab.active). */
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    flex: 1 1 auto;
    min-width: 0;
    overflow-x: auto;
    scrollbar-width: none;
    align-self: stretch;
    /* Reaches past the bar's own padding and its 1px border, so the open
       folder's bottom edge can paint that line away (.tab.active). */
    margin-bottom: calc(-0.3rem - 1px);
  }

  .tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px 5px;
    /* Folder tab: square at the bottom, framed, wearing its page's colour. */
    border: 1px solid transparent;
    border-bottom: none;
    border-radius: 11px 11px 0 0;
    background-color: var(--tab-bg, transparent);
    color: var(--tab-fg, var(--text-muted));
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    /* Keeps the bar's border visible under the folders that are not open. */
    margin-bottom: 1px;
  }

  .tab:hover {
    text-decoration: none;
    border-color: var(--border-color);
    color: var(--tab-fg, var(--text-color));
  }

  /* The open folder: it wears the page's own colour — which is what sits below
     the bar — and that colour, on its bottom edge, paints the bar's border
     away. So the line opens into the page. */
  .tab.active {
    border-color: var(--border-color);
    background-color: var(--tab-page, var(--background-color));
    border-bottom: 1px solid var(--tab-page, var(--background-color));
    margin-bottom: 0;
    color: var(--tab-fg, var(--text-color));
  }
  /* On a phone the tabs keep their labels and give up the page icons. */
  @media (max-width: 820px) {
    .tab :global(.material-symbols-outlined),
    .tab :global(.icon-img) {
      display: none;
    }
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
  }

  .current-page {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    flex: 1 1 auto;
    padding: 0.25rem 0.1rem;
    cursor: default;
  }

  .current-page .material-symbols-outlined {
    font-size: 20px;
    color: var(--text-muted);
  }

  .current-page .menu-current {
    max-width: none;
  }

  .cog-menu {
    position: relative;
    display: flex;
    align-items: center;
  }

  .cog-menu .menu-panel {
    left: auto;
    right: 0;
  }

  .menu-sep {
    border-top: 1px solid var(--border-color);
    margin: 0.2rem 0;
  }

  .menu-item.sub {
    padding-left: 2.1rem;
    font-weight: 400;
  }

  /* ------------------------------------------------- config menu (small) */

  /* Desktop keeps the tab strip; phones get a menu button instead. */
  .config-menu {
    display: none;
    position: relative;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .menu-current {
    font-size: 13px;
    font-weight: 600;
    max-width: 45vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Below the bar, so the menu button and the eye stay usable while open. */
  .menu-backdrop {
    position: fixed;
    top: 44px;
    right: 0;
    bottom: 0;
    left: 0;
    z-index: 2;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .menu-panel {
    position: absolute;
    top: calc(100% + 0.35rem);
    left: 0;
    z-index: 3;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 15rem;
    max-width: min(20rem, calc(100vw - 1.5rem));
    max-height: min(70vh, 32rem);
    overflow-y: auto;
    padding: 0.3rem;
    background-color: var(--surface-container-lowest);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.55rem 0.6rem;
    border-radius: var(--border-radius-sm, 4px);
    color: var(--text-color);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
  }

  .menu-item:hover {
    background-color: var(--surface-container);
    text-decoration: none;
  }

  .menu-item.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .menu-item .material-symbols-outlined {
    font-size: 18px;
  }

  @media (max-width: 820px) {
    .tabs.pages-menu {
      display: none;
    }
    .config-menu {
      display: flex;
    }
  }

  .status-btn.ok .material-symbols-outlined {
    color: var(--tertiary);
    font-variation-settings:
      "FILL" 1,
      "wght" 400,
      "GRAD" 0,
      "opsz" 24;
  }

  .status-btn.warning .material-symbols-outlined {
    color: var(--warning-color);
  }

  .status-btn.error .material-symbols-outlined {
    color: var(--danger-color);
  }
</style>
