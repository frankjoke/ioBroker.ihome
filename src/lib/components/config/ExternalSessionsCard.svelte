<script lang="ts">
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import SchemaSettingsEditor from "$lib/components/settings/SchemaSettingsEditor.svelte";
  import { externalSessionsSchema } from "$lib/config/external-sessions-schema";
  import { externalSessionSettings, parseHostList } from "$lib/config/locality";
  import { isDefaultPin } from "$lib/config/pin.svelte";
  import { BUILTIN_PAGES } from "$lib/config/builtin-pages";
  import {
    getSettings,
    initSettings,
    settingsSaveFailed,
    updateSettings,
  } from "$lib/stores/settings.svelte";
  import { getPageRegistry } from "$lib/stores/pages.svelte";
  import type { PageRegistry } from "$lib/types/display";

  const tabs = [
    {
      id: "settings",
      label: "Settings",
      hint: "Host lists and session policy",
    },
    { id: "help", label: "Help", hint: "What these settings protect" },
  ];
  const initialSession = externalSessionSettings(getSettings().externalSession);
  let values = $state({
    localHosts: initialSession.localHosts,
    externalHosts: initialSession.externalHosts,
    forceExternal: initialSession.forceExternal,
  });
  // svelte-ignore state_referenced_locally
  let initial = JSON.stringify(values);
  let valid = $state(true);
  let error = $state("");
  let saving = $state(false);
  let tab = $state("settings");

  const dirty = $derived(JSON.stringify(values) !== initial);
  const pinSet = $derived(!isDefaultPin(getSettings().pin));
  const securedTiles = $derived(countSecured(getPageRegistry()));
  const hiddenPages = BUILTIN_PAGES.filter(
    (page) => page.secured === true,
  ).length;

  // A late settings read fills an untouched draft; typing is never overwritten.
  $effect(() => {
    const current = externalSessionSettings(getSettings().externalSession);
    const next = {
      localHosts: current.localHosts,
      externalHosts: current.externalHosts,
      forceExternal: current.forceExternal,
    };
    if (JSON.stringify(next) === initial) return;
    if (dirty) return;
    values = next;
    initial = JSON.stringify(next);
  });

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

  async function save(): Promise<void> {
    error = "";
    saving = true;
    try {
      await initSettings();
      const localHosts = parseHostList(values.localHosts.join("\n"));
      const externalHosts = parseHostList(values.externalHosts.join("\n"));
      const both = localHosts.filter((host) => externalHosts.includes(host));
      if (both.length) {
        error = `In both lists: ${both.join(", ")}`;
        return;
      }
      const current = externalSessionSettings(getSettings().externalSession);
      await updateSettings({
        externalSession: {
          ...current,
          localHosts,
          externalHosts,
          forceExternal: values.forceExternal,
        },
      });
      values = {
        localHosts,
        externalHosts,
        forceExternal: values.forceExternal,
      };
      initial = JSON.stringify(values);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
    } finally {
      saving = false;
    }
  }
</script>

<OptionTabs
  bind:value={tab}
  label="External sessions"
  {tabs}
  collapsible={false}
  showHint={false}
/>

{#if tab === "settings"}
  <SchemaSettingsEditor
    schema={externalSessionsSchema}
    bind:values
    bind:valid
  />
  {#if error}
    <p class="hint text-danger">{error}</p>
  {/if}
  {#if settingsSaveFailed()}
    <p class="hint text-danger">Not saved — ioBroker unreachable.</p>
  {/if}
  <button
    type="button"
    class="btn btn-primary btn-sm"
    disabled={!dirty || !valid || saving}
    onclick={() => void save()}>{saving ? "Saving…" : "Save"}</button
  >
{:else}
  <p class="hint text-muted">
    Protections here are visibility, not access control. The boundary is your
    access layer (VPN, reverse-proxy auth, web.0 auth).
  </p>
  <p class="hint text-muted">
    Local hosts always count as local; external hosts always count as external.
    A host may appear in only one list. Hosts are stored without scheme or port.
    "Treat every session as external" hides secured tiles and built-in pages
    everywhere, so use it only behind a proxy that hides the client address.
  </p>
  <p class="hint text-muted">
    PIN: {pinSet ? "set" : "default"} · Secured tiles: {securedTiles} · Hidden built-in
    pages: {hiddenPages}
  </p>
{/if}

<style>
  .hint {
    font-size: var(--body-sm);
    margin: 0.35rem 0 0;
  }
</style>
