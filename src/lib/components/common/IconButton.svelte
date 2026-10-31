<script lang="ts">
  /** The one icon button: close, delete, duplicate, remove. The caller passes
   *  the glyph, the action and optionally a colour; the look lives here once
   *  (same pattern as WhereButton). Never restyle a button at the call site. */
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

<style>
  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2.5rem;
    height: 2.5rem;
    padding: 0;
    border-radius: 0.25rem;
    border: none;
    background-color: var(--surface-container);
    cursor: pointer;
    transition:
      background-color 0.2s,
      color 0.2s;
  }

  .icon-btn:hover:not(:disabled) {
    background-color: var(--surface-container-high);
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon-btn.active {
    background-color: var(--surface-container-highest);
  }

  .material-symbols-outlined {
    font-size: 1.5rem;
  }
</style>
