<script lang="ts">
  import { tileTitle } from "$lib/config/template-ops";
  import ModalPanel from "./ModalPanel.svelte";
  import type { EnrichedDevice, SlotControl } from "$lib/types/device";
  import type { Background, Slot } from "$lib/types/display";
  import type { ResolvedBadge, ResolvedStyle } from "$lib/config/rule-ops";

  let {
    device,
    title,
    background,
    rows,
    badges,
    headIcon,
    inline = false,
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
      /** The row's own icon (A54), resolved by the tile. */
      icon?: { glyph: string; color?: string; disabled?: boolean };
      /** Set when the slot is the tile's action — then it stays a button. */
      onPrimary?: () => void;
    }[];
    /** The badges that live (also) in the modal (A34). */
    badges?: ResolvedBadge[];
    /** The headline slot's icon (A54): the detail page greets the name with it. */
    headIcon?: { glyph: string; color?: string; disabled?: boolean };
    /** Shown *non-modally* (`show()`): it does not block the page, which is what
     *  the layout sheet wants — the modal view is something to look at while
     *  editing, not something that stops the editing. */
    inline?: boolean;
    onClose: () => void;
  } = $props();

  let el = $state<HTMLDialogElement | null>(null);

  // Native <dialog>: showModal() gives focus trapping, Esc handling and focus
  // restoration for free — less code and fewer bugs than a hand-rolled trap.
  // `inline` (the layout sheet's modal view) uses show() instead: the same
  // dialog, non-modal, so the page behind it stays usable.
  $effect(() => {
    if (inline) el?.show();
    else el?.showModal();
  });

  function onBackdrop(e: MouseEvent) {
    if (e.target === el) onClose();
  }
</script>

<dialog
  bind:this={el}
  class="modal"
  class:inline
  aria-label={title || tileTitle(device)}
  onclick={onBackdrop}
  onclose={onClose}
>
  <ModalPanel
    {device}
    {title}
    {background}
    {rows}
    {badges}
    {headIcon}
    {onClose}
    bodyMaxHeight="70vh"
  />
</dialog>

<style>
  .modal {
    width: min(560px, 94vw);
    padding: 0;
    border: none;
    background: transparent;
    color: var(--text-color);
    /* The layout sheet renders the display inert so a stray tap cannot switch a
       lamp — but the modal it opens must stay usable (spike C). */
    pointer-events: auto;
  }

  /* Non-modal: no top layer, so it must place itself. Centred in the viewport by
     default; the layout sheet narrows that to the display area it leaves over. */
  .modal.inline {
    position: fixed;
    inset: 0;
    height: fit-content;
    max-height: 90vh;
    margin: auto;
  }

  .modal::backdrop {
    background: rgba(0, 0, 0, 0.4);
  }
</style>
