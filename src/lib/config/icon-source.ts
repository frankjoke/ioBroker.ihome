// One generic reader for the web adapter's directory listings and for the
// picker pages some icon adapters ship: fetch a base path, take its links, and
// treat slash-terminated ones as folders and image ones as icons.

import { keywordWords } from "$lib/config/icon-library";

export interface SourceEntry {
  /** Site-absolute path (`/icons-freepic/gadgets/`). */
  path: string;
  label: string;
  kind: "folder" | "icon";
}

const ICON_EXT = /\.(svg|png|jpe?g|webp|gif|ico)$/i;

export function parseListing(html: string, baseHref: string): SourceEntry[] {
  const base = new URL(baseHref);
  const seen = new Set<string>();
  const entries: SourceEntry[] = [];
  const attribute = /(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  let match: RegExpExecArray | null;
  while ((match = attribute.exec(html))) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw || raw.startsWith("#") || raw.startsWith("?")) continue;
    // The listing's own parent link.
    if (raw === "." || raw === ".." || raw.startsWith("../")) continue;
    let url: URL;
    try {
      url = new URL(raw, base);
    } catch {
      continue;
    }
    // Only this ioBroker's own files; an external icon link would need its own
    // source.
    if (url.origin !== base.origin) continue;
    const pathname = url.pathname;
    if (!pathname || pathname === base.pathname) continue;
    const folder = pathname.endsWith("/");
    if (!folder && !ICON_EXT.test(pathname)) continue;
    if (seen.has(pathname)) continue;
    const segments = pathname.split("/").filter(Boolean);
    const label = folder
      ? segments[segments.length - 1]
      : (segments[segments.length - 1] ?? "").replace(ICON_EXT, "");
    if (!label) continue;
    seen.add(pathname);
    entries.push({ path: pathname, label, kind: folder ? "folder" : "icon" });
  }
  return entries;
}

function pathSegments(value: string): string[] {
  return String(value ?? "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .split("/")
    .filter(Boolean);
}

/** Keywords are the folder names between the source base and the file. */
export function keywordsFromPath(basePath: string, path: string): string[] {
  const base = pathSegments(basePath);
  const folders = pathSegments(path).slice(0, -1);
  const rest =
    base.length && base.every((segment, index) => folders[index] === segment)
      ? folders.slice(base.length)
      : folders;
  return [...new Set(rest.flatMap((segment) => keywordWords(segment)))];
}

/** The stored form: `adapter/<adapter>/<path>` (what `Icon` resolves). */
export function importValue(_basePath: string, path: string): string {
  let value = String(path ?? "").trim();
  if (/^https?:/i.test(value)) {
    try {
      value = new URL(value).pathname;
    } catch {
      return value;
    }
  }
  value = value.replace(/^\/+/, "");
  return value.startsWith("adapter/") ? value : `adapter/${value}`;
}
