/** The user-managed page list under the cog menu's Plugins group. */

export const PLUGIN_PAGES_VERSION = 1;
export const PLUGIN_PAGE_MAX_TITLE = 64;
export const PLUGIN_PAGE_MAX_ICON = 64;
export const PLUGIN_PAGE_MAX_URL = 512;

export type PluginPageOpen = "embed" | "tab";

export interface PluginPageEntry {
  id: string;
  title: string;
  icon: string;
  /** Root-relative (`/iqontrol/…`) or absolute `http(s)://…`. */
  url: string;
  open: PluginPageOpen;
}

export interface PluginPagesDocument {
  version: typeof PLUGIN_PAGES_VERSION;
  pages: PluginPageEntry[];
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;

function record(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function emptyPluginPages(): PluginPagesDocument {
  return { version: PLUGIN_PAGES_VERSION, pages: [] };
}

/** A page URL is a root-relative path or an absolute http(s) URL. */
export function validPluginPageUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const url = value.trim();
  if (!url || url.length > PLUGIN_PAGE_MAX_URL) return undefined;
  if (!url.startsWith("/") && !/^https?:\/\//i.test(url)) return undefined;
  return url;
}

/** The hash route of an embedded page: `#/plugin/<id>`. */
export function pluginPageHref(id: string, base = ""): string {
  return `${base}/#/plugin/${id}`;
}

function entryOf(value: unknown): PluginPageEntry | null {
  if (!record(value)) return null;
  const id = typeof value.id === "string" ? value.id.trim() : "";
  if (!ID.test(id)) return null;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!title || title.length > PLUGIN_PAGE_MAX_TITLE) return null;
  const url = validPluginPageUrl(value.url);
  if (!url) return null;
  const icon =
    typeof value.icon === "string" && value.icon.trim()
      ? value.icon.trim().slice(0, PLUGIN_PAGE_MAX_ICON)
      : "web_asset";
  if (
    value.open !== undefined &&
    value.open !== "embed" &&
    value.open !== "tab"
  ) {
    return null;
  }
  const open: PluginPageOpen = value.open === "tab" ? "tab" : "embed";
  return { id, title, icon, url, open };
}

/** Strict parse; null means unreadable/newer, never overwrite it. */
export function parsePluginPages(raw: unknown): PluginPagesDocument | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!record(value) || value.version !== PLUGIN_PAGES_VERSION) return null;
  if (!Array.isArray(value.pages)) return null;
  const pages: PluginPageEntry[] = [];
  const ids = new Set<string>();
  for (const item of value.pages) {
    const entry = entryOf(item);
    if (!entry || ids.has(entry.id)) return null;
    ids.add(entry.id);
    pages.push(entry);
  }
  return { version: PLUGIN_PAGES_VERSION, pages };
}
