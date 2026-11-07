<script lang="ts">
  import { page } from "$app/state";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import CodeTemplates from "$lib/components/templates/CodeTemplates.svelte";
  import TemplateBrowser from "$lib/components/templates/TemplateBrowser.svelte";
  import { templateKind } from "$lib/config/config-nav";

  type Group = "code" | "templates";

  const tabs: Array<{ id: Group; label: string; hint: string }> = [
    {
      id: "code",
      label: "Code",
      hint: "Formula and Function snippets used from entry fields.",
    },
    {
      id: "templates",
      label: "Templates",
      hint: "Device, logic, both or API templates.",
    },
  ];

  /** The app is hash-routed, so `?type=` lives inside `page.url.hash`. */
  function requestedGroup(): Group {
    const hash = page.url.hash;
    const hashQuery = hash.includes("?")
      ? hash.slice(hash.indexOf("?") + 1)
      : "";
    const value =
      page.url.searchParams.get("type") ??
      new URLSearchParams(hashQuery).get("type");
    return templateKind(value);
  }

  const initialGroup = requestedGroup();
  let group = $state<Group>(initialGroup);
  let tabValue = $state<Group | null>(initialGroup);
  let dirty = $state(false);
  let pendingGroup = $state<Group | null>(null);
  let askSwitch = $state(false);

  function go(next: Group) {
    dirty = false;
    group = next;
    tabValue = next;
  }

  function onTabChange(next: Group | null) {
    const target = next ?? group;
    if (target === group) {
      tabValue = group;
      return;
    }
    if (dirty) {
      pendingGroup = target;
      askSwitch = true;
      tabValue = group;
      return;
    }
    go(target);
  }
</script>

<svelte:head>
  <title>Templates - iHome</title>
</svelte:head>

<div class="templates-page">
  <div class="page-heading">
    <h1>Templates</h1>
  </div>

  <OptionTabs
    bind:value={tabValue}
    label="Template group"
    {tabs}
    collapsible={false}
    onchange={onTabChange}
  />

  {#if group === "code"}
    <CodeTemplates bind:dirty />
  {:else}
    <TemplateBrowser bind:dirty />
  {/if}

  {#if askSwitch}
    <ConfirmModal
      title="Discard unsaved changes?"
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      onConfirm={() => {
        askSwitch = false;
        const next = pendingGroup;
        pendingGroup = null;
        if (next) go(next);
      }}
      onCancel={() => {
        askSwitch = false;
        pendingGroup = null;
      }}
    />
  {/if}
</div>

<style>
  .templates-page {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    --option-tab-bg: var(--background-color);
  }

  .page-heading h1 {
    margin: 0;
  }
</style>
