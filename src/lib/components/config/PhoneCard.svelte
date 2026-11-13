<script lang="ts">
  import { onMount } from "svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import {
    getCanonicalRegistry,
    setCanonicalRegistry,
  } from "$lib/stores/devices.svelte";
  import { saveRegistry } from "$lib/registry.svelte.js";
  import { newId } from "$lib/utils/ids";
  import { homeFromSystemConfig } from "$logic/phone-ops";
  import {
    getPhoneFix,
    homePoint,
    initPhone,
    pausePhone,
    phone,
    phoneDeviceLabel,
    requestPhoneLocation,
    setPhoneEnabled,
    setPhoneHome,
    setPhoneName,
  } from "$lib/stores/phone.svelte";
  import {
    disablePush,
    enablePush,
    initPush,
    push,
  } from "$lib/stores/push.svelte";

  let message = $state("");
  let pushMessage = $state("");
  let open = $state(false);

  /** The free line is a mouse convenience; controls keep their own hit areas. */
  function onLineClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (
      target.closest(".item-actions, button, input, select, textarea, a, label")
    ) {
      return;
    }
    open = !open;
  }
  const systemHome = $derived(homeFromSystemConfig(ioBroker.systemConfig));
  const secure = $derived(
    location.protocol === "https:" ||
      ["localhost", "127.0.0.1", "::1"].includes(location.hostname),
  );
  const devicePrefix = $derived(
    `${ioBroker.namespace}.phone.${phone.deviceId}.`,
  );
  const deviceExists = $derived(
    getCanonicalRegistry().devices.some((device) =>
      device.controls.some((control) =>
        control.stateId?.startsWith(devicePrefix),
      ),
    ),
  );

  onMount(() => {
    initPhone();
    initPush();
  });

  function statusText(): string {
    if (phone.status.atHome === true) return "At home";
    if (phone.status.atHome === false) return "Away";
    return "Unknown";
  }

  function lastSeenText(): string {
    if (!phone.status.lastSeen) return "never";
    return new Date(phone.status.lastSeen).toLocaleTimeString();
  }

  async function setHomeHere() {
    const location = await getPhoneFix();
    if (!location) {
      message = "No fix — use the system location or allow location access.";
      return;
    }
    setPhoneHome({
      lat: location.lat,
      lon: location.lon,
      radius: homePoint()?.radius ?? 150,
    });
    message = "Home point saved from this phone.";
  }

  function useSystemHome() {
    if (!systemHome) return;
    setPhoneHome(systemHome);
    message = "Home point taken from the ioBroker system location.";
  }

  function setRadius(value: string) {
    const home = homePoint();
    const radius = Number(value);
    if (!home || !Number.isFinite(radius) || radius <= 0) return;
    setPhoneHome({ ...home, radius });
  }

  async function sendTestPush() {
    pushMessage = "";
    try {
      const result = (await ioBroker.sendTo(ioBroker.namespace, "notify", {
        title: "iHome test",
        body: "Push works",
        level: "info",
      })) as { ok?: boolean; sent?: number; error?: string } | undefined;
      pushMessage = result?.ok
        ? `Sent to ${result.sent ?? 0} device(s).`
        : (result?.error ?? "The adapter did not accept the test.");
    } catch (error) {
      pushMessage = error instanceof Error ? error.message : String(error);
    }
  }

  function createPhoneDevice() {
    const reg = getCanonicalRegistry();
    if (
      reg.devices.some((device) =>
        device.controls.some((control) =>
          control.stateId?.startsWith(devicePrefix),
        ),
      )
    ) {
      return;
    }
    const fields = [
      ["atHome", "At home", "indicator.state", "boolean"],
      ["online", "Online", "indicator.state", "boolean"],
      ["connection", "Connection", "text", "string"],
      ["distance", "Distance", "value", "number"],
      ["lastSeen", "Last seen", "value.time", "number"],
      ["locationText", "Location", "text", "string"],
      ["mapUrl", "Map", "text", "string"],
    ] as const;
    const controls = fields.map(([feature, label, role, type]) => ({
      id: newId(),
      feature,
      label,
      writable: false,
      stateId: `${devicePrefix}${feature}`,
      common: { role, type, read: true, write: false },
    }));
    setCanonicalRegistry({
      ...reg,
      version: (reg.version ?? 0) + 1,
      updatedAt: Date.now(),
      devices: [
        ...reg.devices,
        {
          id: newId(),
          name: phoneDeviceLabel(phone.name),
          type: "Custom",
          icon: "smartphone",
          controls,
        },
      ],
    });
    saveRegistry();
    message = "Phone device created — add it to a page in the tile editor.";
  }
</script>

<div class="item" class:open>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="item-line" onclick={onLineClick}>
    <span class="material-symbols-outlined" aria-hidden="true">smartphone</span>
    <button
      type="button"
      class="name"
      aria-expanded={open}
      onclick={() => (open = !open)}>{phone.name || "This phone"}</button
    >
    <span class="item-actions">
      <label class="inline" title="Report this phone's presence to ioBroker">
        reported
        <input
          type="checkbox"
          checked={phone.enabled}
          onchange={(event) => {
            const enabled = event.currentTarget.checked;
            setPhoneEnabled(enabled);
            if (enabled) void requestPhoneLocation();
          }}
        />
      </label>
      <label
        class="inline"
        title={push.supported
          ? "Push notifications on this phone"
          : "Push is not supported in this browser"}
      >
        notifications
        <input
          type="checkbox"
          checked={push.subscribed}
          disabled={!push.supported || push.busy}
          onchange={(event) =>
            void (event.currentTarget.checked ? enablePush() : disablePush())}
        />
      </label>
    </span>
  </div>

  {#if open}
    <div class="item-editor phone-body">
      <div class="field">
        <label class="label-mono" for="phone-name">Device name</label>
        <input
          id="phone-name"
          type="text"
          value={phone.name}
          maxlength="64"
          onchange={(event) => setPhoneName(event.currentTarget.value)}
        />
      </div>

      {#if phone.enabled}
        <div class="phone-actions">
          <button
            class="btn"
            type="button"
            onclick={() => pausePhone(!phone.paused)}
          >
            {phone.paused ? "Resume" : "Pause"}
          </button>
          <button
            class="btn"
            type="button"
            onclick={() => void requestPhoneLocation()}
          >
            Request location
          </button>
        </div>
      {/if}

      {#if !secure}
        <p class="hint warning">
          Location needs HTTPS — use iobroker.pro or a local HTTPS proxy. The
          LAN HTTP URL can still report online/connection only.
        </p>
      {/if}

      <div class="phone-status">
        <div>
          <span class="label-mono">Status</span><span>{statusText()}</span>
        </div>
        <div>
          <span class="label-mono">Source</span><span
            >{phone.status.homeSource}</span
          >
        </div>
        <div>
          <span class="label-mono">Network</span><span
            >{phone.status.local ? "local" : "cloud"} · {phone.status
              .connection}</span
          >
        </div>
        <div>
          <span class="label-mono">Permission</span><span
            >{phone.status.permission}</span
          >
        </div>
        <div>
          <span class="label-mono">Distance</span><span
            >{phone.status.distance == null
              ? "—"
              : `${Math.round(phone.status.distance)} m`}</span
          >
        </div>
        <div>
          <span class="label-mono">Last sent</span><span>{lastSeenText()}</span>
        </div>
      </div>

      <div class="home-row">
        <div>
          <span class="label-mono">Home point</span>
          <span class="home-value">
            {#if homePoint()}
              {homePoint()!.lat.toFixed(4)}, {homePoint()!.lon.toFixed(4)}
            {:else}
              not set
            {/if}
          </span>
        </div>
        <label class="radius">
          <span class="label-mono">radius</span>
          <input
            type="number"
            min="10"
            max="10000"
            value={homePoint()?.radius ?? 150}
            onchange={(event) => setRadius(event.currentTarget.value)}
          />
          <span class="text-muted">m</span>
        </label>
      </div>
      <div class="phone-actions">
        <button class="btn" type="button" onclick={() => void setHomeHere()}>
          Set home from this phone
        </button>
        {#if systemHome}
          <button class="btn" type="button" onclick={useSystemHome}>
            Use system location
          </button>
        {/if}
      </div>

      <div class="phone-actions">
        <button
          class="btn btn-primary"
          type="button"
          disabled={deviceExists}
          onclick={createPhoneDevice}
        >
          {deviceExists ? "Phone device created" : "Create phone device"}
        </button>
      </div>

      <div class="push-block">
        <span class="label-mono">Notifications</span>
        <p class="hint text-muted">
          Notifications need HTTPS and, on iPhone, the PWA installed on the home
          screen.
        </p>
        {#if push.supported}
          <div class="phone-actions">
            <button
              class="btn"
              type="button"
              disabled={!push.subscribed || push.busy}
              onclick={() => void sendTestPush()}
            >
              Send test notification
            </button>
          </div>
          <div class="phone-status">
            <div>
              <span class="label-mono">Permission</span><span
                >{push.permission}</span
              >
            </div>
            <div>
              <span class="label-mono">Subscription</span><span
                >{push.subscribed ? "active" : "none"}</span
              >
            </div>
          </div>
        {:else}
          <p class="hint warning">Push is not supported in this browser.</p>
        {/if}
        {#if push.error}
          <p class="hint danger">{push.error}</p>
        {/if}
        {#if pushMessage}
          <p class="hint text-muted">{pushMessage}</p>
        {/if}
      </div>

      {#if message}
        <p class="hint text-muted">{message}</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .phone-body {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    align-items: stretch;
  }

  .inline {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--body-sm);
    cursor: pointer;
  }

  .phone-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }

  .push-block {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border-top: 1px solid var(--border-color);
    padding-top: 1rem;
  }

  .phone-status {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem 1rem;
    font-size: var(--body-sm);
  }

  .phone-status > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .home-row {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .home-value {
    display: block;
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }

  .radius {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
  }

  .radius input {
    width: 5.5rem;
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }

  .warning {
    color: var(--warning-color);
  }

  .danger {
    color: var(--danger-color);
  }
</style>
