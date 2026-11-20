<script lang="ts">
  import { externalSessionSettings, parseHostList } from "$lib/config/locality";
  import { isDefaultPin } from "$lib/config/pin.svelte";
  import { BUILTIN_PAGES } from "$lib/config/builtin-pages";
  import {
    getSettings,
    settingsSaveFailed,
    updateSettings,
  } from "$lib/stores/settings.svelte";
  import { getPageRegistry } from "$lib/stores/pages.svelte";
  import type { PageRegistry } from "$lib/types/display";

  const initial = externalSessionSettings(getSettings().externalSession);
  let localText = $state(initial.localHosts.join("\n"));
  let externalText = $state(initial.externalHosts.join("\n"));
  let localDirty = $state(false);
  let externalDirty = $state(false);
  let forceExternal = $state(initial.forceExternal);
  let error = $state("");

  // A late settings read fills an untouched field; typing is never overwritten.
  $effect(() => {
    const current = externalSessionSettings(getSettings().externalSession);
    if (!localDirty) localText = current.localHosts.join("\n");
    if (!externalDirty) externalText = current.externalHosts.join("\n");
    forceExternal = current.forceExternal;
  });

  const pinSet = $derived(!isDefaultPin(getSettings().pin));
  const securedTiles = $derived(countSecured(getPageRegistry()));
  const hiddenPages = BUILTIN_PAGES.filter(
    (page) => page.secured === true,
  ).length;

  function countSecured(registry: PageRegistry): number {
    let count = 0;
    for (const page of registry.pages ?? []) {
      for (const group of page.groups ?? []) {
        for (const placement of group.tiles ?? []) {
          if (placement.tile?.secured === true) count += 1;
        }
      }
    }
    return count;
  }

  async function saveHosts(): Promise<void> {
    error = "";
    const localHosts = parseHostList(localText);
    const externalHosts = parseHostList(externalText);
    const both = localHosts.filter((host) => externalHosts.includes(host));
    if (both.length) {
      error = `In both lists: ${both.join(", ")}`;
      return;
    }
    localText = localHosts.join("\n");
    externalText = externalHosts.join("\n");
    localDirty = false;
    externalDirty = false;
    const current = externalSessionSettings(getSettings().externalSession);
    await updateSettings({
      externalSession: { ...current, localHosts, externalHosts },
    });
  }

  async function saveForce(): Promise<void> {
    const current = externalSessionSettings(getSettings().externalSession);
    await updateSettings({
      externalSession: { ...current, forceExternal },
    });
  }
</script>

<p class="hint text-muted">
  Protections here are visibility, not access control. The boundary is your
  access layer (VPN, reverse-proxy auth, web.0 auth).
</p>

<label class="field">
  <span class="label-mono">Local hosts</span>
  <textarea
    rows="3"
    bind:value={localText}
    oninput={() => (localDirty = true)}
    onblur={saveHosts}
    placeholder="one host per line, e.g. vpn.example.com"
  ></textarea>
</label>

<label class="field">
  <span class="label-mono">External hosts</span>
  <textarea
    rows="3"
    bind:value={externalText}
    oninput={() => (externalDirty = true)}
    onblur={saveHosts}
    placeholder="one host per line, e.g. home.example.com"
  ></textarea>
</label>

{#if error}
  <p class="hint text-danger">{error}</p>
{/if}

<label class="check">
  <input type="checkbox" bind:checked={forceExternal} onchange={saveForce} />
  <span>Treat every session as external</span>
</label>

<p class="hint text-muted">
  PIN: {pinSet ? "set" : "default"} · Secured tiles: {securedTiles} · Hidden built-in
  pages: {hiddenPages}
</p>

{#if settingsSaveFailed()}
  <p class="hint text-danger">Not saved — ioBroker unreachable.</p>
{/if}

<style>
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  .field textarea {
    width: 100%;
    font-family: var(--font-family);
    font-size: var(--body-sm);
  }

  .hint {
    font-size: var(--body-sm);
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: var(--label-mono-size);
    cursor: pointer;
  }
</style>
