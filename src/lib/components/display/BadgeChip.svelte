<script lang="ts">
  import Icon from "$lib/components/common/Icon.svelte";
  import { isHtmlIcon } from "$lib/config/icon-html";

  /**
   * One badge chip — the tile's corner badge (BadgeRow) and the modal's badge
   * strip (A34) both render through this, so the two can never drift.
   */
  let {
    icon,
    label,
    tone,
    color,
    background,
    title,
    value,
    labelHidden,
  }: {
    icon?: string;
    label: string;
    tone?: string;
    color?: string;
    /** An explicit chip background from a matching rule. */
    background?: string;
    title?: string;
    /** The raw reading, for an HTML icon's `{{$value}}`. */
    value?: unknown;
    /** Show the icon only; the reading stays in the title and the detail. */
    labelHidden?: boolean;
  } = $props();

  /** The colour an HTML icon draws with: the explicit one, else the tone. */
  const iconColor = $derived(
    color ||
      (
        {
          info: "var(--text-muted)",
          ok: "var(--tertiary)",
          warn: "var(--warning-color)",
          danger: "var(--danger-color)",
        } as Record<string, string>
      )[tone ?? "info"] ||
      "var(--text-color)",
  );
</script>

<span
  class="badge {tone}"
  style:color
  style:background-color={background}
  title={title ?? label}
>
  {#if icon}
    {#if isHtmlIcon(icon)}
      <Icon
        value={icon}
        size={13}
        data={{ $value: value, $color: iconColor }}
      />
    {:else}
      <span class="material-symbols-outlined" aria-hidden="true">{icon}</span>
    {/if}
  {/if}
  {#if !labelHidden}<span class="badge-label">{label}</span>{/if}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 0 5px;
    border-radius: var(--border-radius-pill);
    background-color: var(--surface-container);
    font-size: 11px;
    line-height: 1.6;
    white-space: nowrap;
  }

  .badge .material-symbols-outlined {
    font-size: 13px;
  }

  .badge.info {
    color: var(--text-muted);
  }

  .badge.ok {
    color: var(--tertiary);
  }

  .badge.warn {
    color: var(--warning-color);
  }

  .badge.danger {
    color: var(--danger-color, #c0392b);
  }

  .badge.more {
    color: var(--text-muted);
  }
</style>
