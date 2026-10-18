<script lang="ts">
  import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
  import { backgroundCss } from "$lib/config/appearance";
  import { tileTitle } from "$lib/config/template-ops";
  import EnumBadge from "$lib/components/common/EnumBadge.svelte";
  import SlotRenderer from "./SlotRenderer.svelte";
  import type { EnrichedDevice, SlotControl } from "$lib/types/device";
  import type { Background, Slot } from "$lib/types/display";
  import type { ResolvedStyle } from "$lib/config/rule-ops";

  let {
    device,
    title,
    background,
    rows,
    onClose,
  }: {
    device: EnrichedDevice;
    /** The tile's title: the modal shows the name the tile shows (A34). */
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
    onClose: () => void;
  } = $props();

  let el = $state<HTMLDialogElement | null>(null);

  // Native <dialog>: showModal() gives focus trapping, Esc handling and focus
  // restoration for free — less code and fewer bugs than a hand-rolled trap.
  $effect(() => {
    el?.showModal();
  });

  const heading = $derived(title || tileTitle(device));

  function onBackdrop(e: MouseEvent) {
    if (e.target === el) onClose();
  }
</script>

<dialog
  bind:this={el}
  class="modal"
  aria-label={heading}
  style={backgroundCss(background)}
  onclick={onBackdrop}
  onclose={onClose}
>
  <header class="modal-head">
    <div class="title">
      <h2>{heading}</h2>
      <div class="meta">
        <span class="badge badge-secondary">{device.type}</span>
        {#if device.room}<EnumBadge
            id={device.room}
            enums={ioBroker.enums}
          />{/if}
      </div>
    </div>
    <button
      type="button"
      class="icon-btn"
      title="Close"
      aria-label="Close"
      onclick={onClose}
    >
      <span class="material-symbols-outlined">close</span>
    </button>
  </header>

  <div class="modal-body">
    {#each rows as r (`${r.slot.kind}:${r.slot.source ?? ""}:${r.slot.options?.index ?? ""}`)}
      <div class="row">
        <span class="row-label"
          >{r.slot.label ??
            r.control?.label ??
            r.slot.source ??
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
</dialog>

<style>
  .modal {
    width: min(560px, 94vw);
    max-height: 86vh;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: var(--border-radius-md, 12px);
    background-color: var(--surface-container-lowest);
    color: var(--text-color);
  }

  .modal::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }

  .modal-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--border-color);
  }

  .modal-head h2 {
    margin: 0 0 0.3rem;
    font-size: 1.05rem;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .modal-body {
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
