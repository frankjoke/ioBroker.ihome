/** The fixed ioBroker Admin tabs, shown in the cog menu's Plugins group and in
 *  the Plugins page's Pages list. `tab` is the Admin hash route. */

export interface BuiltinPage {
  id: "admin" | "objects" | "enums";
  title: string;
  tab: "overview" | "objects" | "enums";
  meta: string;
  glyph: string;
  svg?: string;
}

/** Admin's own Categories icon: a house for rooms and a bulb for functions,
 *  from `src-admin/src/icons/IconCategories.tsx`. */
export const ENUMS_ICON = `<svg viewBox="0 0 24 24" fill="{{$color}}"><g transform="translate(-1 -1.4) scale(0.78)"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z"/></g><g transform="translate(14.5 13.5) scale(0.42)"><path d="M9 21c0 .5.4 1 1 1h4c.6 0 1-.5 1-1v-1H9zm3-19C8.1 2 5 5.1 5 9c0 2.4 1.2 4.5 3 5.7V17c0 .5.4 1 1 1h6c.6 0 1-.5 1-1v-2.3c1.8-1.3 3-3.4 3-5.7 0-3.9-3.1-7-7-7"/></g></svg>`;

export const BUILTIN_PAGES: readonly BuiltinPage[] = [
  {
    id: "admin",
    title: "Admin",
    tab: "overview",
    meta: "/admin",
    glyph: "settings_applications",
  },
  {
    id: "objects",
    title: "Objects",
    tab: "objects",
    meta: "/admin/#tab-objects",
    glyph: "account_tree",
  },
  {
    id: "enums",
    title: "Enums",
    tab: "enums",
    meta: "/admin/#tab-enums",
    glyph: "category",
    svg: ENUMS_ICON,
  },
];

/** Admin opens at `overview`; the other tabs carry `?tab=` in the hash. */
export function adminPageHref(tab: string, base = ""): string {
  const href = `${base}/#/admin`;
  return tab === "overview" ? href : `${href}?tab=${tab}`;
}
