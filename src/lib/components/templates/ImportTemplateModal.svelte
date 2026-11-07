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
    onImport: (file: TemplateFile) => string | null;
    onClose: () => void;
  } = $props();

  let text = $state("");
  let error = $state("");

  async function pick(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    text = await file.text();
    error = "";
  }

  function submit() {
    const parsed = parseTemplateFile(text);
    if ("problem" in parsed) {
      error = parsed.problem;
      return;
    }
    const problem = onImport(parsed.file);
    if (problem) {
      error = problem;
      return;
    }
    onClose();
  }
</script>

<ConfirmModal
  title="Import template"
  confirmLabel="Import"
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
        placeholder={`{"format":"ihome-template", ...}`}
      ></textarea>
    </label>
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
