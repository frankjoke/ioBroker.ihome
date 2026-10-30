// @ts-nocheck
import { SvelteSet } from "svelte/reactivity";

// Remembered across StatePicker open/close so adding a sibling state does not
// require re-navigating the tree.
export const pickerFilters = $state({
  adapter: "",
  room: [],
  functions: [],
  type: [],
  role: [],
  search: "",
});

export const pickerExpanded = new SvelteSet();
