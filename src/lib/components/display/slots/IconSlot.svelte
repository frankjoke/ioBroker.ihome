<script lang="ts">
  import type { Slot } from "$lib/types/display";

  let {
    slot,
    style,
    fallback,
  }: {
    slot: Slot;
    style: { icon?: string; color?: string };
    fallback?: string;
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

<span
  class="icon material-symbols-outlined"
  style:color={style.color}
  aria-hidden="true">{glyph}</span
>

<style>
  .icon {
    font-size: 34px;
    line-height: 1;
    color: var(--text-muted);
  }
</style>
