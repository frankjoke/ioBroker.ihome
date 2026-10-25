/* The layout sheet's open state.
 *
 * Module state, not a handoff: the sheet is a mode of the display, so a reload
 * should come back to the display itself, not to the editor. (The *cursor* the
 * sheet opens on still travels as a handoff, because it crosses a navigation —
 * from the devices page, say — and must survive it.)
 */
import { isUnlocked } from "$lib/config/pin.svelte";
import { layoutNeedsPin } from "$lib/config/settings-ops";
import { getSettings } from "$lib/stores/settings.svelte";

export const sheet = $state<{ open: boolean }>({ open: false });

/* A gated entrance waits here while the PIN is asked — module state too, so a
 * reload drops the ask and the entrance has to be made again. */
let pinAsked = $state(false);

export function openSheet(): void {
  sheet.open = true;
}

export function closeSheet(): void {
  sheet.open = false;
}

/**
 * A fresh entrance into the layout editor: the pencil, or a Ctrl/Cmd+click
 * shortcut. It asks only when the shared settings document turns `lockPencil`
 * on (default off, for the busy installation phase) and this session is still
 * locked. The config routes are gated regardless — their rule lives in
 * +layout.svelte.
 */
export function openSheetGated(): void {
  if (layoutNeedsPin(getSettings().lockPencil, isUnlocked())) {
    pinAsked = true;
    return;
  }
  sheet.open = true;
}

/** True while a gated entrance waits for the PIN — the AppBar shows the ask. */
export function isPinAsked(): boolean {
  return pinAsked;
}

/** The ask is over: `open` opens the editor at whatever target the entrance
 *  already handed over, else the attempt is dropped. */
export function resolvePinAsk(open: boolean): void {
  pinAsked = false;
  if (open) sheet.open = true;
}
