<script lang="ts">
  import { newId } from "$lib/utils/ids";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { PRESETS } from "$lib/config/presets";
  import { BUILTIN_DEVICE_TEMPLATES } from "$lib/config/device-templates";
  import {
    bundleParts,
    filterTemplateEntries,
    templateEntries,
    type TemplateEntry,
  } from "$lib/config/template-entries";
  import {
    commitTemplates,
    getTemplateRegistry,
  } from "$lib/stores/templates.svelte.js";
  import {
    commitLogics,
    getLogicDocument,
    logicBlocked,
  } from "$lib/stores/logics.svelte";
  import {
    deleteTemplateBundle,
    getTemplateBundles,
    upsertTemplateBundle,
  } from "$lib/stores/template-bundles.svelte";
  import { saveTemplateBundles } from "$lib/template-bundles.svelte.js";
  import { BUILTIN_TEMPLATES } from "$logic/templates";
  import VisualTemplates from "./VisualTemplates.svelte";
  import LogicTemplates from "./LogicTemplates.svelte";
  import LogicDeviceTemplates from "./LogicDeviceTemplates.svelte";
  import BundleEditor from "./BundleEditor.svelte";
  import type { TemplateBundle } from "$lib/types/templates";

  let { dirty = $bindable(false) }: { dirty?: boolean } = $props();

  let search = $state("");
  let sortDir = $state<"asc" | "desc">("asc");
  let selected = $state<TemplateEntry | null>(null);
  let editorDirty = $state(false);
  let pendingAction: (() => void) | null = null;
  let askSwitch = $state(false);
  let error = $state("");
  let bundleDraft = $state<TemplateBundle | null>(null);
  let pendingBundleDelete = $state<TemplateBundle | null>(null);

  const registry = $derived(getTemplateRegistry());
  const doc = $derived(getLogicDocument());
  const bundles = $derived(getTemplateBundles());
  const entries = $derived([
    ...templateEntries({
      presets: Object.values(PRESETS),
      visual: registry.templates ?? [],
      logicBuiltins: BUILTIN_TEMPLATES,
      logicUser: doc.templates ?? [],
      apiBuiltins: BUILTIN_DEVICE_TEMPLATES,
      apiUser: doc.deviceTemplates ?? [],
      bundleBuiltins: [],
      bundleUser: bundles,
    }),
    ...(bundleDraft
      ? [
          {
            id: bundleDraft.id,
            name: bundleDraft.name || "New template",
            kind: "bundle" as const,
            parts: bundleParts(bundleDraft),
            builtin: false,
            search: (bundleDraft.name || "New template").toLowerCase(),
          },
        ]
      : []),
  ]);
  const shown = $derived(filterTemplateEntries(entries, search, sortDir));
  const selectedBundle = $derived(
    selected?.kind === "bundle"
      ? bundleDraft?.id === selected.id
        ? bundleDraft
        : bundles.find((bundle) => bundle.id === selected.id)
      : undefined,
  );

  $effect(() => {
    dirty = editorDirty;
  });

  function badge(entry: TemplateEntry): string {
    if (entry.kind === "api") return "Logic + Device (API)";
    if (entry.kind === "bundle") {
      return (
        entry.parts
          .map((part) =>
            part === "device" ? "Device" : part === "logic" ? "Logic" : "API",
          )
          .join(" + ") || "Bundle"
      );
    }
    return entry.kind === "device" ? "Device" : "Logic";
  }

  function guard(action: () => void) {
    if (editorDirty) {
      pendingAction = action;
      askSwitch = true;
      return;
    }
    action();
  }

  function closeNow() {
    selected = null;
    editorDirty = false;
  }

  function start(entry: TemplateEntry) {
    selected = entry;
    editorDirty = false;
    error = "";
  }

  function open(entry: TemplateEntry) {
    if (selected?.id === entry.id && selected?.kind === entry.kind) {
      guard(closeNow);
      return;
    }
    guard(() => start(entry));
  }

  function newDevice() {
    const source = Object.values(PRESETS)[0];
    if (!source) return;
    const copy = {
      ...structuredClone($state.snapshot(source)),
      id: newId(),
      name: `${source.name} copy`,
      builtin: false,
      basedOn: source.type,
    };
    if (
      !commitTemplates({
        ...registry,
        templates: [...(registry.templates ?? []), copy],
      })
    ) {
      error = "The device template document could not be saved.";
      return;
    }
    start({
      id: copy.id,
      name: copy.name,
      kind: "device",
      parts: ["device"],
      builtin: false,
      search: "",
    });
  }

  function newLogic() {
    const source = BUILTIN_TEMPLATES[0];
    if (!source) return;
    const copy = {
      ...structuredClone($state.snapshot(source)),
      id: newId(),
      name: `${source.name} copy`,
    };
    if (
      !commitLogics({ ...doc, templates: [...(doc.templates ?? []), copy] })
    ) {
      error = "The logic document could not be saved.";
      return;
    }
    if (logicBlocked()) {
      error = "Not saved — fix the logic errors in the document.";
      return;
    }
    start({
      id: copy.id,
      name: copy.name,
      kind: "logic",
      parts: ["logic"],
      builtin: false,
      search: "",
    });
  }

  function newApi() {
    const source = BUILTIN_DEVICE_TEMPLATES[0];
    if (!source) return;
    const copy = {
      ...structuredClone($state.snapshot(source)),
      id: newId(),
      name: `${source.name} copy`,
    };
    if (
      !commitLogics({
        ...doc,
        deviceTemplates: [...(doc.deviceTemplates ?? []), copy],
      })
    ) {
      error = "The logic document could not be saved.";
      return;
    }
    if (logicBlocked()) {
      error = "Not saved — fix the logic errors in the document.";
      return;
    }
    start({
      id: copy.id,
      name: copy.name,
      kind: "api",
      parts: ["logic", "api"],
      builtin: false,
      search: "",
    });
  }

  function startBoth() {
    const draft: TemplateBundle = {
      id: newId(),
      name: "",
      description: "",
      params: [],
      items: [],
      device: { type: "Custom", features: [], slots: [] },
      logic: {
        logic: {
          id: "",
          name: "",
          kind: "function",
          inputs: {},
          output: { scope: "memory" },
          expr: { code: "noop()" },
        },
      },
    };
    bundleDraft = draft;
    start({
      id: draft.id,
      name: "New template",
      kind: "bundle",
      parts: ["device", "logic"],
      builtin: false,
      search: "new template",
    });
  }

  function saveBundle(next: TemplateBundle) {
    upsertTemplateBundle(next);
    saveTemplateBundles();
    bundleDraft = null;
    closeNow();
  }

  function deleteBundle() {
    if (!pendingBundleDelete) return;
    deleteTemplateBundle(pendingBundleDelete.id);
    saveTemplateBundles();
    if (selectedBundle?.id === pendingBundleDelete.id) {
      bundleDraft = null;
      closeNow();
    }
    pendingBundleDelete = null;
  }
</script>

<div class="template-browser">
  <div class="page-header">
    <div class="page-heading">
      <h2>Templates</h2>
      <p class="text-muted hint">
        Applyable templates: a device, a logic, both, or an API logic + device.
      </p>
    </div>
    <div class="page-actions">
      <button
        type="button"
        class="btn btn-primary btn-sm"
        onclick={() => guard(newDevice)}
      >
        <span class="material-symbols-outlined">add</span> Device
      </button>
      <button type="button" class="btn btn-sm" onclick={() => guard(newLogic)}>
        <span class="material-symbols-outlined">add</span> Logic
      </button>
      <button type="button" class="btn btn-sm" onclick={() => guard(newApi)}>
        <span class="material-symbols-outlined">add</span> API
      </button>
      <button type="button" class="btn btn-sm" onclick={() => guard(startBoth)}>
        <span class="material-symbols-outlined">add</span> Both
      </button>
    </div>
  </div>

  {#if error}
    <p class="text-danger hint">{error}</p>
  {/if}

  <div class="filter-bar">
    <input
      type="search"
      placeholder="Search name or part…"
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

  {#if shown.length === 0}
    <div class="card empty-state">
      <p class="text-muted">No templates match the search.</p>
    </div>
  {:else}
    <div class="template-list">
      {#each shown as entry (`${entry.kind}:${entry.id}`)}
        <button
          type="button"
          class="item-line row"
          class:active={selected?.kind === entry.kind &&
            selected?.id === entry.id}
          onclick={() => open(entry)}
        >
          <span class="name">{entry.name}</span>
          <span class="badge">{badge(entry)}</span>
          {#if entry.builtin}
            <span class="badge">built-in</span>
          {/if}
        </button>
      {/each}
    </div>
  {/if}

  {#if selected?.kind === "device"}
    <VisualTemplates embedded focusId={selected.id} bind:dirty={editorDirty} />
  {:else if selected?.kind === "logic"}
    <LogicTemplates embedded focusId={selected.id} bind:dirty={editorDirty} />
  {:else if selected?.kind === "api"}
    <LogicDeviceTemplates
      open={true}
      embedded
      focusId={selected.id}
      bind:dirty={editorDirty}
      onClose={() => {}}
      onGenerated={() => {}}
    />
  {:else if selected?.kind === "bundle" && selectedBundle}
    <BundleEditor
      bundle={selectedBundle}
      isNew={bundleDraft?.id === selectedBundle.id}
      bind:dirty={editorDirty}
      onSave={saveBundle}
      onDelete={() => (pendingBundleDelete = selectedBundle)}
    />
  {:else if selected?.kind === "bundle"}
    <p class="text-muted hint">Select a bundle to edit it.</p>
  {/if}

  {#if askSwitch}
    <ConfirmModal
      title="Discard unsaved changes?"
      confirmLabel="Discard"
      cancelLabel="Keep editing"
      onConfirm={() => {
        askSwitch = false;
        editorDirty = false;
        const action = pendingAction;
        pendingAction = null;
        action?.();
      }}
      onCancel={() => {
        askSwitch = false;
        pendingAction = null;
      }}
    />
  {/if}

  {#if pendingBundleDelete}
    <ConfirmModal
      title={deleteTitle("template", pendingBundleDelete.name)}
      confirmLabel="Delete"
      onConfirm={deleteBundle}
      onCancel={() => (pendingBundleDelete = null)}
    >
      <p>Applied copies keep their logic and device.</p>
    </ConfirmModal>
  {/if}
</div>

<style>
  .template-browser {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    max-width: 720px;
    margin: 0 auto;
    width: 100%;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    flex: 1 1 14rem;
    min-width: 0;
  }

  .page-heading h2 {
    margin: 0;
  }

  .page-actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .filter-bar {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 0.5rem;
  }

  .filter-bar input {
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

  .template-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .row {
    width: 100%;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-color, #fff);
    color: var(--text-color);
    cursor: pointer;
    text-align: left;
    padding: 0.4rem 0.55rem;
  }

  .row.active {
    border-color: var(--primary-color);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .badge {
    font-size: var(--body-sm);
    color: var(--text-muted);
    border: 1px solid var(--border-color);
    border-radius: 999px;
    padding: 0 0.4rem;
    white-space: nowrap;
  }

  .empty-state {
    padding: 2rem;
    text-align: center;
  }
</style>
