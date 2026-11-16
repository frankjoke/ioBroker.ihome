// @ts-nocheck
import { SvelteSet } from "svelte/reactivity";

// Remembered across StatePicker open/close so adding a sibling state does not
// require re-navigating the tree.
export const pickerFilters = $state({
  adapter: "",
  room: [],
  functions: [],
  search: "",
});

export const pickerExpanded = new SvelteSet();

const LAST_PICKED_KEY = "iHome.picker.lastPicked";
let handoffTaken = false;

/** Remember the picked state so the next picker opens at its folder. */
export function rememberPickedState(id) {
  handoffTaken = false;
  try {
    globalThis.localStorage?.setItem(LAST_PICKED_KEY, id);
  } catch {
    // Private mode or a full quota: the current open still navigates.
  }
}

/** The state to restore on this picker mount; consumed once per pick. */
export function takePickedState() {
  if (handoffTaken) return "";
  handoffTaken = true;
  try {
    return globalThis.localStorage?.getItem(LAST_PICKED_KEY) ?? "";
  } catch {
    return "";
  }
}
