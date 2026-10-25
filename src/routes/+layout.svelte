<script>
  import "../app.css";
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import { goto } from "$app/navigation";
  import { page } from "$app/state";
  import { building, dev } from "$app/environment";
  import {
    DEFAULT_NAMESPACE,
    ioBrokerStart,
  } from "$lib/ioBrokerConnect.svelte.js";
  import { FALLBACK_BROKER } from "$lib/broker-config";
  import { cloudPageUrl, shouldJumpToCloud } from "$lib/transport";
  import { defineStorage } from "$lib/tools.svelte";
  import { reloadUsedStates } from "$lib/states.svelte.js";
  import {
    setStateSource,
    setObjectSource,
    getCanonicalRegistry,
    devicesEnrichedStore,
    getUsedStateIds,
  } from "$lib/stores/devices.svelte.js";
  import { backfillDeviceEnums, initRegistry } from "$lib/registry.svelte.js";
  import { initFormulas } from "$lib/formulas.svelte.js";
  import { initVariables } from "$lib/variables.svelte.js";
  import {
    initPages,
    loadViewState,
    migrateLayout,
    waitForEnumCache,
  } from "$lib/stores/pages.svelte.js";
  import { initTemplates } from "$lib/stores/templates.svelte.js";
  import { seedPages, toFilterable } from "$lib/config/pages-ops";
  import { enumLabelFromObject } from "$lib/config/rooms";
  import { applyTheme, getTheme, themeStorage } from "$lib/theme.svelte.js";
  import {
    configNeedsPin,
    effectivePin,
    isUnlocked,
    isValidPin,
    unlock,
  } from "$lib/config/pin.svelte";
  import { initSettings } from "$lib/stores/settings.svelte";
  import AppBar from "$lib/components/AppBar.svelte";
  import PinModal from "$lib/components/common/PinModal.svelte";

  let { children } = $props();

  const storage = defineStorage(
    ["hostPort", { init: "" }],
    ["namespace", { init: DEFAULT_NAMESPACE }],
    ["pin", { init: "" }],
    // Cache of the shared doc's lock flag (settings.svelte.ts): the broker value
    // wins once loaded; this keeps the pencil gate working before/without a
    // socket. Ships off — the editor is used a lot during installation.
    ["lockPencil", { init: false }],
    // The iobroker.pro fallback (transport.ts): when the local ioBroker stays
    // unreachable, the app navigates to its own page on the cloud host, where
    // the browser's portal session takes over. Off by default — a wall display
    // must stay on its own page (showing offline) when the LAN hiccups, and
    // the phone/PWA is where this makes sense.
    ["cloudFallback", { init: false }],
    ["cloudHost", { init: "iobroker.pro" }],
    { prefix: "__VISUAL__:" },
  );

  // Earlier builds persisted their own default (`iHome`, before that `admin.0`);
  // those values are not a real namespace, so they count as "unset" — otherwise
  // writes keep the old identity instead of the adapter's. Read once, at connect.
  const LEGACY_NAMESPACES = ["admin.0", "iHome", "0_userdata.0.Test.AiHome"];
  const namespace =
    !storage.namespace || LEGACY_NAMESPACES.includes(storage.namespace)
      ? DEFAULT_NAMESPACE
      : storage.namespace;

  // Where the app talks to ioBroker is not decided here: the connect resolves
  // it (transport.ts) — an explicit address, the stored host:port, the web
  // adapter's own socket when one serves this page, or the admin port. The
  // info file has to be fetched for that, and connectIOBroker is async.
  const explicit =
    import.meta.env.VITE_SOCKET_URL ||
    new URLSearchParams(location.search).get("socket") ||
    "";
  const hostPort = storage.hostPort || FALLBACK_BROKER;
  const ioBroker = ioBrokerStart({
    namespace,
    explicit,
    hostPort,
    fetchInfo: () =>
      // The web adapter writes it inside the app's own directory (iqontrol
      // loads `_socket/info.js`), not next to it. The timeout matters: a broker
      // host that is down while the network is up must not leave the app
      // socket-less forever — after 2 s the rule table's fallback takes over.
      fetch(new URL("_socket/info.js", document.baseURI).href, {
        signal: AbortSignal.timeout(2000),
      })
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null),
  });

  /**
   * The cloud hand-over. On a phone or an installed PWA that is used at home
   * and away, a local ioBroker that cannot be reached means "try the cloud
   * page" — where the browser's iobroker.pro session is the login. Off by
   * default and never with an address the operator pinned (transport.ts
   * decides); a wall display stays on its own page and shows offline. Only a
   * page load that *never* connected jumps: a hiccup in a running session is
   * the client's own job to ride out, not a reason to change address. The
   * notice is on screen for a moment, so the move is not a mystery.
   */
  let cloudNotice = $state(false);
  let cloudJumped = false;
  let everConnected = false;
  $effect(() => {
    if (ioBroker.connected) everConnected = true;
  });
  const cloudTarget = $derived(
    shouldJumpToCloud({
      enabled: storage.cloudFallback === true,
      cloudHost: storage.cloudHost,
      explicit,
      hostPort,
      pageHost: location.host,
    }),
  );
  $effect(() => {
    if (cloudJumped || ioBroker.connected || !cloudTarget) return;
    // The connect gives up after 10 s; leave it a little room, then hand over.
    const timer = setTimeout(() => {
      if (cloudJumped || ioBroker.connected || everConnected) return;
      cloudJumped = true;
      cloudNotice = true;
      setTimeout(() => {
        // The connection may have come up while the notice was read.
        if (ioBroker.connected) return;
        const url = cloudPageUrl(storage.cloudHost, location.pathname);
        if (url) window.location.href = url;
      }, 2000);
    }, 12000);
    return () => clearTimeout(timer);
  });

  const current = $derived(page.route?.id ?? "/");
  const isConnected = $derived(!!ioBroker.connected);
  // The display routes own the whole viewport: no config header, no page
  // padding, no max width (spec §3). Their own slim bar is inside the page.
  // The layout route joins them: the spike renders the display behind its sheet,
  // so it needs the real width and no padding.
  const isDisplay = $derived(
    current === "/" || current.startsWith("/p/") || current === "/layout",
  );

  /**
   * Everything but the display is configuration and sits behind the PIN
   * (pin.svelte.ts). One gate here covers every entrance — the cog, the config
   * tabs, a Ctrl/Cmd+click shortcut, a bookmark, a reload — so no page has to
   * repeat it. The route's content is not rendered while locked: the page
   * cannot mount, so nothing in it can run. Cancelling goes back to the display.
   */
  const storedPin = $derived(effectivePin(storage.pin));
  const configLocked = $derived(configNeedsPin(isDisplay, isUnlocked()));

  /**
   * The settings doc is the truth; the storage keys are its cache.
   * @param {Record<string, unknown>} s
   */
  function applySettings(s) {
    if (isValidPin(s.pin)) storage.pin = s.pin;
    if (typeof s.lockPencil === "boolean") storage.lockPencil = s.lockPencil;
  }

  // The used set grows while the app loads (the registry and the pages arrive
  // after the first connect): subscribe again whenever it does, so no device
  // tile is left without live values. The connect itself subscribes once; this
  // covers everything after it, and a reconnect re-arms the same set.
  $effect(() => {
    getUsedStateIds(); // tracked: the $state version and the id sets
    if (!ioBroker.connected) return;
    ioBroker.syncSubscriptions();
    // Also the retry for a settings read that found no socket on first try.
    void initSettings(applySettings);
  });

  // Load all device states once the socket is up and the object cache is ready,
  // then again for any state objects that appear later. Pages read the shared
  // reactive ioBroker.states map directly.
  $effect(() => {
    if (!ioBroker.connected) return;
    // share the live caches with the device store (no import cycle)
    setStateSource(ioBroker.states);
    setObjectSource(ioBroker.objects);
    void ioBroker.objects.size;
    void reloadUsedStates(); // Fill any device whose functions/favorites are empty from the broker's own
    // enum membership, once the enums are in (a no-op when nothing changed).
    void (async () => {
      // both gates: the registry must be loaded and the enum cache populated
      await initRegistry();
      await waitForEnumCache();
      backfillDeviceEnums();
      // One-time bridge from a filter-based document to placements (A15). It
      // needs the pages *and* the complete device list, so it runs here and not
      // inside initPages (a partial device list would migrate sections to empty).
      // `initPages` is memoised: this is either the same load or the first one.
      await initPages(seedDisplayPages);
      // Migrate from the *canonical* device list — a synchronous snapshot — not
      // from the enriched display store, which polls every 50ms and can still
      // hold the pre-backfill (or empty) device set (review C2). Without devices
      // the migration would freeze `tiles: []` into the user's document.
      const canonical = getCanonicalRegistry().devices ?? [];
      if (canonical.length) {
        migrateLayout(canonical.map((d) => toFilterable(d)));
      }
    })();
  });

  /** The first-run page set: seeded from the broker's own room/function enums. */
  function seedDisplayPages() {
    return seedPages(
      (ioBroker.enums.getList("functions") ?? []).map((e) => ({
        id: e._id,
        label: enumLabelFromObject(e),
      })),
      (ioBroker.enums.getList("rooms") ?? []).map((e) => ({
        id: e._id,
        label: enumLabelFromObject(e),
      })),
    );
  }

  $effect(() => {
    // keep <html> in sync with the persisted theme
    themeStorage.theme;
    applyTheme();
  });

  onMount(() => {
    initRegistry();
    initFormulas();
    initVariables();
    initTemplates();
    void initSettings(applySettings);
    loadViewState();
    // Registered here rather than by SvelteKit: its own call uses
    // `updateViaCache: 'imports'`, and the ioBroker web adapter serves
    // service-worker.js with `Cache-Control: max-age=6000` — so the update
    // check could sit on a cached copy for 100 minutes and a deployed build
    // looked like it never arrived. `none` re-fetches the worker every time.
    if (!dev && !building && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register(`${base}/service-worker.js`, {
        updateViaCache: "none",
      });
    }
    // Seed the display pages from the broker's own enums, once (spec §9).
    initPages(seedDisplayPages);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (getTheme() === "auto") applyTheme();
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  });
</script>

<svelte:head>
  <title>iHome</title>
</svelte:head>

<div class="app-shell" class:display={isDisplay} class:config={!isDisplay}>
  {#if cloudNotice}
    <p class="cloud-notice" role="status">
      <span class="material-symbols-outlined">cloud_sync</span>
      Local ioBroker not reachable — trying {storage.cloudHost}…
    </p>
  {/if}
  <AppBar />

  <main class="app-main">
    {#if configLocked}
      <PinModal
        title="Enter PIN for the configuration"
        hint="The display stays open; changing its configuration needs the PIN."
        expected={storedPin}
        onSubmit={() => unlock()}
        onCancel={() => void goto("#/")}
      />
    {:else}
      {@render children()}
    {/if}
  </main>

  {#if !isConnected}
    <footer class="app-footer">
      <div class="footer-inner">
        <div class="footer-heading">
          <span
            class="status-dot"
            class:ok={isConnected}
            class:connecting={!isConnected}
          ></span>
          <span class="label-mono">Connection</span>
        </div>

        <div class="footer-fields">
          <!-- The connection fields live on Server & Security only: a display
               that is offline must not be a second, ungated way to repoint the
               broker. That page asks for the PIN, like every config route. -->
          <a class="btn btn-primary" href={`${base}/#/server`}
            >Configure connection</a
          >
        </div>

        {#if isConnected}
          <span class="badge badge-success">connected</span>
        {:else}
          <span class="badge badge-warning"
            >{ioBroker.namespace} · not connected</span
          >
        {/if}
      </div>
    </footer>
  {/if}
</div>

<style>
  .app-shell {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }

  /* The config mode: the page wears the soft blue the way the editor's bar
     wears red — one plain colour, no color-mix (see app.css). Every
     non-display route, so the bar tint and the page are the same mode. */
  .app-shell.config {
    background-color: var(--config-bg);
  }

  /* ------------------------------------------------------------ main */

  .app-main {
    flex: 1;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 8px;
  }

  .app-shell.display .app-main {
    max-width: none;
    margin: 0;
    padding: 0;
  }

  /* ---------------------------------------------------------- footer */

  .app-footer {
    border-top: 1px solid var(--border-color);
    background-color: var(--surface-container);
    padding: 14px 24px;
    transition: background-color var(--transition-normal);
  }

  .footer-inner {
    max-width: 1200px;
    margin: 0 auto;
    display: flex;
    align-items: flex-end;
    gap: 1.25rem;
    flex-wrap: wrap;
  }

  .footer-heading {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background-color: var(--warning-color);
  }

  .status-dot.ok {
    background-color: var(--tertiary);
  }

  .status-dot.connecting {
    background-color: var(--warning-color);
    animation: pulse 1.4s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  .footer-fields {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  /* The moment before the cloud hand-over: on screen, above everything, and
     gone with the navigation it announces. */
  .cloud-notice {
    position: fixed;
    inset: auto 0 0 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    margin: 0;
    padding: 0.6rem 1rem;
    background-color: var(--warning-color);
    color: #101418;
    font-size: var(--body-sm);
  }
</style>
