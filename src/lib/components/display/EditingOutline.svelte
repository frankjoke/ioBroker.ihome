<script lang="ts">
  let { inset = false }: { inset?: boolean } = $props();
</script>

<svg class="editing-outline" class:inset aria-hidden="true">
  <rect
    x="0"
    y="0"
    width="100%"
    height="100%"
    rx={inset ? 10 : 15}
    ry={inset ? 10 : 15}
    fill="none"
  />
</svg>

<style>
  /* Scoped to the overlay on purpose: an unstyled SVG would paint a black
     default rect and sit in the tile's flex flow. */
  .editing-outline {
    position: absolute;
    top: -3px;
    left: -3px;
    display: block;
    max-width: none;
    width: calc(100% + 6px);
    height: calc(100% + 6px);
    overflow: visible;
    pointer-events: none;
    z-index: 3;
  }

  .editing-outline rect {
    fill: none;
    stroke: var(--primary-color);
    stroke-width: 2;
    stroke-dasharray: 8 6;
    animation: editing-march 0.8s linear infinite;
  }

  /* A single-surface tile clips its children; its outline is drawn just inside
     the edge so the tile's overflow cannot cut it off. */
  .editing-outline.inset {
    top: 2px;
    left: 2px;
    width: calc(100% - 4px);
    height: calc(100% - 4px);
  }

  @keyframes editing-march {
    to {
      stroke-dashoffset: -14;
    }
  }
</style>
