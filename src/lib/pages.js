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
