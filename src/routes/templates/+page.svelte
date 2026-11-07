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
  let pendingImport = $state<{
    file: TemplateFile;
    name: string;
  } | null>(null);
  let focus = $state<{ kind: TemplateKind; id: string } | null>(null);
  let search = $state("");
  let sortDir = $state<"asc" | "desc">("asc");
  let codeRef = $state<{
    startNew: (kind: "formula" | "function") => void;
  } | null>(null);
  let templateRef = $state<{
    startNew: (kind: "device" | "logic" | "api" | "both") => void;
  } | null>(null);

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
    search = "";
    sortDir = "asc";
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
    go(templateGroup(kind));
    focus = { kind, id };
    importError = "";
  }

  function onImport(file: TemplateFile, name: string): string | null {
    if (dirty) {
      pendingImport = { file, name };
      importOpen = false;
      askSwitch = true;
      return null;
    }
    const result = installTemplateFile(file, name);
    if ("problem" in result) return result.problem;
    applyFocus(file.kind, result.id);
    return null;
  }

  function confirmDiscard() {
    askSwitch = false;
    const pending = pendingImport;
    pendingImport = null;
    if (pending) {
      const result = installTemplateFile(pending.file, pending.name);
      if ("problem" in result) {
        importError = result.problem;
        return;
      }
      applyFocus(pending.file.kind, result.id);
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
    <div class="page-actions">
      {#if group === "code"}
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={() => codeRef?.startNew("formula")}
        >
          <span class="material-symbols-outlined">add</span> Formula
        </button>
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => codeRef?.startNew("function")}
        >
          <span class="material-symbols-outlined">add</span> Function
        </button>
      {:else}
        <button
          type="button"
          class="btn btn-primary btn-sm"
          onclick={() => templateRef?.startNew("device")}
        >
          <span class="material-symbols-outlined">add</span> Device
        </button>
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => templateRef?.startNew("logic")}
        >
          <span class="material-symbols-outlined">add</span> Logic
        </button>
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => templateRef?.startNew("api")}
        >
          <span class="material-symbols-outlined">add</span> API
        </button>
        <button
          type="button"
          class="btn btn-sm"
          onclick={() => templateRef?.startNew("both")}
        >
          <span class="material-symbols-outlined">add</span> Both
        </button>
      {/if}
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
  </div>

  {#if importError}
    <p class="text-danger hint">{importError}</p>
  {/if}

  <div class="list-toolbar">
    <OptionTabs
      bind:value={tabValue}
      label="Template group"
      {tabs}
      collapsible={false}
      onchange={onTabChange}
    />
    <div class="list-filter">
      <input
        type="search"
        placeholder={group === "code"
          ? "Search name or code…"
          : "Search name or part…"}
        bind:value={search}
      />
      <button
        type="button"
        class="sort-dir"
        title="Toggle sort direction"
        aria-label="Toggle sort direction"
        onclick={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
      >
        <span class="material-symbols-outlined"
          >{sortDir === "asc" ? "arrow_upward" : "arrow_downward"}</span
        >
      </button>
    </div>
  </div>

  {#if group === "code"}
    <CodeTemplates
      embedded
      bind:this={codeRef}
      bind:dirty
      bind:search
      bind:sortDir
      focus={codeFocus}
      onFocusApplied={() => (focus = null)}
    />
  {:else}
    <TemplateBrowser
      bind:this={templateRef}
      bind:dirty
      bind:search
      bind:sortDir
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

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .list-toolbar {
    display: flex;
    align-items: flex-end;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .list-filter {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) auto;
    gap: 0.5rem;
    flex: 0 1 20rem;
    margin-left: auto;
  }

  .list-filter input {
    min-width: 0;
    padding: 0.35rem;
  }

  .sort-dir {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: transparent;
    color: var(--text-color);
    cursor: pointer;
  }

  .sort-dir:hover {
    background: var(--surface-container);
  }

  .sort-dir .material-symbols-outlined {
    font-size: 18px;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
