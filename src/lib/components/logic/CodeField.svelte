<script lang="ts">
  import { tick } from "svelte";
  import { checkExpression } from "$logic/expr-code";
  import type { LogicDef } from "$logic/types";
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";
  import { insertAtCaret } from "./code-field";

  let {
    code,
    onchange,
    label,
    placeholder,
    minRows = 2,
    allowNoop = false,
    logics = [],
  }: {
    code: string;
    onchange: (code: string) => void;
    label: string;
    placeholder?: string;
    minRows?: number;
    allowNoop?: boolean;
    /** The document's logics, for the picker's Logic tab. */
    logics?: LogicDef[];
  } = $props();

  let textarea = $state<HTMLTextAreaElement>();
  let picking = $state(false);
  /** The caret to insert at: captured before the picker takes focus. */
  let start = $state(0);
  let end = $state(0);

  const problem = $derived(checkExpression(code));

  function rememberSelection() {
    if (!textarea) return;
    start = textarea.selectionStart;
    end = textarea.selectionEnd;
  }

  async function insertState(id: string) {
    picking = false;
    const next = insertAtCaret(code, start, end, `get(${JSON.stringify(id)})`);
    onchange(next.text);
    await tick();
    textarea?.focus();
    textarea?.setSelectionRange(next.caret, next.caret);
    start = next.caret;
    end = next.caret;
  }
</script>

<div class="code-field">
  <div class="code-head">
    <button
      type="button"
      class="btn btn-sm"
      title="Insert a state reference at the caret"
      onmousedown={rememberSelection}
      onclick={() => (picking = true)}>Insert state</button
    >
    {#if allowNoop}
      <button
        type="button"
        class="btn btn-sm"
        title="Leave the output unchanged"
        onclick={() => onchange("noop()")}>No update</button
      >
    {/if}
  </div>

  <textarea
    bind:this={textarea}
    class="code"
    value={code}
    aria-label={label}
    aria-invalid={problem ? "true" : undefined}
    {placeholder}
    rows={minRows}
    spellcheck="false"
    autocapitalize="off"
    autocomplete="off"
    oninput={(event) => onchange(event.currentTarget.value)}
    onselect={rememberSelection}
    onkeyup={rememberSelection}
    onclick={rememberSelection}
  ></textarea>

  {#if problem}
    <p class="hint text-danger">{problem}</p>
  {/if}
</div>

{#if picking}
  <SourcePicker
    mode="state"
    title="Insert state reference"
    {logics}
    logicPick="state"
    onState={insertState}
    onClose={() => (picking = false)}
  />
{/if}

<style>
  .code-field {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    width: 100%;
  }

  .code-head {
    display: flex;
    gap: 0.3rem;
  }

  .code {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    line-height: 1.4;
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-color, #fff);
    color: var(--text-color);
    resize: vertical;
  }

  .code[aria-invalid="true"] {
    border-color: var(--danger-color, #b00020);
  }
</style>
