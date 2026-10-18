/* The layout sheet's open state.
 *
 * Module state, not a handoff: the sheet is a mode of the display, so a reload
 * should come back to the display itself, not to the editor. (The *cursor* the
 * sheet opens on still travels as a handoff, because it crosses a navigation —
 * from the devices page, say — and must survive it.)
 */
export const sheet = $state<{ open: boolean }>({ open: false });

export function openSheet(): void {
  sheet.open = true;
}

export function closeSheet(): void {
  sheet.open = false;
}
