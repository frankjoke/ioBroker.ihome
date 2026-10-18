<script lang="ts">
  import BadgeChip from "./BadgeChip.svelte";
  import type { BadgeAnchor, ResolvedBadge } from "$lib/config/rule-ops";

  let { badges, anchor }: { badges: ResolvedBadge[]; anchor: BadgeAnchor } =
    $props();

  const MAX = 3;
  const shown = $derived((badges ?? []).slice(0, MAX));
  const rest = $derived((badges ?? []).slice(MAX));
</script>

{#if shown.length}
  <div class="badges by-{anchor.y} bx-{anchor.x}">
    {#each shown as b, i (i)}
      <BadgeChip
        icon={b.icon}
        label={b.label}
        tone={b.tone}
        color={b.color}
        title={b.title}
      />
    {/each}
    {#if rest.length}
      <BadgeChip
        label={`+${rest.length}`}
        tone="more"
        title={rest.map((b) => `${b.source}: ${b.label}`).join(", ")}
      />
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
</style>
