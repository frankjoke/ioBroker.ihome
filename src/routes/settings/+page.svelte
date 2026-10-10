<script>
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getStorage } from "$lib/tools.svelte";
  import ThemeToggle from "$lib/ThemeToggle.svelte";
  import ioPackage from "../../../io-package.json";

  const storage = getStorage();
  const isConnected = $derived(!!ioBroker.connected);

  function applyAndReload() {
    location.reload();
  }
</script>

<svelte:head>
  <title>Settings - ioBroker Visual Interface</title>
</svelte:head>

<div class="settings-page">
  <div class="page-header">
    <span class="label-mono">Configuration</span>
    <h1>Settings</h1>
  </div>

  <section class="card settings-card">
    <div class="card-header">
      <span class="material-symbols-outlined">lan</span>
      <h2 class="card-title">Connection</h2>
    </div>
    <div class="card-body settings-card-body">
      <div class="field">
        <label class="label-mono" for="settings-host">Host:Port</label>
        <input
          id="settings-host"
          type="text"
          bind:value={storage.hostPort}
          placeholder="e.g. 192.168.1.10:8081"
          disabled={isConnected}
        />
        <span class="hint text-muted"
          >Leave empty to use the host serving this page.</span
        >
      </div>
      <div class="field">
        <label class="label-mono" for="settings-ns">Namespace</label>
        <input
          id="settings-ns"
          type="text"
          bind:value={storage.namespace}
          disabled={isConnected}
        />
        <span class="hint text-muted">ioBroker instance, e.g. admin.0</span>
      </div>

      {#if isConnected}
        <p class="conn-note">
          <span class="badge badge-success">connected</span>
          <span class="text-muted"
            >{ioBroker.namespace} via {storage.hostPort || "this host"}</span
          >
        </p>
      {:else}
        <button class="btn btn-primary" onclick={applyAndReload}>
          Apply & Reload
        </button>
      {/if}
    </div>
  </section>

  <section class="card settings-card">
    <div class="card-header">
      <span class="material-symbols-outlined">palette</span>
      <h2 class="card-title">Appearance</h2>
    </div>
    <div class="card-body settings-card-body">
      <p class="text-muted hint">
        Theme follows the system setting by default. Choose Light or Dark to
        override it — your choice is remembered on this device.
      </p>
      <ThemeToggle />
    </div>
  </section>

  <section class="card settings-card">
    <div class="card-header">
      <span class="material-symbols-outlined">info</span>
      <h2 class="card-title">About</h2>
    </div>
    <div class="card-body about-body">
      <span class="text-muted"
        >Visual interface for ioBroker smart home control</span
      >
      <span class="about-version mono"
        >{ioPackage.common.title} v{ioPackage.common.version}</span
      >
    </div>
  </section>
</div>

<style>
  .settings-page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 640px;
  }

  .page-header {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .page-header h1 {
    margin: 0;
  }

  .settings-card .card-header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .settings-card .card-header .material-symbols-outlined {
    font-size: 18px;
    color: var(--text-muted);
  }

  .settings-card-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: flex-start;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .field input {
    width: 100%;
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }

  .hint {
    font-size: var(--body-sm);
  }

  .conn-note {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0;
    font-size: var(--body-sm);
  }

  .about-body {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    font-size: var(--body-md);
  }

  .about-version {
    color: var(--text-muted);
  }
</style>
