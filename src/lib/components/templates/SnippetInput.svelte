<script lang="ts">
  import { tick } from "svelte";
  import { insertAtCaret } from "$lib/components/logic/code-field";
  import SnippetSelect from "./SnippetSelect.svelte";

  let {
    value,
    onchange,
    label,
    readonly = false,
  }: {
    value: string;
    onchange: (value: string) => void;
    label?: string;
    readonly?: boolean;
  } = $props();

  let input = $state<HTMLInputElement>();
  let start = 0;
  let end = 0;
  let focused = false;

  function remember() {
    if (!input) return;
    focused = document.activeElement === input;
    start = input.selectionStart ?? 0;
    end = input.selectionEnd ?? 0;
  }

  async function insert(code: string) {
    const [from, to] = focused ? [start, end] : [value.length, value.length];
    const next = insertAtCaret(value, from, to, code);
    onchange(next.text);
    await tick();
    input?.focus();
    input?.setSelectionRange(next.caret, next.caret);
    start = next.caret;
    end = next.caret;
    focused = true;
  }
</script>

<div class="snippet-input">
  <input
    type="text"
    {value}
    {readonly}
    aria-label={label}
    bind:this={input}
    oninput={(e) => onchange(e.currentTarget.value)}
    onmousedown={remember}
    onfocus={remember}
    onselect={remember}
    onkeyup={remember}
    onclick={remember}
  />
  {#if !readonly}
    <SnippetSelect mode="expression" onInsert={insert} />
  {/if}
</div>

<style>
  .snippet-input {
    display: flex;
    align-items: center;
    gap: 0.35rem;
  }

  .snippet-input input {
    flex: 1;
    min-width: 0;
  }
</style>
