// Icon values are stored as raw strings (A23): either a material-symbols name
// ("lightbulb") or an image — an absolute URL/data URI, a root-relative path, or
// a broker-relative path ("adapter/name.png", served by the ioBroker web server).
import type { PageRegistry, TemplateRegistry } from "$lib/types/display";

/** Is this icon value an image (URL, root-relative path, broker-relative path
 *  like `adapter/name.png`) rather than a material-symbols name? */
export function isImageIcon(raw: string | undefined): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return false;
  // A symbol name is snake_case and never contains a path separator.
  if (value.includes("/")) return true;
  return /\.(png|jpe?g|gif|svg|webp|ico|bmp|avif)([?#].*)?$/i.test(value);
}

/** The `src` for an image icon (root-relative values get the leading slash). */
export function iconUrl(raw: string | undefined): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (/^(https?:)?\/\//i.test(value)) return value;
  if (/^data:/i.test(value)) return value;
  if (value.startsWith("/")) return value;
  return `/${value}`;
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
      // `icon` covers pages, sections, icon slots and rule icons (A23); `glyph`
      // is the slot icon's own field (A51).
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
