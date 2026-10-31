<script lang="ts">
  /** The one icon button: close, delete, duplicate, remove. The caller passes
   *  the glyph and the action; the look lives here once (same pattern as
   *  WhereButton). Never restyle a button at the call site. */
  let {
    icon,
    label,
    title = label,
    disabled = false,
    active = false,
    onclick,
  }: {
    icon: string;
    /** Accessible name; also the tooltip unless `title` overrides it. */
    label: string;
    title?: string;
    disabled?: boolean;
    active?: boolean;
    onclick: (event: MouseEvent) => void;
  } = $props();
</script>

<button
  type="button"
  class="icon-btn"
  class:active
  {title}
  aria-label={label}
  {disabled}
  {onclick}
>
  <span class="material-symbols-outlined">{icon}</span>
</button>
