// The shared image space. Content lives as files under `ihome.meta` so the
// library document stays small and every instance reads the same files; the
// library JSON itself also lives here. Reads use HTTP (cacheable), writes use
// the web adapter's file commands over the open socket.

import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { loadIo2Client } from "$lib/socket-client";

export const META_ADAPTER = "ihome.meta";
export const ICON_DIR = "icons";
export const LIBRARY_FILE = "icons/library.json";
export const META_PREFIX = "/ihome.meta/icons/";

type FileSocket = {
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect: () => void;
};

/** A dedicated connection for file commands: the app's shared socket has been
 *  seen to turn a large text payload into binary, this one is proven clean. */
let fileSocket: FileSocket | null = null;
let fileSocketPromise: Promise<FileSocket | null> | null = null;

async function openFileSocket(): Promise<FileSocket | null> {
  fileSocketPromise ??= (async () => {
    const client = (await loadIo2Client()) as {
      connect: (url: string, options?: object) => FileSocket;
    } | null;
    if (!client) return null;
    const origin = globalThis.location?.origin ?? "";
    const socket = client.connect(origin, {
      query: "key=nokey",
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("file socket timeout")),
        5000,
      );
      socket.on("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.on("connect_error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    return socket;
  })().catch(() => null);
  fileSocket = await fileSocketPromise;
  return fileSocket;
}

async function fileCall(event: string, ...args: unknown[]): Promise<unknown> {
  const socket = await openFileSocket();
  if (!socket) return await ioBroker.emitAsync(event, ...args);
  try {
    return await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`file call timeout: ${event}`)),
        15000,
      );
      socket.emit(event, ...args, (error: unknown, data: unknown) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(data);
      });
    });
  } catch (error) {
    // Fall back to the app socket; a broken dedicated socket must not block.
    fileSocket = null;
    fileSocketPromise = null;
    try {
      socket.disconnect();
    } catch {
      // already gone
    }
    return await ioBroker.emitAsync(event, ...args);
  }
}

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

function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
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

async function writeFile(
  path: string,
  content: { text?: string; bytes?: ArrayBuffer },
): Promise<void> {
  if (content.text !== undefined) {
    await fileCall("writeFile", META_ADAPTER, path, content.text);
    return;
  }
  await fileCall(
    "writeFile64",
    META_ADAPTER,
    path,
    base64Of(content.bytes ?? new ArrayBuffer(0)),
  );
}

/** Store one local file; returns its `/ihome.meta/icons/…` value. */
export async function writeIconFile(
  file: File,
  name = file.name,
): Promise<string> {
  const content = await readContent(file);
  const fileName = await iconFileName(name, content.text ?? content.bytes!);
  await writeFile(`${ICON_DIR}/${fileName}`, content);
  return `${META_PREFIX}${fileName}`;
}

/** Copy a remote image into the shared space; null when it cannot be read. */
export async function copyIconFile(
  url: string,
  name: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      new URL(url, globalThis.document?.baseURI ?? url),
    );
    if (!response.ok) return null;
    const blob = await response.blob();
    const bytes = await blob.arrayBuffer();
    const fileName = await iconFileName(name, bytes);
    await writeFile(`${ICON_DIR}/${fileName}`, { bytes });
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
    await fileCall("deleteFile", META_ADAPTER, path);
  } catch {
    // The row is gone either way; a leftover file is recoverable.
  }
}

/** Fetch the library document from the shared space; null when absent. */
export async function readLibraryFile(): Promise<string | null> {
  try {
    const response = await fetch(`${META_PREFIX}library.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.text();
  } catch {
    return null;
  }
}

export async function writeLibraryFile(json: string): Promise<void> {
  const text = typeof json === "string" ? json : JSON.stringify(json);
  for (let attempt = 0; attempt < 2; attempt++) {
    await fileCall("writeFile", META_ADAPTER, LIBRARY_FILE, text);
    // The socket can lose a large text payload now and then; verify the
    // stored bytes and write once more rather than persist a broken document.
    try {
      const back = await fileCall("readFile", META_ADAPTER, LIBRARY_FILE);
      if (back === text) return;
    } catch {
      // A failed check is not a proven failure; retry the write.
    }
  }
  throw new Error("the icon library file did not verify after writing");
}

export function mimeOf(name: string): string | undefined {
  return MIME[extensionOf(name)];
}
