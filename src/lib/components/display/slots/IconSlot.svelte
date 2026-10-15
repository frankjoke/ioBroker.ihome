<script lang="ts">
  import type { Slot } from "$lib/types/display";
  import { logPointer } from "$lib/utils/dbg";

  let {
    slot,
    style,
    fallback,
    onPrimary,
  }: {
    slot: Slot;
    style: { icon?: string; color?: string; disabled?: boolean };
    fallback?: string;
    /** Set when this slot *is* the tile's action — then the glyph is a button. */
    onPrimary?: () => void;
  } = $props();

  const glyph = $derived(
    style.icon ??
      (typeof slot.options?.icon === "string"
        ? slot.options.icon
        : undefined) ??
      fallback ??
      "widgets",
  );
</script>

{#if onPrimary}
  <button
    type="button"
    class="icon material-symbols-outlined"
    class:dim={style.disabled === true}
    style:color={style.color}
    title="Toggle"
    aria-label="Toggle"
    onclick={(e) => {
      e.stopPropagation();
      logPointer("click icon", e);
      onPrimary();
    }}>{glyph}</button
  >
{:else}
  <span
    class="icon material-symbols-outlined"
    class:dim={style.disabled === true}
    style:color={style.color}
    aria-hidden="true">{glyph}</span
  >
{/if}

<style>
  .icon {
    font-size: 34px;
    line-height: 1;
    color: var(--text-muted);
    padding: 0;
    border: none;
    background: transparent;
  }

  button.icon {
    cursor: pointer;
  }

  /* The "disabled" look a rule can ask for: dimmed, still usable. */
  .dim {
    opacity: 0.45;
  }
</style>
