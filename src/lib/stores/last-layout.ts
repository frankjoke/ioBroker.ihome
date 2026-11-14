import { parseLayoutRef, type LayoutSelection } from "$lib/config/layout-ops";

/** The last page/section/tile the layout editor had open, kept per browser so
 *  entering the editor can resume there after a reload. */
const KEY = "iHome.lastLayout";

export function readLastLayout(): LayoutSelection | null {
  try {
    return parseLayoutRef(globalThis.localStorage?.getItem(KEY));
  } catch {
    return null;
  }
}

export function writeLastLayout(selection: LayoutSelection | null): void {
  try {
    if (selection) {
      globalThis.localStorage?.setItem(KEY, JSON.stringify(selection));
    } else {
      globalThis.localStorage?.removeItem(KEY);
    }
  } catch {
    /* private mode: the editor still remembers within the session */
  }
}
