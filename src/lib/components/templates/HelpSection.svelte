<script lang="ts">
  import { onMount } from "svelte";
  import { renderHelp } from "$lib/markdown";

  let {
    help,
    label = "Help",
    static: always = false,
    plain = false,
  }: {
    /** Markdown source; nothing renders when it is empty. */
    help?: string;
    label?: string;
    /** Show the body without a toggle (used for the plugin description). */
    static?: boolean;
    /** Drop the boxed help surface and render as normal page text. */
    plain?: boolean;
  } = $props();

  // svelte-ignore state_referenced_locally
  let open = $state(always);
  let loading = $state(false);
  let html = $state("");
  let rendered = $state("");

  async function load() {
    if (!help?.trim() || help === rendered) return;
    loading = true;
    try {
      html = await renderHelp(help);
      rendered = help;
    } finally {
      loading = false;
    }
  }

  async function toggle() {
    open = !open;
    if (open) await load();
  }

  onMount(() => {
    if (always) void load();
  });
</script>

{#if help?.trim()}
  <div class="help" class:static={always}>
    {#if !always}
      <button
        type="button"
        class="help-toggle"
        aria-expanded={open}
        onclick={toggle}
      >
        <span class="material-symbols-outlined">help</span>
        <span>{label}</span>
        <span class="material-symbols-outlined"
          >{open ? "expand_less" : "expand_more"}</span
        >
      </button>
    {/if}
    {#if always || open}
      {#if loading}
        <p class="hint text-muted">Loading help…</p>
      {:else}
        <!-- renderHelp escapes HTML and validates link schemes. -->
        <!-- eslint-disable-next-line svelte/no-at-html-tags -->
        <div class="help-body" class:plain>{@html html}</div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  .help {
    margin: 0 0 0.6rem;
  }

  .help.static {
    margin: 0;
  }

  .help-toggle {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 0;
    border: none;
    background: none;
    color: var(--secondary-color);
    font-size: var(--body-sm);
    font-weight: 600;
  }

  .help-toggle:hover {
    color: var(--text-color);
  }

  .help-toggle .material-symbols-outlined {
    font-size: 16px;
  }

  .help-body {
    margin-top: 4px;
    padding: 0.6rem 0.75rem;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-lg);
    background: var(--surface-container-low);
    font-size: var(--body-sm);
    line-height: 1.45;
  }

  .help-body.plain {
    margin-top: 0;
    padding: 0;
    border: 0;
    background: none;
  }

  /* Rendered Markdown is injected, so these selectors cannot be scoped. */
  .help-body :global(p) {
    margin: 0 0 0.5rem;
  }

  .help-body :global(p:last-child) {
    margin-bottom: 0;
  }

  .help-body :global(ul),
  .help-body :global(ol) {
    margin: 0 0 0.5rem;
    padding-left: 1.2rem;
  }

  .help-body :global(a) {
    color: var(--secondary-color);
  }

  .help-body :global(code) {
    padding: 0 3px;
    border-radius: 3px;
    background: var(--surface-container-high);
    font-family: var(--font-mono);
  }

  .help-body :global(pre) {
    margin: 0 0 0.5rem;
    padding: 0.5rem;
    overflow-x: auto;
    border-radius: var(--border-radius);
    background: var(--surface-container-high);
  }

  .help-body :global(pre code) {
    padding: 0;
    background: none;
  }

  .help-body :global(h1),
  .help-body :global(h2),
  .help-body :global(h3) {
    margin: 0 0 0.5rem;
    font-size: var(--body-md);
  }
</style>
