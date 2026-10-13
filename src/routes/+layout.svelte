<script>
  import "../app.css";
  import { onMount } from "svelte";
  import { base } from "$app/paths";
  import { page } from "$app/state";
  import { ioBrokerStart } from "$lib/ioBrokerConnect.svelte.js";
  import { defineStorage } from "$lib/tools.svelte";
  import { loadUsedStates } from "$lib/states.svelte.js";
  import {
    setStateSource,
    setObjectSource,
  } from "$lib/stores/devices.svelte.js";
  import { initRegistry } from "$lib/registry.svelte.js";
  import { initFormulas } from "$lib/formulas.svelte.js";
  import { setHistoryClient } from "$lib/stores/history.svelte";
  import { applyTheme, getTheme, themeStorage } from "$lib/theme.svelte.js";
  import ThemeToggle from "$lib/ThemeToggle.svelte";
  import { pages, pageHref } from "$lib/pages.js";

  let { children } = $props();

  const storage = defineStorage(
    ["hostPort", { init: "" }],
    ["namespace", { init: "admin.0" }],
    { prefix: "__VISUAL__:" },
  );

  function buildUrl(hostPort) {
    if (hostPort) return `ws://${hostPort}/socket.io`;
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    return `${protocol}://${location.host}/socket.io`;
  }

  const ioBroker = ioBrokerStart({
    namespace: storage.namespace || "admin.0",
    url: buildUrl(storage.hostPort),
  });

  // give the history store its broker access (no import cycle, testable store)
  setHistoryClient(ioBroker);

  let footerOpen = $state(false);
  // active tab is derived from the SvelteKit hash router's resolved route
  const current = $derived(page.route?.id ?? "/");
  const isConnected = $derived(!!ioBroker.connected);

  // Load all device states once the socket is up and the object cache is ready,
  // then again for any state objects that appear later. Pages read the shared
  // reactive ioBroker.states map directly.
  $effect(() => {
    if (!ioBroker.connected) return;
    // share the live caches with the device store (no import cycle)
    setStateSource(ioBroker.states);
    setObjectSource(ioBroker.objects);
    void ioBroker.objects.size;
    loadUsedStates();
  });

  $effect(() => {
    // keep <html> in sync with the persisted theme
    themeStorage.theme;
    applyTheme();
  });

  onMount(() => {
    initRegistry();
    initFormulas();
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
  <title>ioBroker Visual Interface</title>
</svelte:head>

<div class="app-shell">
  <header class="app-header">
    <a class="brand" href={`${base}/#/`}>
      <img src={`${base}/house-controller.svg`} alt="" width="30" height="30" />
      <span class="brand-name">ioBroker Visual</span>
    </a>

    <nav class="tab-bar" aria-label="Pages">
      {#each pages as p (p.id)}
        <a
          class="tab"
          class:active={current === p.id}
          href={pageHref(p.id, base)}
          aria-current={current === p.id ? "page" : undefined}
        >
          <span class="material-symbols-outlined">{p.icon}</span>
          <span class="tab-label">{p.label}</span>
        </a>
      {/each}
    </nav>

    <div class="header-actions">
      <ThemeToggle />
      <a
        class="icon-btn"
        class:active={current === "/settings"}
        href={`${base}/#/settings`}
        title="Settings"
        aria-label="Settings"
      >
        <span class="material-symbols-outlined">settings</span>
      </a>
      <button
        type="button"
        class="icon-btn status-btn"
        class:connected={isConnected}
        title={isConnected
          ? "Connected — show/hide connection details"
          : "Disconnected — show/hide connection details"}
        aria-label={isConnected
          ? "Connected. Toggle connection footer"
          : "Disconnected. Toggle connection footer"}
        aria-expanded={footerOpen || !isConnected}
        onclick={() => (footerOpen = !footerOpen)}
      >
        <span class="material-symbols-outlined"
          >{isConnected ? "wifi" : "wifi_off"}</span
        >
      </button>
    </div>
  </header>

  <main class="app-main">
    {@render children()}
  </main>

  {#if footerOpen || !isConnected}
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

  /* ---------------------------------------------------------- header */

  .app-header {
    position: sticky;
    top: 0;
    z-index: 50;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 1rem;
    padding: 0.7rem 24px;
    background-color: var(--surface-container-low);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: blur(8px);
  }

  .brand {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 0.6rem;
    font-weight: 700;
    font-size: 1.05rem;
    letter-spacing: -0.01em;
    color: var(--text-color);
  }

  .brand:hover {
    text-decoration: none;
  }

  .brand img {
    border-radius: 8px;
  }

  /* centered tab bar, rendered from the page registry */
  .tab-bar {
    justify-self: center;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 4px;
    background-color: var(--surface-container-lowest);
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-pill);
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 16px;
    border-radius: var(--border-radius-pill);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
    transition:
      background-color var(--transition-fast),
      color var(--transition-fast);
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

  .header-actions {
    justify-self: end;
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    border: 1px solid transparent;
    border-radius: var(--border-radius-pill);
    background-color: transparent;
    color: var(--text-muted);
    transition:
      background-color var(--transition-fast),
      color var(--transition-fast);
  }

  .icon-btn:hover {
    text-decoration: none;
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .icon-btn.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .status-btn .material-symbols-outlined {
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

  /* ------------------------------------------------------------ main */

  .app-main {
    flex: 1;
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
    padding: 24px;
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

  /* -------------------------------------------------------- responsive */

  @media (max-width: 768px) {
    .app-header {
      grid-template-columns: auto 1fr;
      grid-template-areas:
        "brand actions"
        "tabs tabs";
      row-gap: 0.5rem;
      padding: 0.6rem 16px;
    }

    .brand {
      grid-area: brand;
    }

    .header-actions {
      grid-area: actions;
    }

    .tab-bar {
      grid-area: tabs;
      justify-self: stretch;
      justify-content: center;
      overflow-x: auto;
    }

    .app-main {
      padding: 16px;
    }

    .field input {
      min-width: 140px;
    }
  }
</style>
