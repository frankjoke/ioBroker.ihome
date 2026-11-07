<script lang="ts">
  import ConfirmModal from "$lib/components/common/ConfirmModal.svelte";
  import {
    parseTemplateFile,
    type TemplateFile,
  } from "$lib/config/template-file";

  let {
    onImport,
    onClose,
  }: {
    onImport: (file: TemplateFile, name: string) => string | null;
    onClose: () => void;
  } = $props();

  let text = $state("");
  let error = $state("");
  let prepared = $state<TemplateFile | null>(null);
  let name = $state("");

  const confirmLabel = $derived(prepared ? "Import" : "Continue");

  function definitionName(file: TemplateFile): string {
    const definition = file.definition as { name?: unknown } | null;
    return typeof definition?.name === "string" ? definition.name : "";
  }

  function prepare() {
    const parsed = parseTemplateFile(text);
    if ("problem" in parsed) {
      error = parsed.problem;
      prepared = null;
      return;
    }
    prepared = parsed.file;
    name = definitionName(parsed.file);
    error = "";
  }

  async function pick(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      text = await file.text();
    } catch {
      error = "The file could not be read.";
      return;
    }
    prepared = null;
    prepare();
  }

  function onTextInput() {
    prepared = null;
    error = "";
  }

  function submit() {
    if (!prepared) {
      prepare();
      return;
    }
    const chosen = name.trim();
    if (!chosen) {
      error = "A name is required.";
      return;
    }
    const problem = onImport(prepared, chosen);
    if (problem) {
      error = problem;
      return;
    }
    onClose();
  }
</script>

<ConfirmModal
  title="Import template"
  {confirmLabel}
  onConfirm={submit}
  onCancel={onClose}
>
  <div class="import-form">
    <label class="field">
      <span class="label-mono">File</span>
      <input type="file" accept=".json,application/json" onchange={pick} />
    </label>
    <label class="field">
      <span class="label-mono">Or paste the file</span>
      <textarea
        rows="8"
        bind:value={text}
        oninput={onTextInput}
        placeholder={`{"format":"ihome-template", ...}`}
      ></textarea>
    </label>
    {#if prepared}
      <label class="field">
        <span class="label-mono">Name</span>
        <input type="text" bind:value={name} oninput={() => (error = "")} />
      </label>
    {/if}
    {#if error}
      <p class="text-danger hint">{error}</p>
    {/if}
  </div>
</ConfirmModal>

<style>
  .import-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: var(--body-sm);
  }

  .hint {
    margin: 0;
    font-size: var(--body-sm);
  }
</style>
