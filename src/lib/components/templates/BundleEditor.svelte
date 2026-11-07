<script lang="ts">
  import { tick } from "svelte";
  import { PRESETS } from "$lib/config/presets";
  import {
    devicePartFromTemplate,
    logicPartFromTemplate,
    templateBundleProblem,
  } from "$lib/config/template-bundles";
  import { insertAtCaret } from "$lib/components/logic/code-field";
  import IconButton from "$lib/components/common/IconButton.svelte";
  import SnippetInput from "$lib/components/templates/SnippetInput.svelte";
  import SnippetSelect from "$lib/components/templates/SnippetSelect.svelte";
  import {
    getTemplateBundles,
    isTemplateBundlesWritable,
    templateBundleSaveFailed,
  } from "$lib/stores/template-bundles.svelte";
  import { getTemplateRegistry } from "$lib/stores/templates.svelte.js";
  import { getLogicDocument } from "$lib/stores/logics.svelte";
  import { BUILTIN_TEMPLATES } from "$logic/templates";
  import type { LogicTemplate } from "$logic/types";
  import type { Template } from "$lib/types/display";
  import type {
    TemplateBundle,
    TemplateItem,
    TemplateParameter,
  } from "$lib/types/templates";

  let {
    bundle,
    builtin = false,
    isNew = false,
    dirty = $bindable(false),
    onSave,
  }: {
    bundle: TemplateBundle;
    builtin?: boolean;
    isNew?: boolean;
    dirty?: boolean;
    onSave: (bundle: TemplateBundle) => void;
  } = $props();

  // svelte-ignore state_referenced_locally
  let draft = $state<TemplateBundle>(structuredClone($state.snapshot(bundle)));
  let deviceJson = $state("");
  let logicJson = $state("");
  let loadedDevice = "";
  let loadedLogic = "";
  let saveError = $state("");

  let apiEl = $state<HTMLTextAreaElement>();
  let apiStart = 0;
  let apiEnd = 0;
  let apiFocused = false;

  const writable = $derived(isTemplateBundlesWritable());
  const saveFailed = $derived(templateBundleSaveFailed());
  const deviceChoices = $derived([
    ...Object.values(PRESETS),
    ...(getTemplateRegistry().templates ?? []),
  ]);
  const logicChoices = $derived([
    ...BUILTIN_TEMPLATES,
    ...(getLogicDocument().templates ?? []),
  ]);
  const bundleIds = $derived(getTemplateBundles().map((entry) => entry.id));
  const logicIds = $derived(getLogicDocument().logics.map((logic) => logic.id));
  const problem = $derived(
    templateBundleProblem(draft, bundleIds, logicIds, bundle.id, {
      validateApi: false,
      evaluateConversions: false,
    }),
  );
  const isDirty = $derived(
    isNew ||
      JSON.stringify(draft) !== JSON.stringify(bundle) ||
      deviceJson !==
        (draft.device ? JSON.stringify(draft.device, null, 2) : "") ||
      logicJson !== (draft.logic ? JSON.stringify(draft.logic, null, 2) : ""),
  );

  $effect(() => {
    if (draft.id !== bundle.id) {
      draft = structuredClone($state.snapshot(bundle));
      saveError = "";
    }
  });
  $effect(() => {
    const next = draft.device ? JSON.stringify(draft.device, null, 2) : "";
    if (next !== loadedDevice) {
      deviceJson = next;
      loadedDevice = next;
    }
  });
  $effect(() => {
    const next = draft.logic ? JSON.stringify(draft.logic, null, 2) : "";
    if (next !== loadedLogic) {
      logicJson = next;
      loadedLogic = next;
    }
  });
  $effect(() => {
    dirty = isDirty;
  });

  function rememberApi() {
    if (!apiEl) return;
    apiFocused = document.activeElement === apiEl;
    apiStart = apiEl.selectionStart;
    apiEnd = apiEl.selectionEnd;
  }

  async function insertApi(code: string) {
    if (!draft.api) return;
    const [from, to] = apiFocused
      ? [apiStart, apiEnd]
      : [draft.api.source.length, draft.api.source.length];
    const next = insertAtCaret(draft.api.source, from, to, code);
    draft.api.source = next.text;
    await tick();
    apiEl?.focus();
    apiEl?.setSelectionRange(next.caret, next.caret);
    apiStart = next.caret;
    apiEnd = next.caret;
    apiFocused = true;
  }

  function setItemSource(item: TemplateItem, value: string) {
    if (value.trim().startsWith("[")) {
      try {
        item.source = JSON.parse(value);
        return;
      } catch {
        // keep the raw text below
      }
    }
    item.source = value;
  }

  function setParamDefault(param: TemplateParameter, value: string) {
    if (value === "") {
      param.default = undefined;
      return;
    }
    if (param.type === "number") param.default = Number(value);
    else if (param.type === "boolean") param.default = value === "true";
    else param.default = value;
  }

  function addParam() {
    draft.params = [
      ...(draft.params ?? []),
      { name: "", label: "", type: "string" },
    ];
  }

  function removeParam(index: number) {
    draft.params = (draft.params ?? []).filter((_, i) => i !== index);
  }

  function addItem() {
    draft.items = [...(draft.items ?? []), { name: "", type: "number" }];
  }

  function removeItem(index: number) {
    draft.items = (draft.items ?? []).filter((_, i) => i !== index);
  }

  function pickDevice(event: Event) {
    const id = (event.currentTarget as HTMLSelectElement).value;
    const template = deviceChoices.find((entry) => entry.id === id);
    if (!template) return;
    draft.device = devicePartFromTemplate($state.snapshot(template));
  }

  function pickLogic(event: Event) {
    const id = (event.currentTarget as HTMLSelectElement).value;
    const template = logicChoices.find((entry) => entry.id === id);
    if (!template) return;
    draft.logic = logicPartFromTemplate($state.snapshot(template));
  }

  function addApi() {
    draft.api = { source: "({})" };
  }

  export function save() {
    saveError = "";
    if (!writable) return;
    const next = structuredClone($state.snapshot(draft));
    try {
      next.device = deviceJson.trim() ? JSON.parse(deviceJson) : undefined;
    } catch (e) {
      saveError = `Device part: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    try {
      next.logic = logicJson.trim() ? JSON.parse(logicJson) : undefined;
    } catch (e) {
      saveError = `Logic part: ${e instanceof Error ? e.message : String(e)}`;
      return;
    }
    const check = templateBundleProblem(next, bundleIds, logicIds, bundle.id);
    if (check) {
      saveError = check;
      return;
    }
    onSave(next);
  }
</script>

<div class="bundle-editor">
  <label class="field"
    ><span class="label-mono">Name</span>
    <input type="text" bind:value={draft.name} readonly={builtin} /></label
  >
  <label class="field"
    ><span class="label-mono">Description</span>
    <input
      type="text"
      bind:value={draft.description}
      readonly={builtin}
    /></label
  >

  {#if !writable}
    <p class="text-danger hint">
      Combined templates could not be loaded — saving is disabled.
    </p>
  {:else if saveFailed}
    <p class="text-danger hint">Not saved — ioBroker unreachable.</p>
  {/if}

  <section class="section">
    <div class="section-head">
      <h4>Params</h4>
      {#if !builtin}
        <button type="button" class="btn btn-sm" onclick={addParam}>
          <span class="material-symbols-outlined">add</span> Add param
        </button>
      {/if}
    </div>
    {#each draft.params ?? [] as param, index (index)}
      <div class="param-card">
        <div class="row-grid">
          <label class="field"
            ><span class="label-mono">Name</span>
            <input
              type="text"
              bind:value={param.name}
              readonly={builtin}
            /></label
          >
          <label class="field"
            ><span class="label-mono">Label</span>
            <input
              type="text"
              bind:value={param.label}
              readonly={builtin}
            /></label
          >
          <label class="field"
            ><span class="label-mono">Type</span>
            <select bind:value={param.type} disabled={builtin}>
              <option value="string">string</option>
              <option value="state">state</option>
              <option value="memory">memory</option>
              <option value="number">number</option>
              <option value="boolean">boolean</option>
              <option value="duration">duration</option>
            </select></label
          >
          <label class="field"
            ><span class="label-mono">Default</span>
            <input
              value={param.default === undefined ? "" : String(param.default)}
              readonly={builtin}
              oninput={(e) => setParamDefault(param, e.currentTarget.value)}
            /></label
          >
        </div>
        <label class="field"
          ><span class="label-mono">Description</span>
          <input
            type="text"
            bind:value={param.description}
            readonly={builtin}
          /></label
        >
        {#if !builtin}
          <IconButton
            icon="delete"
            label="Remove parameter"
            onclick={() => removeParam(index)}
          />
        {/if}
      </div>
    {/each}
  </section>

  <section class="section">
    <div class="section-head">
      <h4>Items</h4>
      {#if !builtin}
        <button type="button" class="btn btn-sm" onclick={addItem}>
          <span class="material-symbols-outlined">add</span> Add item
        </button>
      {/if}
    </div>
    {#each draft.items ?? [] as item, index (index)}
      <div class="item-card">
        <div class="row-grid">
          <label class="field"
            ><span class="label-mono">Name</span>
            <input
              type="text"
              bind:value={item.name}
              readonly={builtin}
            /></label
          >
          <label class="field"
            ><span class="label-mono">Label</span>
            <input
              type="text"
              bind:value={item.label}
              readonly={builtin}
            /></label
          >
          <label class="field"
            ><span class="label-mono">Type</span>
            <select bind:value={item.type} disabled={builtin}>
              <option value="boolean">boolean</option>
              <option value="number">number</option>
              <option value="string">string</option>
              <option value="object">object</option>
            </select></label
          >
          <label class="field"
            ><span class="label-mono">Role</span>
            <input
              type="text"
              bind:value={item.role}
              readonly={builtin}
            /></label
          >
          <label class="field"
            ><span class="label-mono">Unit</span>
            <input
              type="text"
              bind:value={item.unit}
              readonly={builtin}
            /></label
          >
          <label class="field"
            ><span class="label-mono">Feature</span>
            <input
              type="text"
              bind:value={item.feature}
              readonly={builtin}
            /></label
          >
          <label class="field"
            ><span class="label-mono">Source</span>
            <input
              value={Array.isArray(item.source)
                ? JSON.stringify(item.source)
                : (item.source ?? "")}
              readonly={builtin}
              oninput={(e) => setItemSource(item, e.currentTarget.value)}
            /></label
          >
          <label class="field"
            ><span class="label-mono">Decimals</span>
            <input
              type="number"
              min="0"
              max="100"
              value={item.decimals ?? ""}
              readonly={builtin}
              oninput={(e) =>
                (item.decimals =
                  e.currentTarget.value === ""
                    ? undefined
                    : Number(e.currentTarget.value))}
            /></label
          >
        </div>
        <div class="row-checks">
          <label class="check"
            ><input
              type="checkbox"
              checked={item.readOnly === true}
              disabled={builtin}
              onchange={(e) =>
                (item.readOnly = e.currentTarget.checked || undefined)}
            /> read only</label
          >
          <label class="check"
            ><input
              type="checkbox"
              checked={item.hidden === true}
              disabled={builtin}
              onchange={(e) =>
                (item.hidden = e.currentTarget.checked || undefined)}
            /> hidden</label
          >
        </div>
        <div class="row-grid">
          <div class="field">
            <span class="label-mono">Conversion</span>
            <SnippetInput
              value={item.conversion ?? ""}
              onchange={(value) => (item.conversion = value)}
              label="Conversion"
              readonly={builtin}
            />
          </div>
          <div class="field">
            <span class="label-mono">Set conversion</span>
            <SnippetInput
              value={item.setConversion ?? ""}
              onchange={(value) => (item.setConversion = value)}
              label="Set conversion"
              readonly={builtin}
            />
          </div>
        </div>
        {#if !builtin}
          <div class="row-actions">
            <IconButton
              icon="delete"
              label="Remove item"
              onclick={() => removeItem(index)}
            />
          </div>
        {/if}
      </div>
    {/each}
  </section>

  <section class="section">
    <div class="section-head">
      <h4>Device part</h4>
      {#if !builtin}
        <button
          type="button"
          class="btn btn-sm"
          onclick={() =>
            (draft.device = { type: "Custom", features: [], slots: [] })}
        >
          <span class="material-symbols-outlined">add</span> Add device part
        </button>
      {/if}
    </div>
    <div class="row-grid">
      <label class="field"
        ><span class="label-mono">Start from</span>
        <select value="" onchange={pickDevice} disabled={builtin}>
          <option value="">— choose —</option>
          {#each deviceChoices as template (template.id)}
            <option value={template.id}>{template.name}</option>
          {/each}
        </select></label
      >
      {#if draft.device && !builtin}
        <IconButton
          icon="close"
          label="Clear device part"
          onclick={() => (draft.device = undefined)}
        />
      {/if}
    </div>
    <textarea
      class="json"
      rows="10"
      spellcheck="false"
      readonly={builtin}
      bind:value={deviceJson}
      aria-label="Device part JSON"
    ></textarea>
  </section>

  <section class="section">
    <div class="section-head">
      <h4>Logic part</h4>
      {#if !builtin}
        <button
          type="button"
          class="btn btn-sm"
          onclick={() =>
            (draft.logic = {
              logic: {
                id: draft.id,
                name: draft.name || "Logic",
                kind: "function",
                inputs: {},
                output: { scope: "memory" },
                expr: { code: "noop()" },
              },
            })}
        >
          <span class="material-symbols-outlined">add</span> Add logic part
        </button>
      {/if}
    </div>
    <div class="row-grid">
      <label class="field"
        ><span class="label-mono">Start from</span>
        <select value="" onchange={pickLogic} disabled={builtin}>
          <option value="">— choose —</option>
          {#each logicChoices as template (template.id)}
            <option value={template.id}>{template.name}</option>
          {/each}
        </select></label
      >
      {#if draft.logic && !builtin}
        <IconButton
          icon="close"
          label="Clear logic part"
          onclick={() => (draft.logic = undefined)}
        />
      {/if}
    </div>
    <textarea
      class="json"
      rows="10"
      spellcheck="false"
      readonly={builtin}
      bind:value={logicJson}
      aria-label="Logic part JSON"
    ></textarea>
  </section>

  <section class="section">
    <div class="section-head">
      <h4>API part</h4>
      {#if !builtin}
        <button type="button" class="btn btn-sm" onclick={addApi}>
          <span class="material-symbols-outlined">add</span> Add API part
        </button>
      {/if}
    </div>
    {#if draft.api}
      {#if !builtin}
        <div class="row-actions">
          <SnippetSelect
            mode="both"
            onBeforeOpen={rememberApi}
            onInsert={insertApi}
          />
          <IconButton
            icon="close"
            label="Clear API part"
            onclick={() => (draft.api = undefined)}
          />
        </div>
      {/if}
      <textarea
        class="json"
        rows="10"
        spellcheck="false"
        readonly={builtin}
        bind:this={apiEl}
        bind:value={draft.api.source}
        aria-label="API source"
        onmousedown={rememberApi}
        onselect={rememberApi}
        onkeyup={rememberApi}
        onclick={rememberApi}
      ></textarea>
    {/if}
  </section>

  {#if saveError || problem}
    <p class="text-danger hint">{saveError || problem}</p>
  {/if}
</div>

<style>
  .bundle-editor {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }

  .section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border-top: 1px solid var(--border-color);
    padding-top: 0.5rem;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .section-head h4 {
    margin: 0;
  }

  .param-card,
  .item-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    padding: 0.5rem;
  }

  .row-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: 0.5rem;
    align-items: end;
  }

  .row-checks,
  .row-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .check {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: var(--body-sm);
  }

  .json {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    line-height: 1.4;
    tab-size: 2;
    white-space: pre;
    overflow: auto;
  }
</style>
