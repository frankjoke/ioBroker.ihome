<script lang="ts">
  import type { BadgeCorner, ResolvedBadge } from "$lib/config/rule-ops";

  let {
    badges,
    corner = "bottom-left",
  }: { badges: ResolvedBadge[]; corner?: BadgeCorner } = $props();

  const MAX = 3;
  const shown = $derived((badges ?? []).slice(0, MAX));
  const rest = $derived((badges ?? []).slice(MAX));
</script>

{#if shown.length}
  <div class="badges {corner}">
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
  /* Pinned to a corner so position carries meaning: bottom-left is "how long
     ago", top-right is "something is wrong", top-left is a reading. */
  .badges {
    position: absolute;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
    max-width: 92%;
    pointer-events: none;
  }

  .badges.top-left {
    top: 3px;
    left: 4px;
  }

  .badges.top-right {
    top: 3px;
    right: 4px;
    justify-content: flex-end;
  }

  .badges.bottom-left {
    bottom: 3px;
    left: 4px;
  }

  .badges.bottom-right {
    bottom: 3px;
    right: 4px;
    justify-content: flex-end;
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
