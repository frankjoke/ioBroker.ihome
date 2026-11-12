<script lang="ts">
  import { page as route } from "$app/state";
  import { base } from "$app/paths";
  import { onMount } from "svelte";
  import { frameUrl } from "$lib/config/frame-url";
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
    // Stored for the deployed app; in dev the broker's origin is the source
    // for root-relative pages such as /iqontrol/.
    return frameUrl(raw, {
      dev: import.meta.env.DEV,
      origin: import.meta.env.VITE_IOBROKER_ORIGIN || "http://localhost:8082",
      pageOrigin: typeof location === "undefined" ? "" : location.origin,
      base: base ? `${base}/` : "/",
    });
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
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    min-height: 24rem;
  }

  iframe {
    flex: 1 1 auto;
    width: 100%;
    min-height: 0;
    border: 0;
    background-color: var(--surface-color, #fff);
  }
</style>
