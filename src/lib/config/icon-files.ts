// The shared image space: icons/uploads live as files under `ihome.meta`, the
// icon library mirrors its document there. The file IO itself is `meta-files`;
// this module only knows icon naming and the library paths.

import {
  META_ADAPTER,
  deleteMetaFile,
  readMetaText,
  writeMetaBinary,
  writeMetaText,
} from "$lib/config/meta-files";
import { iconSrc } from "$lib/utils/icon-url";

export { META_ADAPTER };

export const ICON_DIR = "icons";
export const LIBRARY_FILE = "icons/library.json";
export const META_PREFIX = "/ihome.meta/icons/";

const TEXT_EXT = /^(svg|html?|txt|json)$/i;
const MIME: Record<string, string> = {
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
};

/** A value that points into the shared icon space. */
export function isMetaIconValue(value: string): boolean {
  return String(value ?? "").startsWith(META_PREFIX);
}

/** `/ihome.meta/icons/a.svg` → `icons/a.svg` (the path the file API wants). */
export function metaPathFor(value: string): string | undefined {
  return isMetaIconValue(value)
    ? `${ICON_DIR}/${value.slice(META_PREFIX.length)}`
    : undefined;
}

export function extensionOf(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

/** FNV-1a twice (forward and backward): deterministic, works on plain HTTP. */
function contentHash(bytes: Uint8Array): string {
  let forward = 0x811c9dc5;
  for (const byte of bytes) {
    forward ^= byte;
    forward = Math.imul(forward, 0x01000193) >>> 0;
  }
  let backward = 0x811c9dc5 ^ bytes.length;
  for (let i = bytes.length - 1; i >= 0; i--) {
    backward ^= bytes[i];
    backward = Math.imul(backward, 0x01000193) >>> 0;
  }
  return (
    forward.toString(16).padStart(8, "0") +
    backward.toString(16).padStart(8, "0")
  ).slice(0, 8);
}

/** Content-addressed, human-readable: `<8 hex>-<slug>.<ext>`. */
export async function iconFileName(
  name: string,
  content: ArrayBuffer | string,
): Promise<string> {
  const bytes =
    typeof content === "string"
      ? new TextEncoder().encode(content)
      : new Uint8Array(content);
  const hash = contentHash(bytes);
  const extension =
    extensionOf(name) || (typeof content === "string" ? "txt" : "bin");
  return `${hash}-${slug(name) || "icon"}.${extension}`;
}

/** Read the file bytes or text, depending on its type. */
async function readContent(
  file: File,
): Promise<{ name: string; text?: string; bytes?: ArrayBuffer }> {
  const extension = extensionOf(file.name);
  if (TEXT_EXT.test(extension)) {
    return { name: file.name, text: await file.text() };
  }
  return { name: file.name, bytes: await file.arrayBuffer() };
}

/** Store one local file; returns its `/ihome.meta/icons/…` value. */
export async function writeIconFile(
  file: File,
  name = file.name,
): Promise<string> {
  const content = await readContent(file);
  const fileName = await iconFileName(name, content.text ?? content.bytes!);
  const path = `${ICON_DIR}/${fileName}`;
  if (content.text !== undefined) {
    await writeMetaText(META_ADAPTER, path, content.text);
  } else {
    await writeMetaBinary(META_ADAPTER, path, content.bytes!);
  }
  return `${META_PREFIX}${fileName}`;
}

/** Copy a remote image into the shared space; null when it cannot be read. */
export async function copyIconFile(
  url: string,
  name: string,
): Promise<string | null> {
  try {
    const response = await fetch(iconSrc(url));
    if (!response.ok) return null;
    const blob = await response.blob();
    const bytes = await blob.arrayBuffer();
    // The label carries no extension; the URL does. Without it the file would
    // be served as octet-stream and named `x.<whole-name>`.
    const extension = extensionOf(new URL(iconSrc(url)).pathname);
    const fileName = await iconFileName(
      extension ? `${name}.${extension}` : name,
      bytes,
    );
    await writeMetaBinary(META_ADAPTER, `${ICON_DIR}/${fileName}`, bytes);
    return `${META_PREFIX}${fileName}`;
  } catch {
    return null;
  }
}

/** Delete the file behind a library value; ignores data URIs and failures. */
export async function deleteIconFile(value: string): Promise<void> {
  const path = metaPathFor(value);
  if (!path) return;
  try {
    await deleteMetaFile(META_ADAPTER, path);
  } catch {
    // The row is gone either way; a leftover file is recoverable.
  }
}

/** Fetch the library document from the shared space; null when absent. */
export function readLibraryFile(): Promise<string | null> {
  return readMetaText(META_ADAPTER, LIBRARY_FILE);
}

export function writeLibraryFile(json: string): Promise<void> {
  const text = typeof json === "string" ? json : JSON.stringify(json);
  return writeMetaText(META_ADAPTER, LIBRARY_FILE, text);
}

export function mimeOf(name: string): string | undefined {
  return MIME[extensionOf(name)];
}
