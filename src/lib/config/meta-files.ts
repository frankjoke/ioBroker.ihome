// The shared meta file space (`ihome.meta`): one thin IO layer over the web
// adapter's file commands. Reads prefer HTTP (cacheable, same-origin); a dev
// page is another origin and the web adapter sends no CORS headers, so reads
// fall back to the socket there. Writes always go over a dedicated socket.
// Tests inject a transport instead of a real socket.

import { ioBroker } from "$lib/ioBrokerConnect.svelte.js";
import { loadIo2Client } from "$lib/socket-client";
import { iconBase, iconSrc } from "$lib/utils/icon-url";

export const META_ADAPTER = "ihome.meta";

export interface MetaTransport {
  call(event: string, ...args: unknown[]): Promise<unknown>;
}

type FileSocket = {
  emit: (event: string, ...args: unknown[]) => void;
  on: (event: string, handler: (...args: unknown[]) => void) => void;
  disconnect: () => void;
};

let injected: MetaTransport | null = null;

/** Tests: replace the socket with a fake. Pass null to restore. */
export function setMetaTransport(transport: MetaTransport | null): void {
  injected = transport;
  fileSocket = null;
  fileSocketPromise = null;
}

let fileSocket: FileSocket | null = null;
let fileSocketPromise: Promise<FileSocket | null> | null = null;

/** The dev server has no socket.io client; the broker does. Load it there. */
async function loadBrokerClient(): Promise<{
  connect: (url: string, options?: object) => FileSocket;
} | null> {
  const root = iconBase();
  const browserDoc = globalThis.document;
  if (!root || !browserDoc) return null;
  return await new Promise((resolve) => {
    try {
      const frame = browserDoc.createElement("iframe");
      frame.style.display = "none";
      browserDoc.body.append(frame);
      const doc = frame.contentDocument;
      if (!doc) {
        resolve(null);
        return;
      }
      const script = doc.createElement("script");
      script.src = new URL("/lib/js/socket.io.js", root).href;
      script.onload = () =>
        resolve(
          (frame.contentWindow as { io?: { connect: () => FileSocket } } | null)
            ?.io ?? null,
        );
      script.onerror = () => resolve(null);
      doc.head.append(script);
    } catch {
      resolve(null);
    }
  });
}

async function openFileSocket(): Promise<FileSocket | null> {
  fileSocketPromise ??= (async () => {
    const client =
      ((await loadIo2Client()) as {
        connect: (url: string, options?: object) => FileSocket;
      } | null) ?? (await loadBrokerClient());
    if (!client) return null;
    const origin = iconBase() || globalThis.location?.origin || "";
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

/** One file command over the dedicated socket, falling back to the app's. */
export async function metaCall(
  event: string,
  ...args: unknown[]
): Promise<unknown> {
  if (injected) return await injected.call(event, ...args);
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
  } catch {
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

function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** The HTTP URL of one file (`/ihome.meta/icons/x.svg`). */
export function metaHttpUrl(adapter: string, path: string): string {
  return iconSrc(`/${adapter}/${String(path).replace(/^\/+/, "")}`);
}

export async function writeMetaText(
  adapter: string,
  path: string,
  text: string,
): Promise<void> {
  await metaCall("writeFile", adapter, path, text);
}

export async function writeMetaBinary(
  adapter: string,
  path: string,
  bytes: ArrayBuffer,
): Promise<void> {
  await metaCall("writeFile64", adapter, path, base64Of(bytes));
}

/** Read one text file; null when absent or unreadable. */
export async function readMetaText(
  adapter: string,
  path: string,
): Promise<string | null> {
  const pageOrigin = globalThis.location?.origin ?? "http://localhost";
  const url = new URL(metaHttpUrl(adapter, path), pageOrigin);
  if (url.origin !== globalThis.location?.origin) {
    try {
      const data = await metaCall("readFile", adapter, path);
      return typeof data === "string" && data.length ? data : null;
    } catch {
      return null;
    }
  }
  try {
    const response = await fetch(`${url.href}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${response.status}`);
    return await response.text();
  } catch {
    return null;
  }
}

/** One directory of the space; empty when it does not exist. */
export async function listMetaDir(
  adapter: string,
  path: string,
): Promise<{ name: string; isDir: boolean }[]> {
  try {
    const rows = (await metaCall("readDir", adapter, path)) as
      { file?: string; isDir?: boolean }[] | undefined;
    if (!Array.isArray(rows)) return [];
    return rows
      .filter((row) => typeof row.file === "string" && row.file)
      .map((row) => ({ name: row.file as string, isDir: row.isDir === true }));
  } catch {
    return [];
  }
}

export async function deleteMetaFile(
  adapter: string,
  path: string,
): Promise<void> {
  await metaCall("deleteFile", adapter, path);
}

/** Write text and prove it by reading it back; one retry, then an error. */
export async function verifiedWrite(
  adapter: string,
  path: string,
  text: string,
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    await writeMetaText(adapter, path, text);
    const back = await readMetaText(adapter, path);
    if (back === text) return;
  }
  throw new Error(`the file did not verify after writing: ${adapter}/${path}`);
}
