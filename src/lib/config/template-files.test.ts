import { it, expect, vi, beforeEach } from "vitest";

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: { emitAsync: vi.fn(async () => undefined) },
}));

import { setMetaTransport } from "$lib/config/meta-files";
import {
  deleteTemplate,
  listTemplates,
  parseTemplateMetaPath,
  readTemplate,
  templateIdFromFile,
  templateMetaPath,
  writeTemplate,
} from "$lib/config/template-files";
import { PRESETS } from "$lib/config/presets";
import { serializeTemplateFile, templateFile } from "$lib/config/template-file";

const deviceFile = templateFile("device", PRESETS.Light);
const validText = serializeTemplateFile(deviceFile);

/** A fake file space: `key = "<adapter>/<path>"`. */
function files(initial: Record<string, string>) {
  const store = new Map(Object.entries(initial));
  const calls: { event: string; args: unknown[] }[] = [];
  setMetaTransport({
    async call(event, ...args) {
      calls.push({ event, args });
      const key = `${String(args[0])}/${String(args[1] ?? "")}`;
      if (event === "readDir") {
        const prefix = `${key}/`;
        const names = new Set<string>();
        for (const path of store.keys()) {
          if (!path.startsWith(prefix)) continue;
          const rest = path.slice(prefix.length);
          names.add(rest.split("/")[0]);
        }
        return [...names].map((name) => ({
          file: name,
          isDir: [...store.keys()].some((path) =>
            path.startsWith(`${prefix}${name}/`),
          ),
        }));
      }
      if (event === "readFile") {
        if (!store.has(key)) throw new Error("Not exists");
        return store.get(key);
      }
      if (event === "writeFile") {
        store.set(key, String(args[2] ?? ""));
        return undefined;
      }
      if (event === "deleteFile") {
        store.delete(key);
        return undefined;
      }
      return undefined;
    },
  });
  return { store, calls };
}

beforeEach(() => setMetaTransport(null));

it("builds and parses paths", () => {
  expect(templateMetaPath("device", "lamp-1")).toBe(
    "templates/device/lamp-1.json",
  );
  expect(parseTemplateMetaPath("templates/device/lamp-1.json")).toEqual({
    kind: "device",
    id: "lamp-1",
  });
  expect(parseTemplateMetaPath("templates/unknown/x.json")).toBeNull();
  expect(parseTemplateMetaPath("templates/device/bad id.json")).toBeNull();
});

it("takes ids from file names only", () => {
  expect(templateIdFromFile("lamp-1.json")).toBe("lamp-1");
  expect(templateIdFromFile("lamp-1.txt")).toBeNull();
  expect(templateIdFromFile("bad id.json")).toBeNull();
});

it("writes one template file and deletes it", async () => {
  const { store, calls } = files({});
  await writeTemplate("device", "light-1", deviceFile);
  expect(store.get("ihome.meta/templates/device/light-1.json")).toBe(validText);
  expect(calls.some((call) => call.event === "writeFile")).toBe(true);

  await deleteTemplate("device", "light-1");
  expect(store.has("ihome.meta/templates/device/light-1.json")).toBe(false);
});

it("lists every readable file and marks a corrupt one", async () => {
  files({
    "ihome.meta/templates/device/b.json": validText,
    "ihome.meta/templates/device/a.json": validText,
    "ihome.meta/templates/device/broken.json": "{not json",
    "ihome.meta/templates/device/notes.txt": "ignore me",
  });
  const rows = await listTemplates("device");
  expect(rows.map((row) => row.id)).toEqual(["a", "b", "broken"]);
  expect(rows.find((row) => row.id === "broken")?.error).toMatch(
    /not a readable/,
  );
  expect(rows.find((row) => row.id === "a")?.file?.kind).toBe("device");
});

it("ignores a file filed under the wrong kind", async () => {
  // A valid device template dropped into the logic folder.
  files({ "ihome.meta/templates/logic/mix.json": validText });
  const rows = await listTemplates("logic");
  expect(rows.map((row) => row.id)).toEqual(["mix"]);
  expect(rows[0].file).toBeNull();
  expect(await readTemplate("logic", "mix")).toBeNull();
});

it("takes the template id from the file name, not the definition", async () => {
  const original = templateFile("device", PRESETS.Light);
  const copied = serializeTemplateFile({
    ...original,
    definition: { ...(original.definition as object), id: "other" },
  });
  files({ "ihome.meta/templates/device/file-id.json": copied });
  const read = await readTemplate("device", "file-id");
  expect((read?.definition as { id?: string } | undefined)?.id).toBe("file-id");
});

it("refuses to write a file name that is not a valid id", async () => {
  files({});
  await expect(
    writeTemplate("device", "my lamp", templateFile("device", PRESETS.Light)),
  ).rejects.toThrow(/invalid template id/);
});

it("reads a valid file and returns null for junk", async () => {
  files({
    "ihome.meta/templates/device/a.json": validText,
    "ihome.meta/templates/device/junk.json": "[]",
  });
  expect((await readTemplate("device", "a"))?.kind).toBe("device");
  expect(await readTemplate("device", "junk")).toBeNull();
  expect(await readTemplate("device", "missing")).toBeNull();
});
