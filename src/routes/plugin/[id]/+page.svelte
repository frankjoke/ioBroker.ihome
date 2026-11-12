<script lang="ts">
  import { page as route } from "$app/state";
  import { onMount } from "svelte";
  import {
    getPluginPages,
    initPluginPages,
    pluginPagesLoadKind,
  } from "$lib/stores/plugin-pages.svelte";

  const id = $derived(route.params?.id ?? "");
  const entry = $derived(getPluginPages().pages.find((page) => page.id === id));
  const loadKind = $derived(pluginPagesLoadKind());
  const src = $derived.by(() => {
    const raw = entry?.url?.trim();
    if (!raw) return "";
    try {
      return new URL(raw, location.origin).href;
    } catch {
      return "";
    }
  });

  onMount(() => {
    void initPluginPages();
  });
</script>

<svelte:head>
  <title>{entry?.title ?? "Plugin page"} - iHome</title>
</svelte:head>

<div class="plugin-page">
  {#if entry && src}
    <div class="page-header">
      <div class="page-heading">
        <h1>{entry.title}</h1>
        <span class="hint text-muted mono">{entry.url}</span>
      </div>
      <a class="btn" href={src} target="_blank" rel="noopener">
        Open in new tab
      </a>
    </div>
    <iframe {src} title={entry.title}></iframe>
  {:else if loadKind === "pending"}
    <div class="card empty-state">
      <p class="text-muted">Loading page…</p>
    </div>
  {:else}
    <div class="card empty-state">
      <p class="text-muted">
        {#if loadKind === "unreadable"}
          The page list is unreadable — fix
          <code>ihome.0.config.pluginPages</code>.
        {:else if entry}
          This page has no valid URL.
        {:else}
          This page is no longer in the page list.
        {/if}
      </p>
    </div>
  {/if}
</div>

<style>
  .plugin-page {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    height: calc(100vh - 70px);
    min-height: 24rem;
  }

  .page-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .page-heading {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }

  h1 {
    margin: 0;
  }

  .mono {
    font-family: var(--font-mono);
    font-size: var(--body-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  iframe {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    background-color: var(--surface-color, #fff);
  }
</style>
