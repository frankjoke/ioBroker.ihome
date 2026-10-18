<script lang="ts">
  import { backgroundCss } from "$lib/config/appearance";
  import { tileTitle } from "$lib/config/template-ops";
  import SlotRenderer from "./SlotRenderer.svelte";
  import BadgeChip from "./BadgeChip.svelte";
  import type { EnrichedDevice, SlotControl } from "$lib/types/device";
  import type { Background, Slot } from "$lib/types/display";
  import type { ResolvedBadge, ResolvedStyle } from "$lib/config/rule-ops";

  /**
   * The modal's panel — the dialog's content, and what the tile pane's preview
   * shows below the tile while a slot is shifted between the two (A34). One
   * component, so the preview can never drift from the real modal.
   */
  let {
    device,
    title,
    background,
    rows,
    badges,
    onClose,
    bodyMaxHeight,
  }: {
    device: EnrichedDevice;
    /** The tile's title: the panel shows the name the tile shows (A34). */
    title?: string;
    /** The tile's painted background; the panel shares it (A34). */
    background?: Background;
    /** The slots that live in the modal, resolved and styled by the tile (A34). */
    rows: {
      slot: Slot;
      control?: SlotControl;
      style: ResolvedStyle;
      /** Set when the slot is the tile's action — then it stays a button. */
      onPrimary?: () => void;
    }[];
    /** Badges that live (also) in the modal — read-only chips in sequence under
     *  the title; their corner anchors are the tile's language (A34). */
    badges?: ResolvedBadge[];
    /** Given → a close button in the header (the dialog); absent → a preview. */
    onClose?: () => void;
    /** How far the rows may grow before scrolling (the preview leaves less). */
    bodyMaxHeight?: string;
  } = $props();

  const heading = $derived(title || tileTitle(device));
</script>

<div class="panel" style={backgroundCss(background)}>
  <header class="panel-head">
    <div class="head-main">
      <h2>{heading}</h2>
      {#if badges?.length}
        <div class="badges">
          {#each badges as b, i (i)}
            <BadgeChip
              icon={b.icon}
              label={b.label}
              tone={b.tone}
              color={b.color}
              title={b.title}
            />
          {/each}
        </div>
      {/if}
    </div>
    {#if onClose}
      <button
        type="button"
        class="icon-btn"
        title="Close"
        aria-label="Close"
        onclick={onClose}
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    {/if}
  </header>

  {#if rows.length || !badges?.length}
    <div class="panel-body" style:max-height={bodyMaxHeight}>
      {#each rows as r, i (i)}
        <div class="row">
          <span class="row-label"
            >{r.slot.label ||
              r.control?.label ||
              r.control?.feature ||
              r.slot.source ||
              r.slot.kind}</span
          >
          <div class="row-control">
            <SlotRenderer
              slot={r.slot}
              {device}
              control={r.control}
              style={r.style}
              onPrimary={r.onPrimary}
              emphasis="secondary"
            />
          </div>
        </div>
      {/each}

      {#if rows.length === 0}
        <p class="text-muted">Nothing to show right now.</p>
      {/if}
    </div>
  {/if}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    background-color: var(--surface-container-lowest);
    color: var(--text-color);
    overflow: hidden;
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  /* The name and the modal's chips share the title line (A34) — the panel shows
   * what lives in it, not the device's type and room. */
  .head-main {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    min-width: 0;
  }

  .panel-head h2 {
    margin: 0;
    font-size: 1.05rem;
  }

  /* The badges that live in the modal (A34) — the tile's chips, in sequence. */
  .badges {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
  }

  .panel-body {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.85rem 1rem;
    overflow-y: auto;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .row-label {
    font-size: var(--body-sm);
    font-weight: 600;
    min-width: 6rem;
  }

  .row-control {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: flex-end;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border: 1px solid transparent;
    border-radius: var(--border-radius-pill);
    background-color: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .icon-btn:hover {
    background-color: var(--surface-container);
    color: var(--text-color);
  }
</style>
