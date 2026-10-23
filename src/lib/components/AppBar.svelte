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
  import ThemeToggle from "$lib/ThemeToggle.svelte";
  import PinModal from "$lib/components/common/PinModal.svelte";
  import { contrastColor } from "$lib/config/format";
  import { inspectGradient, isHexColor } from "$lib/config/appearance";
  import { getStorage } from "$lib/tools.svelte";
  import {
    effectivePin,
    isUnlocked,
    pencilNeedsPin,
    unlock,
  } from "$lib/config/pin.svelte";

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
  let askingSettingsPin = $state(false);

  /**
   * The settings ask for the PIN here — on the way in — instead of the settings
   * page asking on load. A reload (or a dev-server reload) must never throw a
   * modal at the operator; only a deliberate press of the cog does.
   *
   * Capture phase: SvelteKit's router listens before a delegated `onclick`, so
   * only a capture handler can still say no (same reason as `onPageClick`).
   */
  function onSettingsClick(event: MouseEvent) {
    if (isUnlocked()) return;
    event.preventDefault();
    askingSettingsPin = true;
  }

  /** Ctrl/Cmd+click a page tab → open that page in the layout sheet.
   *  Capture phase: SvelteKit's router listens earlier than a delegated
   *  `onclick`, so a plain click would already have pushed the hash before a
   *  bubble handler could say no. */
  function onPageClick(event: MouseEvent, id: string) {
    if (wantsDeviceConfig(event)) {
      // Also suppresses the browser's open-in-new-tab for this hash link.
      event.preventDefault();
      requestLayoutConfig({ pageId: id });
      openSheetGated(pencilNeedsPin(storage.lockPencil, isUnlocked()));
      return;
    }
    // In the editor the tabs move the sheet, not the route (A43): the display
    // and the sheet share one page, so nothing navigates and nothing is left
    // pointing at a page the editor is not showing.
    if (sheet.open) event.preventDefault();
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
    openSheetGated(pencilNeedsPin(storage.lockPencil, isUnlocked()));
  }
</script>

<header class="bar" class:editing={isDisplay && sheet.open}>
  <nav class="tabs" aria-label={isDisplay ? "Pages" : "Configuration"}>
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
    <!-- The editor's mode switch: it sits with the other action icons, not in
         the tab row, so the tabs stay pages and nothing else. The eye is the
         same switch, read the other way. -->
    {#if isDisplay}
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

    <ThemeToggle variant="cycle" />

    <a
      class="icon-btn status-btn"
      class:connected={isConnected}
      href={`${base}/#/settings`}
      onclickcapture={onSettingsClick}
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
      onclickcapture={onSettingsClick}
      title="System settings"
      aria-label="System settings"
    >
      <span class="material-symbols-outlined">settings</span>
    </a>
  </div>
</header>

{#if askingSettingsPin}
  <PinModal
    title="Enter PIN for Settings"
    expected={storedPin}
    onSubmit={() => {
      unlock();
      askingSettingsPin = false;
      // `goto`, not `location.hash = …`: SvelteKit's hash router reloads the
      // page on a direct hash edit, and that reload dropped the unlock just
      // granted (the settings came back locked).
      void goto("#/settings");
    }}
    onCancel={() => (askingSettingsPin = false)}
  />
{/if}

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

  /* Editing the layout is a different mode than viewing it — the bar tints
     red in both themes, so "am I editing?" is answerable at a glance. */
  .bar.editing {
    background-color: var(--edit-mode-bar);
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
  .tab .material-symbols-outlined {
    font-size: 18px;
  }

  /* The config bar's "Back to the display" link keeps the tab row's shape. */
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
