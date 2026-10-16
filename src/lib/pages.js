/* global sessionStorage */

import { parseLayoutRef } from "$lib/config/layout-ops";

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
  {
    id: "/layout",
    label: "Layout",
    icon: "dashboard_customize",
    title: "Layout",
  },
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

const CONFIG_PLACEMENT_KEY = "iHome.editLayout";

/**
 * Ask the layout editor to open a page, a section or one tile's placement, then
 * navigate.
 *
 * Same `sessionStorage` reasoning as the device handoff above; the value is JSON
 * so the editor can reject anything a stale tab left behind.
 *
 * @param {{ pageId: string, sectionId?: string, placementId?: string }} ref
 */
export function requestLayoutConfig(ref) {
  try {
    sessionStorage.setItem(CONFIG_PLACEMENT_KEY, JSON.stringify(ref));
  } catch {
    /* private mode: the shortcut just navigates without selecting */
  }
}

/** The requested layout target, cleared as it is taken, or null. */
export function takeRequestedLayout() {
  try {
    const raw = sessionStorage.getItem(CONFIG_PLACEMENT_KEY);
    sessionStorage.removeItem(CONFIG_PLACEMENT_KEY);
    return parseLayoutRef(raw);
  } catch {
    return null;
  }
}

/**
 * The pending layout target without taking it. The devices page uses it to
 * offer the way back to the tile it was opened from; the layout route still
 * takes (and clears) the value on arrival.
 */
export function peekRequestedLayout() {
  try {
    return parseLayoutRef(sessionStorage.getItem(CONFIG_PLACEMENT_KEY));
  } catch {
    return null;
  }
}
