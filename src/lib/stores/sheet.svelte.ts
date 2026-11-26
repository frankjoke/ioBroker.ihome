/* The layout sheet's open state.
 *
 * Module state, not a handoff: the sheet is a mode of the display, so a reload
 * should come back to the display itself, not to the editor. (The *cursor* the
 * sheet opens on still travels as a handoff, because it crosses a navigation —
 * from the devices page, say — and must survive it.)
 */
import { isUnlocked } from "$lib/config/pin.svelte";
import { layoutNeedsPin } from "$lib/config/settings-ops";
import { getSettings, isSettingsLoaded } from "$lib/stores/settings.svelte";
import type { LayoutSelection } from "$lib/config/layout-ops";

export const sheet = $state<{
  open: boolean;
  /** What the sheet was editing when it closed: the eye/pencil toggle keeps
   *  the tile the user was on, not the first one of the page. */
  selection: LayoutSelection | null;
  /** An eye-view "Add tile" request for the sheet to open the picker. */
  addTileAt: { pageId: string; sectionId: string; at?: number } | null;
}>({ open: false, selection: null, addTileAt: null });

/* A gated entrance waits here while the PIN is asked — module state too, so a
 * reload drops the ask and the entrance has to be made again. */
let pinAsked = $state(false);
let pinTitle = $state("Enter PIN for the layout editor");
let pendingAction: (() => void) | null = null;

export function openSheet(): void {
  sheet.open = true;
}

export function closeSheet(): void {
  sheet.open = false;
  sheet.addTileAt = null;
}

/**
 * A fresh entrance into the layout editor: the pencil, or a Ctrl/Cmd+click
 * shortcut. It asks when the shared settings document turns `lockPencil` on
 * (default off, for the busy installation phase) and this session is still
 * locked. Until that document has been read there is no flag to trust, so the
 * entrance asks — otherwise a quick click after a reload would walk past the
 * lock. The config routes are gated regardless; their rule lives in
 * +layout.svelte.
 */
export function openSheetGated(): void {
  runSheetGated(() => {
    sheet.open = true;
  });
}

/** Open the sheet for an eye-view "Add tile" request: the sheet consumes the
 *  target on mount and opens its existing source/template picker there. */
export function openSheetForNewTile(target: {
  pageId: string;
  sectionId: string;
  at?: number;
}): void {
  sheet.addTileAt = target;
  openSheetGated();
}

/**
 * Run a layout write behind the same pencil lock. A destructive display action
 * (delete) uses this without opening the sheet; `title` labels its PIN ask.
 */
export function runSheetGated(
  action: () => void,
  title = "Enter PIN for the layout editor",
): void {
  const lockPencil = isSettingsLoaded() ? getSettings().lockPencil : true;
  if (layoutNeedsPin(lockPencil, isUnlocked())) {
    pendingAction = action;
    pinTitle = title;
    pinAsked = true;
    return;
  }
  action();
}

/** True while a gated entrance waits for the PIN — the AppBar shows the ask. */
export function isPinAsked(): boolean {
  return pinAsked;
}

/** The PIN prompt's heading, naming the action that is waiting. */
export function pinAskTitle(): string {
  return pinTitle;
}

/** The ask is over: `open` runs the waiting action, else the attempt is
 *  dropped. The pending action is cleared before it runs, so a second resolve
 *  cannot repeat a delete. */
export function resolvePinAsk(open: boolean): void {
  pinAsked = false;
  const action = pendingAction;
  pendingAction = null;
  if (!open) {
    sheet.addTileAt = null;
    return;
  }
  action?.();
}
