<script lang="ts">
  import { base } from "$app/paths";
  import { getPageRegistry } from "$lib/stores/pages.svelte.js";

  let { currentId }: { currentId?: string } = $props();

  const pages = $derived(getPageRegistry().pages ?? []);
</script>

<header class="bar">
  <a class="brand" href={`${base}/#/`}>
    <span class="material-symbols-outlined" aria-hidden="true">home</span>
    <span class="brand-name">iHome</span>
  </a>

  <nav class="page-tabs" aria-label="Pages">
    {#each pages as p (p.id)}
      <a
        class="tab"
        class:active={p.id === currentId}
        href={`${base}/#/p/${p.id}`}
        aria-current={p.id === currentId ? "page" : undefined}
      >
        {#if p.icon}<span class="material-symbols-outlined" aria-hidden="true"
            >{p.icon}</span
          >{/if}
        <span class="tab-label">{p.title}</span>
      </a>
    {/each}
  </nav>

  <a
    class="icon-btn"
    href={`${base}/#/devices`}
    title="Configuration"
    aria-label="Configuration"
  >
    <span class="material-symbols-outlined">settings</span>
  </a>
</header>

<style>
  .bar {
    position: sticky;
    top: 0;
    z-index: 50;
    display: grid;
    grid-template-columns: auto 1fr auto;
    align-items: center;
    gap: 0.75rem;
    min-height: 48px;
    padding: 0.35rem 12px;
    background-color: var(--surface-container-low);
    border-bottom: 1px solid var(--border-color);
    backdrop-filter: blur(8px);
  }

  .brand {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-weight: 700;
    color: var(--text-color);
    white-space: nowrap;
  }

  .brand .material-symbols-outlined {
    font-size: 20px;
    color: var(--primary-color);
  }

  .brand:hover {
    text-decoration: none;
  }

  .page-tabs {
    display: flex;
    align-items: center;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .page-tabs::-webkit-scrollbar {
    display: none;
  }

  .tab {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: var(--border-radius-pill);
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 600;
    white-space: nowrap;
  }

  .tab:hover {
    text-decoration: none;
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .tab.active {
    background-color: var(--primary-container);
    color: var(--on-primary-container);
  }

  .tab .material-symbols-outlined {
    font-size: 18px;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: var(--border-radius-pill);
    color: var(--text-muted);
  }

  .icon-btn:hover {
    text-decoration: none;
    background-color: var(--surface-container);
    color: var(--text-color);
  }

  .icon-btn .material-symbols-outlined {
    font-size: 20px;
  }
</style>
