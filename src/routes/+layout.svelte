<script>
  import "../app.css";
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import { building, dev } from "$app/environment";
  import {
    DEFAULT_NAMESPACE,
    ioBrokerStart,
  } from "$lib/ioBrokerConnect.svelte.js";
  import { defaultSocketUrl, socketUrlFromHostPort } from "$lib/socket-url";
  import { defineStorage } from "$lib/tools.svelte";
  import { reloadUsedStates } from "$lib/states.svelte.js";
  import {
    setStateSource,
    setObjectSource,
    getCanonicalRegistry,
    devicesEnrichedStore,
  } from "$lib/stores/devices.svelte.js";
  import { backfillDeviceEnums, initRegistry } from "$lib/registry.svelte.js";
  import { initFormulas } from "$lib/formulas.svelte.js";
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
  import AppBar from "$lib/components/AppBar.svelte";

  let { children } = $props();

  const storage = defineStorage(
    ["hostPort", { init: "" }],
    ["namespace", { init: DEFAULT_NAMESPACE }],
    ["pin", { init: "" }],
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

  function buildUrl(hostPort) {
    return socketUrlFromHostPort(hostPort) || defaultSocketUrl();
  }

  const ioBroker = ioBrokerStart({
    namespace,
    url: buildUrl(storage.hostPort),
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

  // Load all device states once the socket is up and the object cache is ready,
  // then again for any state objects that appear later. Pages read the shared
  // reactive ioBroker.states map directly.
  $effect(() => {
    if (!ioBroker.connected) return;
    // share the live caches with the device store (no import cycle)
    setStateSource(ioBroker.states);
    setObjectSource(ioBroker.objects);
    void ioBroker.objects.size;
    void reloadUsedStates();
    // Fill any device whose functions/favorites are empty from the broker's own
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
    initTemplates();
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

  function connect() {
    // connection options are read at startup — persist and reload
    location.reload();
  }
</script>

<svelte:head>
  <title>iHome</title>
</svelte:head>

<div class="app-shell" class:display={isDisplay}>
  <AppBar />

  <main class="app-main">
    {@render children()}
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
          <div class="field">
            <label class="label-mono" for="footer-host">Host:Port</label>
            <input
              id="footer-host"
              type="text"
              bind:value={storage.hostPort}
              disabled={isConnected}
            />
          </div>
          <div class="field">
            <label class="label-mono" for="footer-ns">Namespace</label>
            <input
              id="footer-ns"
              type="text"
              bind:value={storage.namespace}
              disabled={isConnected}
            />
          </div>
          {#if !isConnected}
            <!-- The other, un-gated path to hostPort: the settings route asks
                 for a PIN, this footer (disconnected only) does not. PIN-gating
                 it was scoped out of the PIN task. -->
            <button class="btn btn-primary" onclick={connect}
              >Apply & Reload</button
            >
          {/if}
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

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field input {
    min-width: 180px;
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }
</style>
