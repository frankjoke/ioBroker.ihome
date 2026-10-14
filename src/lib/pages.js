/**
 * Programmatic page registry — the header tab bar is rendered from this
 * list. To add a page: append an entry here and create a matching route
 * at `src/routes/<id>/+page.svelte`.
 *
 * @typedef {{
 *   id: string,
 *   label: string,
 *   icon: string,
 *   title: string
 * }} Page
 */

/** @type {Page[]} */
export const pages = [
  { id: "/devices", label: "Devices", icon: "devices", title: "Devices" },
];

/**
 * Hash-route for a page id (`/` → `#/`).
 * @param {string} id
 * @param {string} base
 */
export function pageHref(id, base = "") {
  return `${base}/#${id}`;
}

const CONFIG_EDIT_KEY = "iHome.edit";

/**
 * Ask the config to open a device's form, then navigate.
 *
 * Deliberately `sessionStorage` and not module state: Vite can hand a hot-reloaded
 * module to two importers as two instances (the history store was bitten by
 * exactly that), and the display must not care which copy the config reads.
 */
export function requestDeviceConfig(id) {
  try {
    sessionStorage.setItem(CONFIG_EDIT_KEY, id);
  } catch {
    /* private mode: the shortcut just navigates without opening the form */
  }
}

/** The requested device id, cleared as it is taken. */
export function takeRequestedDeviceConfig() {
  try {
    const id = sessionStorage.getItem(CONFIG_EDIT_KEY) || "";
    sessionStorage.removeItem(CONFIG_EDIT_KEY);
    return id;
  } catch {
    return "";
  }
}

/** Should this click open the device config instead of the tile's own action? */
export function wantsDeviceConfig(event) {
  return !!(event?.metaKey || event?.ctrlKey);
}
