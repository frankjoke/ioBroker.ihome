/* The layout sheet's open state.
 *
 * Module state, not a handoff: the sheet is a mode of the display, so a reload
 * should come back to the display itself, not to the editor. (The *cursor* the
 * sheet opens on still travels as a handoff, because it crosses a navigation —
 * from the devices page, say — and must survive it.)
 */
import { isUnlocked } from "$lib/config/pin.svelte";

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
 * shortcut. While this session is still locked the ask opens instead of the
 * sheet — the editor changes the configuration, so it sits behind the same PIN
 * as the config pages.
 */
export function openSheetGated(): void {
  if (!isUnlocked()) {
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
