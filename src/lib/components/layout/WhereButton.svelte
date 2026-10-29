<script lang="ts">
  /** The one 3-state "where does this live?" button: tile, tile + detail, or
   *  detail only. The caller owns the state and the click; this only draws it,
   *  so every home control in the pane looks and behaves the same. */
  let {
    where,
    title,
    active = false,
    onCycle,
  }: {
    where: "tile" | "both" | "modal";
    title: string;
    /** Highlighted when this control is not at its default home. */
    active?: boolean;
    onCycle: () => void;
  } = $props();

  const GLYPH = {
    tile: "crop_square",
    both: "splitscreen",
    modal: "open_in_full",
  } as const;
</script>

<button
  type="button"
  class="where-btn"
  class:active
  {title}
  aria-label={title}
  onclick={onCycle}
>
  <span class="material-symbols-outlined">{GLYPH[where]}</span>
</button>

<style>
  /* Deliberately not the row-action `.icon-btn` (that one is boxed): one plain
     glyph everywhere, so the same state looks the same in every row. */
  .where-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.75rem;
    height: 1.75rem;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .where-btn:hover {
    background: var(--surface-container);
    color: var(--text-color);
  }

  .where-btn.active {
    color: var(--primary-color);
  }

  .where-btn .material-symbols-outlined {
    font-size: 1.1rem;
  }
</style>
