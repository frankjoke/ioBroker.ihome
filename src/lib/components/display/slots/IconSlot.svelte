<script lang="ts">
  import Icon from "$lib/components/common/Icon.svelte";
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
    class="icon"
    style:color={style.color}
    title="Toggle"
    aria-label="Toggle"
    onclick={(e) => {
      e.stopPropagation();
      logPointer("click icon", e);
      onPrimary();
    }}
  >
    <Icon value={glyph} size={34} dim={style.disabled === true} />
  </button>
{:else}
  <span class="icon" style:color={style.color} aria-hidden="true">
    <Icon value={glyph} size={34} dim={style.disabled === true} />
  </span>
{/if}

<style>
  .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    color: var(--text-muted);
    padding: 0;
    border: none;
    background: transparent;
  }

  button.icon {
    cursor: pointer;
  }
</style>
