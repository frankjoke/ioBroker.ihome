<script lang="ts">
  import { iconSrc, isImageIcon } from "$lib/utils/icon-url";

  let {
    value,
    size = 24,
    dim = false,
    owner,
  }: {
    /** A material-symbols name or an image path/URL (A23). */
    value?: string;
    /** Glyph size in px (font-size for a symbol, width/height for an image). */
    size?: number;
    /** The "disabled" look a rule can ask for: dimmed, still usable. */
    dim?: boolean;
    /** The broker object a value came from, when it did — its adapter owns a
     *  relative filename (A66). */
    owner?: string;
  } = $props();
</script>

{#if value && isImageIcon(value)}
  <img
    class="icon-img"
    class:dim
    src={iconSrc(value, owner)}
    alt=""
    style:width="{size}px"
    style:height="{size}px"
  />
{:else if value}
  <span
    class="material-symbols-outlined"
    class:dim
    style:font-size="{size}px"
    aria-hidden="true">{value}</span
  >
{/if}

<style>
  .dim {
    opacity: 0.45;
  }

  .icon-img {
    display: inline-block;
    object-fit: contain;
    vertical-align: middle;
  }

  .material-symbols-outlined {
    line-height: 1;
  }
</style>
