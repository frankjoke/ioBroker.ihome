<script lang="ts">
  import { tick } from "svelte";
  import { checkExpression, highlightCode } from "$logic/expr-code";
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

  let editor = $state<HTMLDivElement>();
  let textarea = $state<HTMLTextAreaElement>();
  let highlight = $state<HTMLPreElement>();
  let picking = $state(false);
  let composing = $state(false);
  /** The caret to insert at: captured before the picker takes focus. */
  let start = $state(0);
  let end = $state(0);

  const problem = $derived(checkExpression(code));
  const spans = $derived(highlightCode(code));
  const errorId = $props.id();

  /** Grow between the rows minimum and the CSS max-height. */
  function grow() {
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    syncScroll();
  }

  $effect(() => {
    code;
    grow();
  });

  $effect(() => {
    if (!editor) return;
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      grow();
    });
    observer.observe(editor);
    document.fonts?.ready.then(grow);
    return () => observer.disconnect();
  });

  function syncScroll() {
    if (!textarea || !highlight) return;
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;
  }

  function onInput(event: Event) {
    onchange((event.currentTarget as HTMLTextAreaElement).value);
    grow();
  }

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

  <div
    bind:this={editor}
    class="editor"
    class:composing
    class:invalid={problem}
  >
    <!-- prettier-ignore -->
    <pre bind:this={highlight} class="highlight" aria-hidden="true">{#each spans as span, index (index)}<span class={span.kind}>{span.text}</span>{/each}</pre>
    <textarea
      bind:this={textarea}
      class="code"
      value={code}
      aria-label={label}
      aria-invalid={problem ? "true" : undefined}
      aria-describedby={problem ? errorId : undefined}
      {placeholder}
      rows={minRows}
      spellcheck="false"
      autocapitalize="off"
      autocomplete="off"
      oninput={onInput}
      onscroll={syncScroll}
      oncompositionstart={() => (composing = true)}
      oncompositionend={() => {
        composing = false;
        grow();
      }}
      onselect={rememberSelection}
      onkeyup={rememberSelection}
      onclick={rememberSelection}
    ></textarea>
  </div>

  {#if problem}
    <p id={errorId} class="text-danger">{problem}</p>
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

  .editor {
    position: relative;
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-sm, 4px);
    background: var(--surface-color, #fff);
  }

  .editor:focus-within {
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px
      color-mix(in srgb, var(--primary-color) 35%, transparent);
  }

  .editor.invalid {
    border-color: var(--danger-color, #b00020);
  }

  .code,
  .highlight {
    box-sizing: border-box;
    width: 100%;
    margin: 0;
    border: 0;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    line-height: 1.4;
    padding: 0.35rem 0.5rem;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    tab-size: 4;
    /* Reserve the same gutter in both layers so a classic scrollbar never
       narrows the textarea relative to the overlay. */
    scrollbar-gutter: stable;
  }

  .code {
    display: block;
    position: relative;
    max-height: 15rem;
    overflow-y: auto;
    resize: none;
    color: transparent;
    caret-color: var(--text-color);
    background: transparent;
  }

  .code::placeholder {
    color: var(--text-muted);
    opacity: 1;
  }

  .highlight {
    position: absolute;
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    color: var(--text-color);
  }

  /* During IME composition the textarea's own text is the source of truth. */
  .editor.composing .code {
    color: var(--text-color);
  }

  .editor.composing .highlight {
    visibility: hidden;
  }

  .function {
    color: var(--primary-color);
  }

  .keyword {
    color: var(--secondary-color);
  }

  .literal {
    color: var(--tertiary);
  }

  .comment {
    color: var(--text-muted);
  }

  .plain {
    color: inherit;
  }
</style>
