<script lang="ts">
  import { page } from "$app/state";
  import OptionTabs from "$lib/components/common/OptionTabs.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import CodeTemplates from "$lib/components/templates/CodeTemplates.svelte";
  import TemplateBrowser from "$lib/components/templates/TemplateBrowser.svelte";
  import ImportTemplateModal from "$lib/components/templates/ImportTemplateModal.svelte";
  import HelpSection from "$lib/components/templates/HelpSection.svelte";
  import { templateKind } from "$lib/config/config-nav";
  import { TEMPLATES_GUIDE } from "$lib/config/page-guides";
  import {
    templateGroup,
    type TemplateFile,
    type TemplateKind,
  } from "$lib/config/template-file";
  import { installTemplateFile } from "$lib/template-import";

  type Group = "code" | "templates" | "help";

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
    {
      id: "help",
      label: "Help",
      hint: "About the Templates page.",
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
  <div class="item">
    <div class="item-line title-line">
      <div class="tabs-line">
        <OptionTabs
          bind:value={tabValue}
          label="Template group"
          {tabs}
          collapsible={false}
          onchange={onTabChange}
        />
      </div>
      {#if group !== "help"}
        <div class="page-actions">
          {#if group === "code"}
            <button
              type="button"
              class="btn btn-primary btn-sm"
              onclick={() => codeRef?.startNew("formula")}
            >
              + Formula
            </button>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={() => codeRef?.startNew("function")}
            >
              + Function
            </button>
          {:else}
            <button
              type="button"
              class="btn btn-primary btn-sm"
              onclick={() => templateRef?.startNew("device")}
            >
              + Device
            </button>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={() => templateRef?.startNew("logic")}
            >
              + Logic
            </button>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={() => templateRef?.startNew("api")}
            >
              + API
            </button>
            <button
              type="button"
              class="btn btn-outline btn-sm"
              onclick={() => templateRef?.startNew("both")}
            >
              + Both
            </button>
          {/if}
          <IconButton
            icon="upload"
            label="Import template"
            title="Import"
            onclick={() => {
              importError = "";
              importOpen = true;
            }}
          />
        </div>
      {/if}
    </div>
  </div>

  {#if importError}
    <p class="text-danger hint">{importError}</p>
  {/if}

  {#if group === "help"}
    <div class="card help-panel">
      <HelpSection help={TEMPLATES_GUIDE} static plain />
    </div>
  {:else}
    <div class="list-toolbar">
      <div class="list-filter">
        <span class="label-mono filter-label">Filters</span>
        <input
          type="search"
          placeholder={group === "code"
            ? "Search name or code…"
            : "Search name or part…"}
          bind:value={search}
        />
        <button
          type="button"
          class="btn btn-outline btn-sm"
          title="Sort by name"
          aria-label={`Sort by name ${sortDir === "asc" ? "descending" : "ascending"}`}
          onclick={() => (sortDir = sortDir === "asc" ? "desc" : "asc")}
        >
          Sort {sortDir === "asc" ? "↑" : "↓"}
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
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
    --option-tab-bg: var(--background-color);
  }

  .title-line {
    cursor: default;
  }

  .tabs-line {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-left: auto;
  }

  .help-panel {
    padding: 1rem;
  }

  .list-toolbar {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .list-filter {
    display: grid;
    grid-template-columns: minmax(10rem, 1fr) auto;
    gap: 0.35rem 0.5rem;
  }

  .filter-label {
    grid-column: 1 / -1;
  }

  .list-filter input {
    min-width: 0;
    padding: 0.35rem;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
