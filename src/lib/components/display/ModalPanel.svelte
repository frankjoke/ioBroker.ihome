<script lang="ts">
  import { backgroundCss } from "$lib/config/appearance";
  import { tileTitle } from "$lib/config/template-ops";
  import Icon from "$lib/components/common/Icon.svelte";
  import SlotRenderer from "./SlotRenderer.svelte";
  import TileChart from "./TileChart.svelte";
  import type { ChartSeries } from "$lib/config/tile-parts";
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
    headIcon,
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
      /** The resolved control; `feature` names it when the device gave it no
       *  label — the row label falls back to it. */
      control?: SlotControl & { feature?: string };
      style: ResolvedStyle;
      /** The row's own icon (A54), resolved by the tile. */
      icon?: { glyph: string; color?: string; disabled?: boolean };
      /** The row's own chart (A62), resolved by the tile. */
      spark?: ChartSeries;
      /** Set when the slot is the tile's action — then it stays a button. */
      onPrimary?: () => void;
    }[];
    /** Badges that live (also) in the modal — read-only chips in sequence under
     *  the title; their corner anchors are the tile's language (A34). */
    badges?: ResolvedBadge[];
    /** The headline slot's icon (A54): the detail page greets the name with it. */
    headIcon?: { glyph: string; color?: string; disabled?: boolean };
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
      {#if headIcon}
        <span class="head-icon" style:color={headIcon.color}>
          <Icon value={headIcon.glyph} size={26} dim={headIcon.disabled} />
        </span>
      {/if}
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
    <div
      class="panel-body"
      style:max-height={bodyMaxHeight}
      style:--panel-max={bodyMaxHeight}
    >
      {#each rows as r, i (i)}
        {#if r.slot.kind === "frame"}
          {#if r.icon}
            <div class="row frame-cap">
              <span class="row-icon" style:color={r.icon.color}>
                <Icon value={r.icon.glyph} size={18} dim={r.icon.disabled} />
              </span>
            </div>
          {/if}
          <!-- A page has no name column: it takes the panel's whole width, and
               the row's height is what the tile's frame would not have (A38). -->
          <div class="row-frame">
            <SlotRenderer
              slot={r.slot}
              {device}
              control={r.control}
              style={r.style}
              emphasis="secondary"
            />
          </div>
        {:else}
          <div class="row">
            {#if r.icon}
              <span class="row-icon" style:color={r.icon.color}>
                <Icon value={r.icon.glyph} size={18} dim={r.icon.disabled} />
              </span>
            {/if}
            <span class="row-label"
              >{r.slot.label ||
                r.control?.label ||
                r.control?.feature ||
                r.slot.source ||
                r.slot.kind}</span
            >
            {#if r.spark}
              <div class="row-chart"><TileChart series={[r.spark]} /></div>
            {/if}
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
        {/if}
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

  /* The detail page's face (A54): the headline's icon greets the name; the
   * rows wear their slot's icon before the label. Rule colours win over the
   * muted default. */
  .head-icon,
  .row-icon {
    display: inline-flex;
    align-items: center;
    color: var(--text-muted);
    flex: 0 0 auto;
  }

  .frame-cap {
    justify-content: center;
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

  /* The frame's row: full width and no label column. Its height is the panel's
     own budget (`--panel-max`, the same cap the body gets), so the page uses
     the room the surface has — 70vh in the dialog, 30vh in the pane preview —
     instead of a fixed cap (A38). The tile's own size never reaches in here:
     the modal is the enlargement, not a scaled tile. */
  .row-frame {
    height: var(--panel-max, 55vh);
    min-height: 12rem;
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

  /* The chart sits between the label and the value (A62): it takes the free
     middle, and the value stops growing while it is there. */
  .row-chart {
    flex: 1;
    min-width: 0;
  }

  .row-chart + .row-control {
    flex: 0 1 auto;
  }

  .row-chart :global(.chart) {
    max-width: none;
    height: 24px;
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
