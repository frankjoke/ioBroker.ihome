import { it, expect, vi } from "vitest";

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { emitAsync: vi.fn(async () => undefined) },
}));
import {
  deleteMetaFile,
  listMetaDir,
  metaHttpUrl,
  readMetaText,
  setMetaTransport,
  verifiedWrite,
  writeMetaText,
} from "$lib/config/meta-files";

function transport(handler: (event: string, args: unknown[]) => unknown) {
  const calls: { event: string; args: unknown[] }[] = [];
  setMetaTransport({
    async call(event, ...args) {
      calls.push({ event, args });
      return await handler(event, args);
    },
  });
  return calls;
}

it("builds the HTTP URL of a file", () => {
  expect(metaHttpUrl("ihome.meta", "icons/x.svg")).toMatch(
    /\/ihome\.meta\/icons\/x\.svg$/,
  );
  expect(metaHttpUrl("ihome.meta", "/templates/a.json")).toMatch(
    /\/ihome\.meta\/templates\/a\.json$/,
  );
});

it("lists a directory through readDir", async () => {
  const calls = transport((event) => {
    if (event !== "readDir") return undefined;
    return [
      { file: "device", isDir: true },
      { file: "a.json", isDir: false },
      { file: "", isDir: false },
    ];
  });
  expect(await listMetaDir("ihome.meta", "templates")).toEqual([
    { name: "device", isDir: true },
    { name: "a.json", isDir: false },
  ]);
  expect(calls[0]).toEqual({
    event: "readDir",
    args: ["ihome.meta", "templates"],
  });
  setMetaTransport(null);
});

it("reports a folder it cannot read instead of pretending it is empty", async () => {
  transport(() => {
    throw new Error("denied");
  });
  await expect(listMetaDir("ihome.meta", "plugins")).rejects.toThrow("denied");
  setMetaTransport(null);
});

it("reads text and returns null on failure", async () => {
  transport((event) => (event === "readFile" ? "content" : undefined));
  expect(await readMetaText("ihome.meta", "a.txt")).toBe("content");
  transport(() => {
    throw new Error("nope");
  });
  expect(await readMetaText("ihome.meta", "a.txt")).toBeNull();
  setMetaTransport(null);
});

it("deletes through deleteFile", async () => {
  const calls = transport(() => undefined);
  await deleteMetaFile("ihome.meta", "a.txt");
  expect(calls[0].event).toBe("deleteFile");
  setMetaTransport(null);
});

it("verifiedWrite retries a corrupt read-back once, then succeeds", async () => {
  let reads = 0;
  const writes: string[] = [];
  transport((event, args) => {
    if (event === "writeFile") {
      writes.push(String(args[2]));
      return undefined;
    }
    if (event === "readFile") {
      reads += 1;
      // 1: the previous text, 2: the corrupt read-back, 3: the retry.
      if (reads === 2) return "garbage";
      return reads === 1 ? "old" : "payload";
    }
    return undefined;
  });
  await verifiedWrite("ihome.meta", "a.json", "payload");
  expect(writes).toEqual(["payload", "payload"]);
  setMetaTransport(null);
});

it("restores the previous text when the write never verifies", async () => {
  const files: Record<string, string> = { "a.json": "old" };
  let writes = 0;
  transport((event, args) => {
    if (event === "writeFile") {
      writes += 1;
      const path = String(args[1]);
      // The two attempts land corrupted; the restore write lands fine.
      files[path] = writes <= 2 ? "garbage" : String(args[2]);
      return undefined;
    }
    if (event === "readFile") {
      const path = String(args[1]);
      if (!(path in files)) throw new Error("Not exists");
      return files[path];
    }
    return undefined;
  });
  await expect(verifiedWrite("ihome.meta", "a.json", "new")).rejects.toThrow(
    /did not verify/,
  );
  expect(files["a.json"]).toBe("old");
  setMetaTransport(null);
  vi.restoreAllMocks();
});

it("verifiedWrite throws when the read-back never matches", async () => {
  const writes: string[] = [];
  transport((event, args) => {
    if (event === "writeFile") {
      writes.push(String(args[2]));
      return undefined;
    }
    if (event === "readFile") return "garbage";
    return undefined;
  });
  await expect(
    verifiedWrite("ihome.meta", "a.json", "payload"),
  ).rejects.toThrow(/did not verify/);
  // Two attempts plus the best-effort restore of the previous text.
  expect(writes).toHaveLength(3);
  setMetaTransport(null);
  vi.restoreAllMocks();
});

it("writes text through writeFile with the adapter and path", async () => {
  const calls = transport(() => undefined);
  await writeMetaText("ihome.meta", "templates/a.json", "{}");
  expect(calls[0]).toEqual({
    event: "writeFile",
    args: ["ihome.meta", "templates/a.json", "{}"],
  });
  setMetaTransport(null);
});
