<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { getStorage } from "$lib/tools.svelte";
  import PinModal from "$lib/components/common/PinModal.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import {
    effectivePin,
    isDefaultPin,
    isUnlocked,
  } from "$lib/config/pin.svelte";
  import {
    settingsSaveFailed,
    updateSettings,
  } from "$lib/stores/settings.svelte";
  import { appBaseUrl } from "$lib/config/frame-url";
  import ioPackage from "../../../io-package.json";
  import PhoneCard from "$lib/components/config/PhoneCard.svelte";

  const storage = getStorage();
  const isConnected = $derived(!!ioBroker.connected);

  /** One collapsible item per form; the line keeps what fits, the editor the rest. */
  let openSection = $state("");

  /** What local frame/HTML links should start with in this view: relative in
   *  production (follows the page origin, so it works locally and through
   *  iobroker.pro), the broker's absolute base in dev. */
  const pageBase = appBaseUrl({
    dev: import.meta.env.DEV,
    origin: import.meta.env.VITE_IOBROKER_ORIGIN || "http://localhost:8082",
  });

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

  function toggle(id: string) {
    openSection = openSection === id ? "" : id;
  }

  /** The free line is a mouse convenience; controls keep their own hit areas. */
  function onLineClick(event: MouseEvent, id: string) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    toggle(id);
  }

  let askingPin = $state(false);
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
    <div class="settings-list">
      <div class="item" class:open={openSection === "connection"}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="item-line" onclick={(e) => onLineClick(e, "connection")}>
          <Icon value="lan" size={18} />
          <button
            type="button"
            class="name"
            aria-expanded={openSection === "connection"}
            onclick={() => toggle("connection")}>Connection</button
          >
          <span class="meta mono conn-host"
            >{storage.hostPort || "this server"}</span
          >
          <span class="item-actions">
            {#if isConnected}
              <span class="badge badge-success">connected</span>
            {/if}
          </span>
        </div>
        {#if openSection === "connection"}
          <div class="item-editor settings-card-body">
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
                serving this page when no fallback is set (socket.io on port
                8081). Editing this while connected is fine — saving reconnects.</span
              >
              <span class="hint text-muted"
                >Page base for local links: <span class="mono">{pageBase}</span
                >. Relative in production, so frames/HTML work locally and
                through iobroker.pro; in dev it points at the broker.</span
              >
            </div>
            <div class="field">
              <label class="label-mono" for="settings-ns">Namespace</label>
              <input
                id="settings-ns"
                type="text"
                bind:value={storage.namespace}
              />
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
                >For a phone or a PWA that is used at home and away: after a
                failed local attempt the app opens its own page on the cloud,
                where the browser's iobroker.pro session is the login. Nothing
                is stored here — off by default, so a wall display stays put and
                shows offline.</span
              >
            </div>
            <div class="field">
              <label class="label-mono" for="settings-cloud"
                >Cloud address</label
              >
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
        {/if}
      </div>

      <div class="item" class:open={openSection === "security"}>
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div class="item-line" onclick={(e) => onLineClick(e, "security")}>
          <Icon value="lock" size={18} />
          <button
            type="button"
            class="name"
            aria-expanded={openSection === "security"}
            onclick={() => toggle("security")}>Security</button
          >
          <span class="item-actions">
            <span
              class="badge"
              class:badge-warning={pinIsDefault}
              class:badge-secondary={!pinIsDefault}
              >{pinIsDefault ? "default PIN" : "PIN set"}</span
            >
          </span>
        </div>
        {#if openSection === "security"}
          <div class="item-editor settings-card-body">
            <p class="text-muted hint">
              {pinIsDefault
                ? "The shipped default PIN is still in use — change it to your own. It guards the whole configuration of this ioBroker for every device, and it is a convenience lock, not a security boundary."
                : "A PIN guards the whole configuration of this ioBroker for every device. It is a convenience lock, not a security boundary."}
            </p>
            <label class="check">
              <input
                type="checkbox"
                bind:checked={storage.lockPencil}
                onchange={() =>
                  void updateSettings({ lockPencil: storage.lockPencil })}
              />
              <span
                >Ask for the PIN before the layout editor (the pencil) opens</span
              >
            </label>
            <label class="check">
              <input
                type="checkbox"
                bind:checked={storage.pinDisabled}
                onchange={() =>
                  void updateSettings({ pinDisabled: storage.pinDisabled })}
              />
              <span
                >Skip the PIN for the configuration pages (testing only — anyone
                on this browser can change the setup)</span
              >
            </label>
            {#if settingsSaveFailed()}
              <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
            {/if}
            <button class="btn btn-primary" onclick={() => (pinStep = "verify")}
              >Change PIN</button
            >
          </div>
        {/if}
      </div>

      <div class="item">
        <div class="item-line about-line">
          <Icon value="info" size={18} />
          <span class="name static-name">About</span>
          <span class="meta"
            >Visual interface for ioBroker smart home control</span
          >
          <span class="item-actions mono hint text-muted"
            >{ioPackage.common.titleLang.en} v{ioPackage.common.version}</span
          >
        </div>
      </div>
    </div>

    {#if askingPin}
      <PinModal
        title="Choose a new PIN"
        hint="The shipped default PIN is still in use — set your own before the connection can be saved."
        confirmLabel="Save PIN"
        onSubmit={(pin) => {
          storage.pin = pin;
          askingPin = false;
          // The reload must not beat the broker write, or the new PIN never
          // reaches the settings document; a failed write keeps the page open
          // (the Security card reports it) instead of saving the connection
          // behind a PIN the document does not know.
          void updateSettings({ pin }).then((ok) => {
            if (ok) applyAndReload();
          });
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
        hint="Digits only, 4 to 6 characters. It guards the configuration on every device."
        confirmLabel="Save PIN"
        onSubmit={(pin) => {
          storage.pin = pin;
          void updateSettings({ pin });
          pinStep = "off";
        }}
        onCancel={() => (pinStep = "off")}
      />
    {/if}
  </fieldset>

  <!-- Per-device, not a broker setting: reachable without the config PIN
       because the route gate already asks before the page mounts. -->
  <PhoneCard />

  <!-- The modals above open only from a control inside the fieldset; the
       route-level PIN gate in +layout.svelte is what asks before this page
       mounts at all. -->
</div>

<style>
  .server-page {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    max-width: 640px;
    margin: 0 auto;
  }

  /* The items, as one all-or-nothing group: `disabled` on the fieldset reaches
     every input and button inside it, so a locked page cannot be typed into —
     which matters, because the fields write straight to localStorage. */
  .lock-zone {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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

  .settings-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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

  .meta {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--body-sm);
    color: var(--text-muted);
  }

  .conn-host {
    max-width: 14rem;
  }

  .about-line {
    cursor: default;
  }

  .static-name {
    font-weight: 600;
  }

  .conn-note {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
