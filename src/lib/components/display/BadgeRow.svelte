<script lang="ts">
  import type { BadgeAnchor, ResolvedBadge } from "$lib/config/rule-ops";

  let { badges, anchor }: { badges: ResolvedBadge[]; anchor: BadgeAnchor } =
    $props();

  const MAX = 3;
  const shown = $derived((badges ?? []).slice(0, MAX));
  const rest = $derived((badges ?? []).slice(MAX));
</script>

{#if shown.length}
  <div class="badges by-{anchor.y} bx-{anchor.x}">
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
  /* Pinned to one of nine anchors on the tile's edge (defaults fill top-right →
     bottom-right → top-left → bottom-left, see `badgePositions`). Badges sit
     above the tile's own content and never move it: the tile reserves no band
     for them, so a badge may cover a value. */
  .badges {
    position: absolute;
    z-index: 2;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
    max-width: 92%;
    pointer-events: none;
    /* Hangs the badge out onto the border/glow instead of into the content.
       Measured from the padding box; -8px puts the edge 7px past the 1px
       border, on the glow ring. The grid gap is 6px, so two facing badges
       still clear each other. */
    --out: -8px;
  }

  .bx-left {
    left: var(--out);
  }

  .bx-right {
    right: var(--out);
    justify-content: flex-end;
  }

  .bx-center {
    left: 0;
    right: 0;
    width: max-content;
    margin-inline: auto;
    justify-content: center;
  }

  .by-top {
    top: var(--out);
  }

  .by-bottom {
    bottom: var(--out);
  }

  .by-middle {
    top: 0;
    bottom: 0;
    height: max-content;
    margin-block: auto;
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
