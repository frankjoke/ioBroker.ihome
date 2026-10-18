<script lang="ts">
  /**
   * One badge chip — the tile's corner badge (BadgeRow) and the modal's badge
   * strip (A34) both render through this, so the two can never drift.
   */
  let {
    icon,
    label,
    tone,
    color,
    title,
  }: {
    icon?: string;
    label: string;
    tone?: string;
    color?: string;
    title?: string;
  } = $props();
</script>

<span class="badge {tone}" style:color title={title ?? label}>
  {#if icon}<span class="material-symbols-outlined" aria-hidden="true"
      >{icon}</span
    >{/if}<span class="badge-label">{label}</span>
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
