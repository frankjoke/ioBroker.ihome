<script lang="ts">
  import { isRegistryWritable } from "$lib/registry.svelte.js";
  import { newId } from "$lib/utils/ids";
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import { deleteTitle } from "$lib/utils/delete-title";
  import { PRESETS } from "$lib/config/presets";
  import { BUILTIN_BUNDLES } from "$lib/config/builtin-bundles";
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
    isTemplatesWritable,
  } from "$lib/stores/templates.svelte.js";
  import {
    commitLogics,
    getLogicDocument,
    isLogicsWritable,
    logicBlocked,
  } from "$lib/stores/logics.svelte";
  import {
    deleteTemplateBundle,
    getTemplateBundles,
    isTemplateBundlesWritable,
    templateBundleSaveFailed,
    upsertTemplateBundle,
  } from "$lib/stores/template-bundles.svelte";
  import { saveTemplateBundles } from "$lib/template-bundles.svelte.js";
  import { BUILTIN_TEMPLATES } from "$logic/templates";
  import VisualTemplates from "./VisualTemplates.svelte";
  import LogicTemplates from "./LogicTemplates.svelte";
  import LogicDeviceTemplates from "./LogicDeviceTemplates.svelte";
  import BundleEditor from "./BundleEditor.svelte";
  import BundleApplyModal from "./BundleApplyModal.svelte";
  import DeviceApplyModal from "./DeviceApplyModal.svelte";
  import DeviceCreateModal from "./DeviceCreateModal.svelte";
  import LogicApplyModal from "./LogicApplyModal.svelte";
  import HelpSection from "./HelpSection.svelte";
  import { exportTemplate } from "$lib/template-export";
  import type { Template } from "$lib/types/display";
  import type { TemplateBundle } from "$lib/types/templates";
  import type { LogicTemplate } from "$logic/types";

  let {
    dirty = $bindable(false),
    search = $bindable(""),
    sortDir = $bindable<"asc" | "desc">("asc"),
    focus = null,
    onFocusApplied,
  }: {
    dirty?: boolean;
    search?: string;
    sortDir?: "asc" | "desc";
    focus?: {
      kind: "device" | "logic" | "api" | "bundle";
      id: string;
    } | null;
    onFocusApplied?: () => void;
  } = $props();
  let lastFocus = "";

  let selected = $state<TemplateEntry | null>(null);
  let editorDirty = $state(false);
  let editorRef = $state<{
    save: () => void;
    startApply?: () => void;
  } | null>(null);
  let pendingAction: (() => void) | null = null;
  let askSwitch = $state(false);
  let error = $state("");
  let bundleDraft = $state<TemplateBundle | null>(null);
  let deviceApplyTemplate = $state<Template | null>(null);
  let deviceCreateTemplate = $state<Template | null>(null);
  let logicApplyTemplate = $state<LogicTemplate | null>(null);
  let bundleApplyTemplate = $state<TemplateBundle | null>(null);
  let pendingDelete = $state<TemplateEntry | null>(null);

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
      bundleBuiltins: BUILTIN_BUNDLES,
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
  const rows = $derived.by(() => {
    if (!selected) return shown;
    const exists = shown.some(
      (entry) => entry.kind === selected.kind && entry.id === selected.id,
    );
    // Use the current entry (a save may have renamed it); the snapshot is only
    // needed to keep a draft or filtered-out row visible.
    return exists ? shown : [selected, ...shown];
  });
  const bundleSaveFailed = $derived(templateBundleSaveFailed());
  const selectedBundle = $derived(
    selected?.kind === "bundle"
      ? bundleDraft?.id === selected.id
        ? bundleDraft
        : selected.builtin
          ? BUILTIN_BUNDLES.find((bundle) => bundle.id === selected.id)
          : (bundles.find((bundle) => bundle.id === selected.id) ??
            BUILTIN_BUNDLES.find((bundle) => bundle.id === selected.id))
      : undefined,
  );
  const writable = $derived(
    selected?.kind === "device"
      ? isTemplatesWritable()
      : selected?.kind === "bundle"
        ? isTemplateBundlesWritable()
        : isLogicsWritable(),
  );
  const deviceWritable = isRegistryWritable();
  const blocked = $derived(
    selected?.kind === "logic" || selected?.kind === "api"
      ? logicBlocked()
      : selected?.kind === "bundle" &&
          (selectedBundle?.logic || selectedBundle?.api)
        ? logicBlocked()
        : false,
  );
  const applyWritable = $derived.by(() => {
    if (selected?.kind !== "bundle") return writable;
    const needsLogic = !!(selectedBundle?.logic || selectedBundle?.api);
    const needsTemplates = !!selectedBundle?.device;
    return (
      (!needsLogic || isLogicsWritable()) &&
      (!needsTemplates || isTemplatesWritable())
    );
  });

  function isOpen(entry: TemplateEntry) {
    return selected?.kind === entry.kind && selected?.id === entry.id;
  }

  function onLineClick(event: MouseEvent, entry: TemplateEntry) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, label")) return;
    open(entry);
  }

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

  function typeIcon(entry: TemplateEntry): string {
    if (entry.kind === "device") return "devices";
    if (entry.kind === "logic") return "account_tree";
    if (entry.kind === "api") return "api";
    return "layers";
  }

  function definitionFor(entry: TemplateEntry) {
    if (entry.kind === "device") {
      return (
        Object.values(PRESETS).find((template) => template.id === entry.id) ??
        (registry.templates ?? []).find((template) => template.id === entry.id)
      );
    }
    if (entry.kind === "logic") {
      return (
        BUILTIN_TEMPLATES.find((template) => template.id === entry.id) ??
        (doc.templates ?? []).find((template) => template.id === entry.id)
      );
    }
    if (entry.kind === "api") {
      return (
        BUILTIN_DEVICE_TEMPLATES.find((template) => template.id === entry.id) ??
        (doc.deviceTemplates ?? []).find((template) => template.id === entry.id)
      );
    }
    return entry.builtin
      ? BUILTIN_BUNDLES.find((bundle) => bundle.id === entry.id)
      : (bundles.find((bundle) => bundle.id === entry.id) ??
          BUILTIN_BUNDLES.find((bundle) => bundle.id === entry.id));
  }

  function helpFor(entry: TemplateEntry): string | undefined {
    if (entry.kind === "bundle" && bundleDraft?.id === entry.id) {
      return bundleDraft.help;
    }
    return definitionFor(entry)?.help;
  }

  function exportEntry(entry: TemplateEntry) {
    const definition = definitionFor(entry);
    if (!definition) return;
    exportTemplate(entry.kind, $state.snapshot(definition));
  }

  function openDeviceApply(entry: TemplateEntry) {
    const definition = definitionFor(entry);
    if (definition) deviceApplyTemplate = definition as Template;
  }

  function openDeviceCreate(entry: TemplateEntry) {
    const definition = definitionFor(entry);
    if (definition) deviceCreateTemplate = definition as Template;
  }

  function openLogicApply(entry: TemplateEntry) {
    const definition = definitionFor(entry);
    if (definition) logicApplyTemplate = definition as LogicTemplate;
  }

  function openBundleApply(entry: TemplateEntry) {
    if (bundleDraft?.id === entry.id) return;
    const bundle = entry.builtin
      ? BUILTIN_BUNDLES.find((item) => item.id === entry.id)
      : (bundles.find((item) => item.id === entry.id) ??
        BUILTIN_BUNDLES.find((item) => item.id === entry.id));
    if (bundle) bundleApplyTemplate = bundle;
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
    bundleDraft = null;
  }

  function start(entry: TemplateEntry) {
    if (entry.id !== bundleDraft?.id) bundleDraft = null;
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

  $effect(() => {
    if (!focus) {
      lastFocus = "";
      return;
    }
    const key = `${focus.kind}:${focus.id}`;
    if (key === lastFocus) return;
    lastFocus = key;
    const entry = entries.find(
      (item) => item.kind === focus.kind && item.id === focus.id,
    );
    if (!entry) return;
    start(entry);
    onFocusApplied?.();
  });

  function duplicateDevice(id: string) {
    const source = [
      ...Object.values(PRESETS),
      ...(registry.templates ?? []),
    ].find((template) => template.id === id);
    if (!source) return;
    const copy = {
      ...structuredClone($state.snapshot(source)),
      id: newId(),
      name: `${source.name} copy`,
      builtin: false,
      basedOn: source.basedOn ?? source.type,
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

  function newDevice() {
    const source = Object.values(PRESETS)[0];
    if (source) duplicateDevice(source.id);
  }

  function duplicateLogic(id: string) {
    const source = [...BUILTIN_TEMPLATES, ...(doc.templates ?? [])].find(
      (template) => template.id === id,
    );
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

  function newLogic() {
    const source = BUILTIN_TEMPLATES[0];
    if (source) duplicateLogic(source.id);
  }

  function duplicateApi(id: string) {
    const source = [
      ...BUILTIN_DEVICE_TEMPLATES,
      ...(doc.deviceTemplates ?? []),
    ].find((template) => template.id === id);
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

  function newApi() {
    const source = BUILTIN_DEVICE_TEMPLATES[0];
    if (source) duplicateApi(source.id);
  }

  function duplicateBundle(entry: TemplateEntry) {
    const source = entry.builtin
      ? BUILTIN_BUNDLES.find((bundle) => bundle.id === entry.id)
      : (bundles.find((bundle) => bundle.id === entry.id) ??
        BUILTIN_BUNDLES.find((bundle) => bundle.id === entry.id));
    if (!source) return;
    const copy = {
      ...structuredClone($state.snapshot(source)),
      id: newId(),
      name: `${source.name} copy`,
    };
    if (!upsertTemplateBundle(copy)) {
      error = "Combined templates could not be saved.";
      return;
    }
    saveTemplateBundles();
    start({
      id: copy.id,
      name: copy.name,
      kind: "bundle",
      parts: bundleParts(copy),
      builtin: false,
      search: "",
    });
  }

  function duplicateSelected() {
    if (!selected) return;
    if (selected.kind === "device") duplicateDevice(selected.id);
    else if (selected.kind === "logic") duplicateLogic(selected.id);
    else if (selected.kind === "api") duplicateApi(selected.id);
    else if (selected.kind === "bundle") duplicateBundle(selected);
  }

  export function startNew(kind: "device" | "logic" | "api" | "both") {
    guard(() => {
      if (kind === "device") newDevice();
      else if (kind === "logic") newLogic();
      else if (kind === "api") newApi();
      else startBoth();
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
    if (selected?.builtin) return;
    if (BUILTIN_BUNDLES.some((bundle) => bundle.id === next.id)) {
      error = "That id belongs to a built-in template. Duplicate it to edit.";
      return;
    }
    if (!upsertTemplateBundle(next)) {
      error = "Combined templates could not be saved.";
      return;
    }
    saveTemplateBundles();
    bundleDraft = null;
    closeNow();
  }

  function confirmDelete() {
    if (!pendingDelete) return;
    const entry = pendingDelete;
    pendingDelete = null;
    if (entry.builtin) return;
    if (entry.kind === "device") {
      if (
        !commitTemplates({
          ...registry,
          templates: (registry.templates ?? []).filter(
            (template) => template.id !== entry.id,
          ),
        })
      ) {
        error = "The device template document could not be saved.";
        return;
      }
    } else if (entry.kind === "logic") {
      if (
        !commitLogics({
          ...doc,
          templates: (doc.templates ?? []).filter(
            (template) => template.id !== entry.id,
          ),
        })
      ) {
        error = "The logic document could not be saved.";
        return;
      }
      if (logicBlocked()) {
        error = "Not saved — fix the logic errors in the document.";
        return;
      }
    } else if (entry.kind === "api") {
      if (
        !commitLogics({
          ...doc,
          deviceTemplates: (doc.deviceTemplates ?? []).filter(
            (template) => template.id !== entry.id,
          ),
        })
      ) {
        error = "The logic document could not be saved.";
        return;
      }
      if (logicBlocked()) {
        error = "Not saved — fix the logic errors in the document.";
        return;
      }
    } else if (entry.kind === "bundle") {
      if (!deleteTemplateBundle(entry.id)) {
        error = "Combined templates could not be saved.";
        return;
      }
      saveTemplateBundles();
    }
    if (selected?.kind === entry.kind && selected?.id === entry.id) {
      bundleDraft = null;
      closeNow();
    }
  }
</script>

<div class="template-browser">
  {#if error}
    <p class="text-danger hint">{error}</p>
  {/if}
  {#if bundleSaveFailed}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}

  {#if rows.length === 0}
    <div class="card empty-state">
      <p class="text-muted">No templates match the search.</p>
    </div>
  {:else}
    <div class="template-list">
      {#each rows as entry (`${entry.kind}:${entry.id}:${entry.builtin ? "builtin" : "user"}`)}
        <div class="item" class:open={isOpen(entry)}>
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div class="item-line" onclick={(event) => onLineClick(event, entry)}>
            <Icon value={typeIcon(entry)} size={18} />
            <button type="button" class="name" onclick={() => open(entry)}>
              {entry.name}
            </button>
            <span class="badge">{badge(entry)}</span>
            <span class="item-actions">
              {#if isOpen(entry)}
                <IconButton
                  icon="download"
                  label={`Export ${entry.name}`}
                  disabled={!definitionFor(entry)}
                  onclick={() => exportEntry(entry)}
                />
                {#if entry.kind === "api"}
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    disabled={editorDirty || !applyWritable || blocked}
                    onclick={() => editorRef?.startApply?.()}
                  >
                    <span class="material-symbols-outlined">play_arrow</span>
                    Apply
                  </button>
                {:else if entry.kind === "device"}
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    disabled={editorDirty ||
                      !applyWritable ||
                      blocked ||
                      !deviceWritable}
                    onclick={() => openDeviceCreate(entry)}
                  >
                    <span class="material-symbols-outlined">add</span>
                    New device
                  </button>
                  <button
                    type="button"
                    class="btn btn-outline btn-sm"
                    disabled={editorDirty ||
                      !applyWritable ||
                      blocked ||
                      !deviceWritable}
                    onclick={() => openDeviceApply(entry)}
                  >
                    <span class="material-symbols-outlined">play_arrow</span>
                    Apply
                  </button>
                {:else if entry.kind === "logic"}
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    disabled={editorDirty || !applyWritable || blocked}
                    onclick={() => openLogicApply(entry)}
                  >
                    <span class="material-symbols-outlined">play_arrow</span>
                    Apply
                  </button>
                {:else if entry.kind === "bundle"}
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    disabled={editorDirty ||
                      !applyWritable ||
                      blocked ||
                      bundleDraft?.id === entry.id}
                    onclick={() => openBundleApply(entry)}
                  >
                    <span class="material-symbols-outlined">play_arrow</span>
                    Apply
                  </button>
                {/if}
                {#if !entry.builtin}
                  <button
                    type="button"
                    class="btn btn-primary btn-sm"
                    disabled={!editorDirty || !writable || blocked}
                    onclick={() => editorRef?.save()}
                  >
                    <span class="material-symbols-outlined">check</span> Save
                  </button>
                {/if}
                <IconButton
                  icon="content_copy"
                  label={`Duplicate ${entry.name}`}
                  disabled={!writable || blocked}
                  onclick={duplicateSelected}
                />
              {/if}
              {#if entry.builtin}
                <span class="badge">built-in</span>
              {:else}
                <IconButton
                  icon="delete"
                  danger
                  label={`Delete ${entry.name}`}
                  disabled={!writable || blocked}
                  onclick={() => (pendingDelete = entry)}
                />
              {/if}
            </span>
          </div>
          {#if isOpen(entry)}
            <div class="item-editor">
              <HelpSection help={helpFor(entry)} />
              {#if entry.kind === "device"}
                <VisualTemplates
                  bind:this={editorRef}
                  embedded
                  focusId={entry.id}
                  bind:dirty={editorDirty}
                />
              {:else if entry.kind === "logic"}
                <LogicTemplates
                  bind:this={editorRef}
                  embedded
                  focusId={entry.id}
                  bind:dirty={editorDirty}
                />
              {:else if entry.kind === "api"}
                <LogicDeviceTemplates
                  bind:this={editorRef}
                  open={true}
                  embedded
                  focusId={entry.id}
                  bind:dirty={editorDirty}
                  onClose={() => {}}
                  onGenerated={() => {}}
                />
              {:else if entry.kind === "bundle" && selectedBundle}
                <BundleEditor
                  bind:this={editorRef}
                  bundle={selectedBundle}
                  builtin={selected?.builtin ?? false}
                  isNew={bundleDraft?.id === selectedBundle.id}
                  bind:dirty={editorDirty}
                  onSave={saveBundle}
                />
              {:else if entry.kind === "bundle"}
                <p class="text-muted hint">Select a bundle to edit it.</p>
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
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

  {#if deviceCreateTemplate}
    <DeviceCreateModal
      template={deviceCreateTemplate}
      onClose={() => (deviceCreateTemplate = null)}
    />
  {/if}

  {#if deviceApplyTemplate}
    <DeviceApplyModal
      template={deviceApplyTemplate}
      onClose={() => (deviceApplyTemplate = null)}
    />
  {/if}

  {#if logicApplyTemplate}
    <LogicApplyModal
      template={logicApplyTemplate}
      onClose={() => (logicApplyTemplate = null)}
    />
  {/if}

  {#if bundleApplyTemplate}
    <BundleApplyModal
      bundle={bundleApplyTemplate}
      onClose={() => (bundleApplyTemplate = null)}
    />
  {/if}

  {#if pendingDelete}
    <ConfirmModal
      title={deleteTitle("template", pendingDelete.name)}
      confirmLabel="Delete"
      onConfirm={confirmDelete}
      onCancel={() => (pendingDelete = null)}
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

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .template-list {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
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
