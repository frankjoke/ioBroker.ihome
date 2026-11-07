<script lang="ts">
  import { page } from "$app/state";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import CodeTemplates from "$lib/components/templates/CodeTemplates.svelte";
  import TemplateBrowser from "$lib/components/templates/TemplateBrowser.svelte";
  import ImportTemplateModal from "$lib/components/templates/ImportTemplateModal.svelte";
  import { templateKind } from "$lib/config/config-nav";
  import {
    templateGroup,
    type TemplateFile,
    type TemplateKind,
  } from "$lib/config/template-file";
  import { installTemplateFile } from "$lib/template-import";

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
  let importOpen = $state(false);
  let importError = $state("");
  let pendingImport = $state<TemplateFile | null>(null);
  let focus = $state<{ kind: TemplateKind; id: string } | null>(null);

  const codeFocus = $derived(
    focus && (focus.kind === "formula" || focus.kind === "snippet")
      ? {
          kind:
            focus.kind === "formula"
              ? ("formula" as const)
              : ("function" as const),
          id: focus.id,
        }
      : null,
  );
  const templateFocus = $derived(
    focus && focus.kind !== "formula" && focus.kind !== "snippet"
      ? { kind: focus.kind, id: focus.id }
      : null,
  );

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

  function applyFocus(kind: TemplateKind, id: string) {
    const next = templateGroup(kind);
    dirty = false;
    group = next;
    tabValue = next;
    focus = { kind, id };
    importError = "";
  }

  function onImport(file: TemplateFile): string | null {
    if (dirty) {
      pendingImport = file;
      importOpen = false;
      askSwitch = true;
      return null;
    }
    const result = installTemplateFile(file);
    if ("problem" in result) return result.problem;
    applyFocus(file.kind, result.id);
    return null;
  }

  function confirmDiscard() {
    askSwitch = false;
    const file = pendingImport;
    pendingImport = null;
    if (file) {
      const result = installTemplateFile(file);
      if ("problem" in result) {
        importError = result.problem;
        return;
      }
      applyFocus(file.kind, result.id);
      return;
    }
    const next = pendingGroup;
    pendingGroup = null;
    if (next) go(next);
  }

  function cancelDiscard() {
    askSwitch = false;
    pendingGroup = null;
    pendingImport = null;
  }
</script>

<svelte:head>
  <title>Templates - iHome</title>
</svelte:head>

<div class="templates-page">
  <div class="page-heading">
    <h1>Templates</h1>
    <button
      type="button"
      class="btn btn-sm"
      onclick={() => {
        importError = "";
        importOpen = true;
      }}
    >
      <span class="material-symbols-outlined">upload</span> Import
    </button>
  </div>

  {#if importError}
    <p class="text-danger hint">{importError}</p>
  {/if}

  <OptionTabs
    bind:value={tabValue}
    label="Template group"
    {tabs}
    collapsible={false}
    onchange={onTabChange}
  />

  {#if group === "code"}
    <CodeTemplates
      bind:dirty
      focus={codeFocus}
      onFocusApplied={() => (focus = null)}
    />
  {:else}
    <TemplateBrowser
      bind:dirty
      focus={templateFocus}
      onFocusApplied={() => (focus = null)}
    />
  {/if}

  {#if importOpen}
    <ImportTemplateModal {onImport} onClose={() => (importOpen = false)} />
  {/if}

  {#if askSwitch}
    <ConfirmModal
      title="Discard unsaved changes?"
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      onConfirm={confirmDiscard}
      onCancel={cancelDiscard}
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

  .page-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-heading h1 {
    margin: 0;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
