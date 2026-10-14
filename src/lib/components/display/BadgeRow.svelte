<script lang="ts">
  import type { ResolvedBadge } from "$lib/config/rule-ops";

  let { badges }: { badges: ResolvedBadge[] } = $props();

  const MAX = 3;
  const shown = $derived((badges ?? []).slice(0, MAX));
  const rest = $derived((badges ?? []).slice(MAX));
</script>

{#if shown.length}
  <div class="badges">
    {#each shown as b (b.source)}
      <span class="badge {b.tone}" title={b.title ?? b.label}>
        <span class="material-symbols-outlined" aria-hidden="true"
          >{b.icon}</span
        ><span class="badge-label">{b.label}</span>
      </span>
    {/each}
    {#if rest.length}
      <span
        class="badge more"
        title={rest.map((b) => `${b.source}: ${b.label}`).join(", ")}
        >+{rest.length}</span
      >
    {/if}
  </div>
{/if}

<style>
  .badges {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 4px;
    max-width: 100%;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 5px;
    border-radius: var(--border-radius-pill);
    background-color: var(--surface-container);
    font-size: 11px;
    line-height: 1.6;
    white-space: nowrap;
  }

  .badge .material-symbols-outlined {
    font-size: 13px;
  }

  .badge.info {
    color: var(--text-muted);
  }

  .badge.ok {
    color: var(--tertiary);
  }

  .badge.warn {
    color: var(--warning-color);
  }

  .badge.danger {
    color: var(--danger-color, #c0392b);
  }

  .badge.more {
    color: var(--text-muted);
  }
</style>
