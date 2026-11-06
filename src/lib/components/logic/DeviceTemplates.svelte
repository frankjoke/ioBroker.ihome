<script lang="ts">
  import { getLogicDocument, commitLogics } from "$lib/stores/logics.svelte";
  import {
    BUILTIN_DEVICE_TEMPLATES,
    evaluateDeviceTemplate,
  } from "$lib/config/device-templates";
  import { validateDeviceTemplate } from "$logic/device-templates";
  import type { DeviceTemplate } from "$logic/types";

  let {
    open,
    onClose,
    onGenerated,
  }: {
    open: boolean;
    onClose: () => void;
    onGenerated: (logicId: string) => void;
  } = $props();

  const doc = $derived(getLogicDocument());
  const builtinIds = new Set(BUILTIN_DEVICE_TEMPLATES.map((entry) => entry.id));
  let selectedId = $state(BUILTIN_DEVICE_TEMPLATES[0].id);
  const allTemplates = $derived([
    ...BUILTIN_DEVICE_TEMPLATES,
    ...(doc.deviceTemplates ?? []),
  ]);
  const selected = $derived(
    allTemplates.find((entry) => entry.id === selectedId) ??
      BUILTIN_DEVICE_TEMPLATES[0],
  );
  const isBuiltin = $derived(builtinIds.has(selected?.id ?? ""));

  let name = $state("");
  let description = $state("");
  let source = $state("");
  let error = $state("");
  let deleting = $state(false);

  $effect(() => {
    if (!selected) return;
    name = selected.name;
    description = selected.description ?? "";
    source = selected.source;
    error = "";
    deleting = false;
  });

  function uniqueId(base: string): string {
    const taken = new Set(allTemplates.map((entry) => entry.id));
    let id = base;
    let index = 2;
    while (taken.has(id)) id = `${base}-${index++}`;
    return id;
  }

  function duplicate(): void {
    if (!selected) return;
    const copy: DeviceTemplate = {
      id: uniqueId(`${selected.id}-copy`),
      name: `${selected.name} copy`,
      description: selected.description,
      source: selected.source,
    };
    if (!commitLogics({ ...doc, deviceTemplates: [...(doc.deviceTemplates ?? []), copy] })) {
      error = "The logic document could not be saved.";
      return;
    }
    selectedId = copy.id;
  }

  function save(): void {
    if (!selected || isBuiltin) return;
    let value: unknown;
    try {
      value = evaluateDeviceTemplate(source);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      return;
    }
    const check = validateDeviceTemplate(value);
    if (check.errors.length > 0) {
      error = check.errors.join("\n");
      return;
    }
    const entry: DeviceTemplate = {
      id: selected.id,
      name: name.trim() || selected.id,
      description: description.trim() || undefined,
      source,
    };
    const next = [
      ...(doc.deviceTemplates ?? []).filter((item) => item.id !== selected.id),
      entry,
    ];
    if (!commitLogics({ ...doc, deviceTemplates: next })) {
      error = "The logic document could not be saved.";
      return;
    }
    error = "";
  }

  function remove(): void {
    if (!selected || isBuiltin) return;
    if (!deleting) {
      deleting = true;
      return;
    }
    const next = (doc.deviceTemplates ?? []).filter(
      (item) => item.id !== selected.id,
    );
    if (!commitLogics({ ...doc, deviceTemplates: next })) {
      error = "The logic document could not be saved.";
      return;
    }
    selectedId = BUILTIN_DEVICE_TEMPLATES[0].id;
  }
</script>

{#if open}
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Device templates"
  >
    <div class="modal-card card">
      <h3>Device templates</h3>
      <div class="body">
        <label class="field">
          <span class="label-mono">Template</span>
          <select bind:value={selectedId}>
            <optgroup label="Built-in">
              {#each BUILTIN_DEVICE_TEMPLATES as entry (entry.id)}
                <option value={entry.id}>{entry.name}</option>
              {/each}
            </optgroup>
            {#if (doc.deviceTemplates ?? []).length > 0}
              <optgroup label="My templates">
                {#each (doc.deviceTemplates ?? []) as entry (entry.id)}
                  <option value={entry.id}>{entry.name}</option>
                {/each}
              </optgroup>
            {/if}
          </select>
        </label>

        {#if selected}
          <p class="hint text-muted">
            {isBuiltin
              ? "Built-in template — duplicate it to edit."
              : "Generated states and logic are unlinked copies; the template stays for reuse."}
          </p>

          <label class="field">
            <span class="label-mono">Name</span>
            <input
              type="text"
              bind:value={name}
              readonly={isBuiltin}
              aria-label="Template name"
            />
          </label>

          <label class="field">
            <span class="label-mono">Description</span>
            <input
              type="text"
              bind:value={description}
              readonly={isBuiltin}
              aria-label="Template description"
            />
          </label>

          <label class="field">
            <span class="label-mono">Definition (JS object)</span>
            <textarea
              class="source"
              bind:value={source}
              readonly={isBuiltin}
              rows="18"
              spellcheck="false"
              aria-label="Template source"
            ></textarea>
          </label>

          {#if error}
            <p class="error text-danger">{error}</p>
          {/if}

          <div class="actions">
            <button type="button" class="btn" onclick={duplicate}>
              Duplicate
            </button>
            {#if !isBuiltin}
              <button type="button" class="btn btn-primary" onclick={save}>
                Save
              </button>
              <button
                type="button"
                class="btn {deleting ? 'btn-danger' : ''}"
                onclick={remove}
              >
                {deleting ? "Confirm delete" : "Delete"}
              </button>
            {/if}
            <button type="button" class="btn" onclick={onClose}>Close</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .modal {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    padding: 1rem;
  }

  .modal-card {
    width: min(56rem, 96vw);
    max-height: 90vh;
    max-height: 90dvh;
    overflow: auto;
    padding: 1.25rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .modal-card h3 {
    margin: 0;
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .source {
    width: 100%;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.4;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
  }

  .error {
    margin: 0;
    white-space: pre-wrap;
    font-size: var(--body-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.25rem;
  }
</style>
