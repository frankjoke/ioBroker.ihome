<script lang="ts">
  import { tick } from "svelte";
  import {
    checkExpression,
    checkStatement,
    highlightCode,
  } from "$logic/expr-code";
  import type { Input, LogicDef } from "$logic/types";
  import SourcePicker from "$lib/components/discovery/SourcePicker.svelte";
  import Icon from "$lib/components/common/Icon.svelte";
  import { gotoInsertAt, insertAtCaret, insertRange } from "./code-field";

  let {
    code,
    onchange,
    label,
    placeholder,
    hint,
    minRows = 2,
    allowNoop = false,
    mode = "expression",
    allowGoto = false,
    stateNames = [],
    logics = [],
    inputs = {},
  }: {
    code: string;
    onchange: (code: string) => void;
    label: string;
    placeholder?: string;
    /** One muted line under the field; the fetchJson signature. */
    hint?: string;
    minRows?: number;
    allowNoop?: boolean;
    /** A single expression, or a block of statements. */
    mode?: "expression" | "statements";
    /** Offer the Goto insert (statement blocks). */
    allowGoto?: boolean;
    /** The machine's states, offered by the Goto insert after `— stay —`. */
    stateNames?: string[];
    /** The document's logics, for the picker's Logic tab. */
    logics?: LogicDef[];
    /** The logic's own variables/events, as quick-insert badges. */
    inputs?: Record<string, Input>;
  } = $props();

  const STATEMENT_PLACEHOLDER =
    'set("light", true)\nlog("motion on")\ngoto("On")';

  let editor = $state<HTMLDivElement>();
  let textarea = $state<HTMLTextAreaElement>();
  let highlight = $state<HTMLPreElement>();
  let picking = $state(false);
  let composing = $state(false);
  /** The caret to insert at: captured before the picker or a badge takes focus. */
  let start = $state(0);
  let end = $state(0);
  /** Whether the textarea had focus when the insert button was pressed. */
  let focusedBeforePress = $state(false);

  const problem = $derived(
    mode === "statements" ? checkStatement(code) : checkExpression(code),
  );
  const spans = $derived(highlightCode(code));
  const inputEntries = $derived(Object.entries(inputs));
  const errorId = $props.id();
  const hintId = `${errorId}-hint`;

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
    focusedBeforePress = document.activeElement === textarea;
    start = textarea.selectionStart;
    end = textarea.selectionEnd;
  }

  async function insertText(text: string) {
    picking = false;
    // A button pressed without a focused field appends instead of inserting at 0.
    const [from, to] = insertRange(focusedBeforePress, start, end, code.length);
    const next = insertAtCaret(code, from, to, text);
    onchange(next.text);
    await tick();
    textarea?.focus();
    textarea?.setSelectionRange(next.caret, next.caret);
    start = next.caret;
    end = next.caret;
    focusedBeforePress = true;
  }

  function insertReference(name: string) {
    return insertText(`get(${JSON.stringify(name)})`);
  }
</script>

<div class="code-field">
  <div class="code-head">
    <button
      type="button"
      class="btn btn-sm btn-outline"
      title="Insert a state reference at the caret"
      onmousedown={rememberSelection}
      onclick={() => (picking = true)}
    >
      <Icon value="add" size={14} />
      <span>State</span>
    </button>
    {#if allowGoto}
      <select
        aria-label="Insert goto"
        title="Insert a goto at the caret"
        value=""
        onmousedown={rememberSelection}
        onchange={(e) => {
          const text = gotoInsertAt(e.currentTarget.selectedIndex, stateNames);
          e.currentTarget.selectedIndex = 0;
          if (text) insertText(text);
        }}
      >
        <option value="">— goto —</option>
        <option value="">— stay —</option>
        {#each stateNames as state (state)}
          <option value={state}>{state}</option>
        {/each}
      </select>
    {/if}
    {#if allowNoop && mode === "expression"}
      <button
        type="button"
        class="btn btn-sm btn-outline"
        title="Leave the output unchanged"
        onmousedown={rememberSelection}
        onclick={() => insertText("noop()")}>No update</button
      >
    {/if}
    {#if inputEntries.length > 0}
      <div class="badges">
        {#each inputEntries as [name, input] (name)}
          <button
            type="button"
            class="badge {input.kind === 'event'
              ? 'badge-primary'
              : 'badge-secondary'} badge-button"
            title={`Insert get(${JSON.stringify(name)})`}
            aria-label={`Insert get(${JSON.stringify(name)})`}
            onmousedown={rememberSelection}
            onclick={() => insertReference(name)}>{name}</button
          >
        {/each}
      </div>
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
      aria-describedby={[problem ? errorId : "", hint ? hintId : ""]
        .filter(Boolean)
        .join(" ") || undefined}
      placeholder={placeholder ??
        (mode === "statements" ? STATEMENT_PLACEHOLDER : undefined)}
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
      onblur={() => {
        // Keyboard users tab to an insert control without a mousedown.
        if (!textarea) return;
        start = textarea.selectionStart;
        end = textarea.selectionEnd;
        focusedBeforePress = true;
      }}
      onselect={rememberSelection}
      onkeyup={rememberSelection}
      onclick={rememberSelection}
    ></textarea>
  </div>

  {#if problem}
    <p id={errorId} class="text-danger">{problem}</p>
  {/if}
  {#if hint}
    <p id={hintId} class="hint text-muted">{hint}</p>
  {/if}
</div>

{#if picking}
  <SourcePicker
    mode="state"
    title="Insert state reference"
    {logics}
    logicPick="state"
    onState={insertReference}
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
    flex-wrap: wrap;
    align-items: center;
    gap: 0.3rem;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem;
    margin-left: auto;
  }

  .badge-button {
    border: 0;
    cursor: pointer;
    font-family: inherit;
    max-width: 10rem;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge-button:hover {
    filter: brightness(0.95);
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

  .hint {
    margin: 0;
    font-size: 0.8rem;
  }

  .plain {
    color: inherit;
  }
</style>
