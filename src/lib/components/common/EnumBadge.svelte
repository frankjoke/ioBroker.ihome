<script lang="ts">
  import { findEnum, enumShortId } from "$lib/config/rooms";
  import { localizeName, contrastColor } from "$lib/config/format";
  import Icon from "$lib/components/common/Icon.svelte";

  let { id, enums }: { id: string; enums: any } = $props();

  const e = $derived(findEnum(enums, id));
  const label = $derived(
    e ? localizeName(e.common?.name) || enumShortId(id) : enumShortId(id),
  );
  const icon = $derived(e?.common?.icon as string | undefined);
  const color = $derived(e?.common?.color as string | undefined);
</script>

{#if id}
  <span
    class="enum-badge"
    class:colored={!!color}
    style:--enum-color={color ?? undefined}
    style:color={color ? contrastColor(color) : undefined}
  >
    {#if icon}
      <Icon value={icon} owner={id} size={15} />
    {/if}
    <span class="enum-label">{label}</span>
  </span>
{/if}

<style>
  .enum-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    max-width: 100%;
    padding: 0.1rem 0.5rem;
    border-radius: var(--border-radius-pill, 999px);
    background: var(--surface-container);
    color: var(--text-color);
    font-size: 0.75rem;
    font-weight: 600;
    line-height: 1.7;
  }

  .enum-badge.colored {
    background: var(--enum-color);
  }

  .enum-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
