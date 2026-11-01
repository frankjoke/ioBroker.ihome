<script lang="ts">
  /** The one icon button: close, delete, duplicate, remove. The caller passes
   *  the glyph, the action and optionally a colour. The look is the single
   *  `.icon-btn` rule in app.css, the same one every editor uses; never
   *  restyle a button at the call site.
   *
   *  `danger` marks a bin that asks before it deletes (UI-DESIGN §6): it is red
   *  at rest and stays red on hover. A bin that acts immediately stays normal. */
  let {
    icon,
    label,
    title = label,
    disabled = false,
    active = false,
    danger = false,
    color = undefined,
    onclick,
  }: {
    icon: string;
    /** Accessible name; also the tooltip unless `title` overrides it. */
    label: string;
    title?: string;
    disabled?: boolean;
    active?: boolean;
    /** A destructive action that opens a confirmation — red. */
    danger?: boolean;
    /** Explicit icon colour; leave unset so the `.icon-btn` rules apply. */
    color?: string;
    onclick: (event: MouseEvent) => void;
  } = $props();
</script>

<button
  type="button"
  class="icon-btn"
  class:active
  class:danger
  style:color
  {title}
  aria-label={label}
  {disabled}
  {onclick}
>
  <span class="material-symbols-outlined">{icon}</span>
</button>
