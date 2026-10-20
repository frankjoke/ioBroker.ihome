// Icon values are stored as raw strings (A23): either a material-symbols name
// ("lightbulb") or an image — an absolute URL/data URI, a root-relative path, or
// a broker-relative path ("adapter/name.png", served by the ioBroker web server).
import type { PageRegistry, TemplateRegistry } from "$lib/types/display";
import { isImageIcon, ownerOf } from "$lib/config/icon-ops";

/** The footer's host setting, where the app keeps the broker it talks to. */
const HOST_KEY = "__VISUAL__:hostPort";

/** The ioBroker base an icon path hangs off (A66): the configured Host:Port,
 *  else this origin — in production the app is served from `/adapter/ihome/…`,
 *  where root-relative already means the broker. */
export function iconBase(): string {
  const g = globalThis as {
    localStorage?: { getItem(key: string): string | null };
    location?: { origin: string; protocol: string };
  };
  let hostPort = "";
  try {
    const raw = g.localStorage?.getItem(HOST_KEY);
    if (raw) hostPort = String(JSON.parse(raw) ?? "").trim();
  } catch {
    hostPort = "";
  }
  if (!hostPort) return g.location?.origin ?? "";
  return `${g.location?.protocol === "https:" ? "https:" : "http:"}//${hostPort}`;
}

/** The `src` for an image icon (A66): absolutes and data URIs pass through, a
 *  broker path gets the ioBroker base, and a bare filename the file's adapter.
 *  A symbol name is returned untouched — it is not a path. */
export function iconSrc(
  raw: string | undefined,
  owner?: string,
  base?: string,
): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^data:/i.test(value)) return value;
  if (/^(https?:)?\/\//i.test(value)) return value;
  if (!isImageIcon(value)) return value;
  const root = base ?? iconBase();
  // A leading slash is broker-root-relative for a broker value; a document
  // value keeps meaning the app's own origin.
  if (value.startsWith("/")) return owner ? root + value : value;
  if (value.startsWith("adapter/")) return `${root}/${value}`;
  const adapter = owner ? ownerOf(owner).adapter : "";
  return `${root}/${adapter ? `adapter/${adapter}/` : ""}${value}`;
}

/** Every `icon` string anywhere in the two documents, deduped and sorted — the
 *  picker's "document" tab. */
export function collectDocumentIcons(
  reg: PageRegistry,
  templates: TemplateRegistry,
): string[] {
  const found = new Set<string>();
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      // `icon` covers pages, sections and rule icons (A23); `glyph` is the slot
      // icon's own field (A51).
      if (
        (key === "icon" || key === "glyph") &&
        typeof child === "string" &&
        child.trim()
      ) {
        found.add(child.trim());
      }
      walk(child);
    }
  };
  walk(reg);
  walk(templates);
  return [...found].sort();
}
