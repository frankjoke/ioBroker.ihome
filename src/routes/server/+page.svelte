<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { onMount } from "svelte";
  import { getStorage } from "$lib/tools.svelte";
  import PinModal from "$lib/components/common/PinModal.svelte";
  import {
    effectivePin,
    isDefaultPin,
    isUnlocked,
    unlock,
  } from "$lib/config/pin.svelte";
  import ioPackage from "../../../io-package.json";

  const storage = getStorage();
  const isConnected = $derived(!!ioBroker.connected);

  /**
   * The broker the live socket is actually on. The fields above may hold an
   * edit that has not been applied yet, so they must not be shown as "in use".
   */
  function activeBrokerUrl(): string {
    // What the connect actually resolved (ioBrokerConnect sets it per
    // connect): the ws default uses connectOptions.url, the io2 origin and an
    // explicit address land in brokerUrl.
    return ioBroker.brokerUrl ?? ioBroker.connectOptions?.url ?? "";
  }

  function applyAndReload() {
    location.reload();
  }

  let askingPin = $state(false);
  /** The unlock ask: the page itself stays quiet (no lock banner), but a
   *  bookmarked or reloaded visit while locked must not be a dead end — the
   *  modal opens on arrival. Coming from the wifi button the AppBar has already
   *  asked, so this is a no-op on that path. */
  let askingUnlock = $state(false);
  onMount(() => {
    if (!isUnlocked()) askingUnlock = true;
  });
  /** The change flow: current PIN first, then the new one. */
  let pinStep = $state<"off" | "verify" | "new">("off");

  /** True while the shipped default (or a missing/malformed value) is in force. */
  const pinIsDefault = $derived(isDefaultPin(storage.pin));
  /** What the prompt compares an entry against. */
  const storedPin = $derived(effectivePin(storage.pin));

  /**
   * The connection save. While the default PIN is still in force it does not
   * proceed: the change prompt opens instead, and the reload happens from there
   * once a real PIN is stored (D-04).
   */
  function saveConnection() {
    if (pinIsDefault) {
      askingPin = true;
      return;
    }
    applyAndReload();
  }

  /** What the app is actually talking to, in the operator's words — the
   *  answer to "why is it offline?" (ioBroker.transport, set per connect). */
  function transportLabel(): string {
    if (ioBroker.transport === "io2")
      return "the web adapter's socket on this page's server";
    if (ioBroker.transport === "ws") return "the admin socket (ws-server)";
    return "nothing yet";
  }
</script>

<svelte:head>
  <title>Server &amp; Security - iHome</title>
</svelte:head>

<div class="server-page">
  <div class="page-header">
    <h1>Server &amp; Security</h1>
  </div>

  <fieldset class="lock-zone" disabled={!isUnlocked()}>
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
          />
          <span class="hint text-muted"
            >Leave empty to use the configured broker fallback, or the host
            serving this page when no fallback is set (socket.io on port 8081).
            Editing this while connected is fine — saving reconnects.</span
          >
        </div>
        <div class="field">
          <label class="label-mono" for="settings-ns">Namespace</label>
          <input id="settings-ns" type="text" bind:value={storage.namespace} />
          <span class="hint text-muted"
            >Identity stamped as "from" on every write, e.g. ihome.0 — the
            adapter's io-package name plus instance.</span
          >
        </div>

        <div class="field">
          <label class="check">
            <input type="checkbox" bind:checked={storage.cloudFallback} />
            <span
              >Jump to iobroker.pro when the local ioBroker is unreachable</span
            >
          </label>
          <span class="hint text-muted"
            >For a phone or a PWA that is used at home and away: after a failed
            local attempt the app opens its own page on the cloud, where the
            browser's iobroker.pro session is the login. Nothing is stored here
            — off by default, so a wall display stays put and shows offline.</span
          >
        </div>
        <div class="field">
          <label class="label-mono" for="settings-cloud">Cloud address</label>
          <input
            id="settings-cloud"
            type="text"
            bind:value={storage.cloudHost}
            placeholder="iobroker.pro"
          />
        </div>

        {#if isConnected}
          <p class="conn-note">
            <span class="badge badge-success">connected</span>
            <span class="text-muted"
              >{ioBroker.namespace} via {activeBrokerUrl()} ({transportLabel()})</span
            >
          </p>
        {/if}
        <button class="btn btn-primary" onclick={saveConnection}>
          {isConnected ? "Save & reconnect" : "Apply & reload"}
        </button>
      </div>
    </section>

    <section class="card settings-card">
      <div class="card-header">
        <span class="material-symbols-outlined">lock</span>
        <h2 class="card-title">Security</h2>
      </div>
      <div class="card-body settings-card-body">
        <p class="text-muted hint">
          {pinIsDefault
            ? "The shipped default PIN is still in use — change it to your own. It guards the settings on this device only, and it is a convenience lock, not a security boundary."
            : "A PIN guards the settings on this device only. It is a convenience lock, not a security boundary."}
        </p>
        <label class="check">
          <input type="checkbox" bind:checked={storage.lockPencil} />
          <span
            >Ask for the PIN before the layout editor (the pencil) opens</span
          >
        </label>
        <button class="btn btn-primary" onclick={() => (pinStep = "verify")}
          >Change PIN</button
        >
      </div>
    </section>

    {#if askingPin}
      <PinModal
        title="Choose a new PIN"
        hint="The shipped default PIN is still in use — set your own before the connection can be saved."
        confirmLabel="Save PIN"
        onSubmit={(pin) => {
          storage.pin = pin;
          askingPin = false;
          applyAndReload();
        }}
        onCancel={() => (askingPin = false)}
      />
    {/if}

    {#if pinStep === "verify"}
      <PinModal
        title="Change PIN"
        hint="Enter your current PIN first."
        confirmLabel="Continue"
        expected={storedPin}
        onSubmit={() => (pinStep = "new")}
        onCancel={() => (pinStep = "off")}
      />
    {/if}

    {#if pinStep === "new"}
      <PinModal
        title="Choose a new PIN"
        hint="Digits only, 4 to 6 characters. It guards the settings on this device."
        confirmLabel="Save PIN"
        onSubmit={(pin) => {
          storage.pin = pin;
          pinStep = "off";
        }}
        onCancel={() => (pinStep = "off")}
      />
    {/if}

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
          >{ioPackage.common.titleLang.en} v{ioPackage.common.version}</span
        >
      </div>
    </section>
  </fieldset>

  <!-- Every modal above opens only from a control inside the fieldset, so a
         locked page can never hold one open in a disabled state; the unlock
         prompt is the one that must work while locked, hence outside. -->
  {#if askingUnlock}
    <PinModal
      title="Enter PIN for Server & Security"
      expected={storedPin}
      onSubmit={() => {
        unlock();
        askingUnlock = false;
      }}
      onCancel={() => (askingUnlock = false)}
    />
  {/if}
</div>

<style>
  .server-page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 640px;
  }

  /* The cards, as one all-or-nothing group: `disabled` on the fieldset reaches
     every input and button inside it, so a locked page cannot be typed into —
     which matters, because the fields write straight to localStorage. */
  .lock-zone {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    border: 0;
    margin: 0;
    padding: 0;
    min-inline-size: 0;
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

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--body-sm);
    cursor: pointer;
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
