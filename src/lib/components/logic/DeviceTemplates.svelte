<script lang="ts">
  import { getLogicDocument, commitLogics } from "$lib/stores/logics.svelte";
  import {
    BUILTIN_DEVICE_TEMPLATES,
    evaluateDeviceTemplate,
  } from "$lib/config/device-templates";
  import {
    templateStateSpecs,
    validateDeviceTemplate,
  } from "$logic/device-templates";
  import { validateLogicDocument } from "$logic/validate";
  import {
    planDeviceTemplate,
    createTemplateStates,
  } from "$lib/device-template-apply";
  import { parseDuration } from "$logic/duration";
  import { stateIdFor, validStateId } from "$lib/config/variables";
  import { getVariables } from "$lib/stores/variables.svelte";
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import StateRefField from "./StateRefField.svelte";
  import type { DeviceTemplate, DeviceTemplateShape } from "$logic/types";

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
  let applyOpen = $state(false);
  let evaluated = $state<DeviceTemplateShape | null>(null);
  let applySource = $state("");
  let applyParams = $state<Record<string, string | number | boolean>>({});
  let baseState = $state("");
  let applyError = $state("");
  let applying = $state(false);

  const preview = $derived(
    evaluated ? templateStateSpecs(evaluated, baseState) : [],
  );

  function slug(text: string): string {
    return (
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "device"
    );
  }

  $effect(() => {
    if (!selected) return;
    name = selected.name;
    description = selected.description ?? "";
    source = selected.source;
    error = "";
    deleting = false;
    applyOpen = false;
    evaluated = null;
    applySource = "";
    applyError = "";
    applyParams = {};
    applying = false;
    baseState = `${ioBroker.namespace}.Variables.${slug(selected.name)}`;
  });

  function startApply(): void {
    applyError = "";
    applyOpen = false;
    evaluated = null;
    applySource = "";
    let value: unknown;
    try {
      value = evaluateDeviceTemplate(source);
    } catch (e) {
      applyError = e instanceof Error ? e.message : String(e);
      return;
    }
    const check = validateDeviceTemplate(value);
    if (check.errors.length > 0) {
      applyError = check.errors.join("\n");
      return;
    }
    const shape = check.template!;
    const defaults: Record<string, string | number | boolean> = {};
    for (const param of shape.params ?? []) {
      defaults[param.name] =
        param.default !== undefined
          ? param.default
          : param.type === "boolean"
            ? false
            : param.type === "number"
              ? 0
              : param.type === "duration"
                ? "30s"
                : "";
    }
    evaluated = shape;
    applySource = source;
    applyParams = defaults;
    baseState = `${ioBroker.namespace}.Variables.${slug(selected?.name ?? "device")}`;
    applyOpen = true;
  }

  async function generate(): Promise<void> {
    if (!evaluated || !selected || applying) return;
    applying = true;
    applyError = "";
    try {
      if (!validStateId(baseState)) {
        applyError = "Base state needs adapter.instance.path.";
        return;
      }
      const values = { ...applyParams };
      for (const param of evaluated.params ?? []) {
        if (param.type === "duration") {
          if (parseDuration(String(values[param.name] ?? "")) === null) {
            applyError = `${param.label}: use e.g. 30s, 5m or 1h.`;
            return;
          }
          continue;
        }
        if (param.type !== "state") continue;
        const ref = String(values[param.name] ?? "");
        if (!ref) {
          applyError = `${param.label}: choose a state.`;
          return;
        }
        values[param.name] = stateIdFor(ref, getVariables());
      }
      const suffix = baseState.split(".").pop() ?? "device";
      const base = `${selected.id}-${suffix}`;
      const taken = new Set(doc.logics.map((logic) => logic.id));
      let id = base;
      let index = 2;
      while (taken.has(id)) id = `${base}-${index++}`;
      const plan = planDeviceTemplate(
        evaluated,
        applySource,
        values,
        baseState,
        id,
        selected.name,
      );
      await createTemplateStates(plan.specs, baseState);
      const nextDoc = {
        ...doc,
        logics: [...doc.logics, plan.logic],
      };
      const issues = validateLogicDocument(nextDoc).filter(
        (issue) => issue.severity === "error",
      );
      if (issues.length > 0) {
        applyError = `${issues[0].path}: ${issues[0].message}`;
        return;
      }
      if (!commitLogics(nextDoc)) {
        applyError = "The logic document could not be saved.";
        return;
      }
      onGenerated(plan.logic.id);
      onClose();
    } catch (e) {
      applyError = e instanceof Error ? e.message : String(e);
    } finally {
      applying = false;
    }
  }

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
    if (
      !commitLogics({
        ...doc,
        deviceTemplates: [...(doc.deviceTemplates ?? []), copy],
      })
    ) {
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
                {#each doc.deviceTemplates ?? [] as entry (entry.id)}
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
              readonly={isBuiltin || applyOpen}
              rows="18"
              spellcheck="false"
              aria-label="Template source"
            ></textarea>
          </label>

          {#if error}
            <p class="error text-danger">{error}</p>
          {/if}

          <div class="actions">
            <button
              type="button"
              class="btn btn-primary"
              onclick={startApply}
              disabled={applying}
            >
              Apply
            </button>
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

          {#if applyError && !applyOpen}
            <p class="error text-danger">{applyError}</p>
          {/if}

          {#if applyOpen && evaluated}
            <div class="apply">
              <h4>Apply template</h4>
              <label class="field">
                <span class="label-mono">Base state</span>
                <input
                  type="text"
                  bind:value={baseState}
                  aria-label="Base state"
                />
              </label>
              {#each evaluated.params ?? [] as param (param.name)}
                <label class="field">
                  <span class="label-mono">{param.label}</span>
                  {#if param.type === "state"}
                    <StateRefField
                      value={String(applyParams[param.name] ?? "")}
                      label={param.label}
                      onchange={(ref) =>
                        (applyParams = { ...applyParams, [param.name]: ref })}
                    />
                  {:else if param.type === "boolean"}
                    <input
                      type="checkbox"
                      checked={applyParams[param.name] === true}
                      onchange={(e) =>
                        (applyParams = {
                          ...applyParams,
                          [param.name]: e.currentTarget.checked,
                        })}
                    />
                  {:else if param.type === "number"}
                    <input
                      type="number"
                      value={String(applyParams[param.name] ?? 0)}
                      oninput={(e) =>
                        (applyParams = {
                          ...applyParams,
                          [param.name]: Number(e.currentTarget.value),
                        })}
                    />
                  {:else}
                    <input
                      type="text"
                      value={String(applyParams[param.name] ?? "")}
                      oninput={(e) =>
                        (applyParams = {
                          ...applyParams,
                          [param.name]: e.currentTarget.value,
                        })}
                    />
                  {/if}
                </label>
              {/each}
              <p class="hint text-muted">
                States: {preview
                  .map((spec) => `${spec.id} (${spec.common.type})`)
                  .join(", ")}
              </p>
              {#if applyError}
                <p class="error text-danger">{applyError}</p>
              {/if}
              <div class="actions">
                <button
                  type="button"
                  class="btn btn-primary"
                  onclick={generate}
                  disabled={applying}
                >
                  Generate
                </button>
                <button
                  type="button"
                  class="btn"
                  onclick={() => (applyOpen = false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          {/if}
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

  .apply {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border-top: 1px solid var(--border-color);
    padding-top: 0.6rem;
    margin-top: 0.4rem;
  }

  .apply h4 {
    margin: 0;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.25rem;
  }
</style>
