<script lang="ts">
  /** The one icon button: close, delete, duplicate, remove. The caller passes
   *  the glyph, the action and optionally a colour. The look is the single
   *  `.icon-btn` rule in app.css, the same one every editor uses; never
   *  restyle a button at the call site. */
  let {
    icon,
    label,
    title = label,
    disabled = false,
    active = false,
    color = "var(--text-color)",
    onclick,
  }: {
    icon: string;
    /** Accessible name; also the tooltip unless `title` overrides it. */
    label: string;
    title?: string;
    disabled?: boolean;
    active?: boolean;
    /** Icon colour; the normal text colour by default (e.g. --danger-color). */
    color?: string;
    onclick: (event: MouseEvent) => void;
  } = $props();
</script>

<button
  type="button"
  class="icon-btn"
  class:active
  style:color
  {title}
  aria-label={label}
  {disabled}
  {onclick}
>
  <span class="material-symbols-outlined">{icon}</span>
</button>
