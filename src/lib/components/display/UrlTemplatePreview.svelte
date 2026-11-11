<script lang="ts">
  import {
    placeholderKeys,
    renderHtmlTemplate,
  } from "$lib/config/html-template";
  import { frameUrl } from "$lib/config/frame-url";
  import { placeholderValue } from "$lib/slot-placeholders";

  /** What a frame URL will load, and every `{{name}}` it reads. Shown only
   *  while the URL actually asks for a placeholder. */
  let { text }: { text: string } = $props();

  const rows = $derived.by(() =>
    [...new Set(placeholderKeys(text))].map((key) => {
      const value = placeholderValue(key);
      const missing = value === undefined || value === null || value === "";
      return { key, label: missing ? "missing" : String(value), missing };
    }),
  );
  const resolved = $derived(
    text.trim() ? renderHtmlTemplate(text, placeholderValue) : "",
  );
  const shown = $derived(
    resolved.trim()
      ? frameUrl(resolved, {
          dev: import.meta.env.DEV,
          origin:
            import.meta.env.VITE_IOBROKER_ORIGIN || "http://localhost:8082",
          pageOrigin: location.origin,
        })
      : "",
  );
</script>

{#if rows.length}
  <p class="url-preview text-muted">
    <span class="label-mono">Reads</span>
    {#each rows as row, i (row.key)}
      <span class="mono">{`{{${row.key}}}`}</span>
      <span class:missing={row.missing}>{row.label}</span>
      {#if i < rows.length - 1}<span class="sep">·</span>{/if}
    {/each}
  </p>
  <p class="url-resolved text-muted mono" title={shown}>{shown}</p>
{/if}

<style>
  .url-preview,
  .url-resolved {
    margin: 0;
    font-size: var(--body-sm);
    line-height: 1.4;
    overflow-wrap: anywhere;
  }

  .url-preview .sep {
    margin: 0 0.15rem;
    opacity: 0.5;
  }

  .missing {
    color: var(--danger-color);
  }

  .url-resolved {
    max-height: 3em;
    overflow: hidden;
  }
</style>
