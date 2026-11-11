<script lang="ts">
  import { iconSrc, isImageIcon } from "$lib/utils/icon-url";
  import { iconHtmlDocument, isHtmlIcon } from "$lib/config/icon-html";

  let {
    value,
    size = 24,
    dim = false,
    owner,
    data,
  }: {
    /** A material-symbols name, an image path/URL, or HTML/SVG markup (A23). */
    value?: string;
    /** Glyph size in px (font-size for a symbol, width/height for an image). */
    size?: number;
    /** The "disabled" look a rule can ask for: dimmed, still usable. */
    dim?: boolean;
    /** The broker object a value came from, when it did — its adapter owns a
     *  relative filename (A66). */
    owner?: string;
    /** Values for `{{$name}}` in an HTML icon; `$value` is the slot's reading. */
    data?: Record<string, unknown>;
  } = $props();

  /** An icon that does not load renders nothing (A69): a broken-image glyph
   *  would be worse than the gap it replaces. */
  let failed = $state(false);
  $effect(() => {
    void value;
    failed = false;
  });

  const html = $derived(
    value && isHtmlIcon(value) ? iconHtmlDocument(value, data ?? {}) : "",
  );
</script>

{#if value && isHtmlIcon(value)}
  <iframe
    class="icon-html"
    class:dim
    sandbox=""
    srcdoc={html}
    title="Icon"
    aria-hidden="true"
    tabindex="-1"
    style:width="{size}px"
    style:height="{size}px"
  ></iframe>
{:else if value && isImageIcon(value) && !failed}
  <img
    class="icon-img"
    class:dim
    src={iconSrc(value, owner)}
    alt=""
    style:width="{size}px"
    style:height="{size}px"
    onerror={() => (failed = true)}
  />
{:else if value && !isImageIcon(value)}
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

  .icon-html {
    display: inline-block;
    border: 0;
    background: transparent;
    vertical-align: middle;
    /* The icon is decoration: taps belong to the tile or the row button. */
    pointer-events: none;
  }

  .material-symbols-outlined {
    line-height: 1;
  }
</style>
