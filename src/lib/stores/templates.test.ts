import { it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  legacy: null as unknown,
  writes: [] as string[],
  deletes: [] as string[],
}));

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    connected: true,
    wait: vi.fn(async () => {}),
    emitAsync: vi.fn(async () => undefined),
    getState: vi.fn(async () =>
      h.legacy === null ? null : { value: h.legacy },
    ),
    setState: vi.fn(async () => undefined),
  },
}));
vi.mock("$lib/stores/devices.svelte", () => ({
  registerProgramStateId: vi.fn(),
}));
vi.mock("$lib/stores/variables.svelte", () => ({
  getVariableLibrary: () => ({ variables: [] }),
}));
vi.mock("$lib/stores/settings.svelte", () => ({
  getSettings: () => ({}),
}));

import { serializeTemplateFile, templateFile } from "$lib/config/template-file";
import { PRESETS } from "$lib/config/presets";

const device = templateFile("device", PRESETS.Light);

/** A fake `ihome.meta` with read/write/delete/readDir. */
function space(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return store;
}

function transportFor(store: Map<string, string>) {
  return {
    async call(event: string, ...args: unknown[]) {
      const key = `${String(args[0])}/${String(args[1] ?? "")}`;
      if (event === "readDir") {
        const prefix = `${key}/`;
        const names = new Set<string>();
        for (const path of store.keys()) {
          if (!path.startsWith(prefix)) continue;
          names.add(path.slice(prefix.length).split("/")[0]);
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
        h.writes.push(key);
        return undefined;
      }
      if (event === "deleteFile") {
        store.delete(key);
        h.deletes.push(key);
        return undefined;
      }
      return undefined;
    },
  };
}

/** Fresh store module wired to one fake space. */
async function store(spaceMap: Map<string, string>) {
  vi.resetModules();
  // The transport lives on the freshly imported module instance.
  const meta = await import("$lib/config/meta-files");
  meta.setMetaTransport(transportFor(spaceMap));
  const mod = await import("./templates.svelte");
  await mod.initTemplates();
  return mod;
}

beforeEach(() => {
  h.legacy = null;
  h.writes.length = 0;
  h.deletes.length = 0;
});

it("loads templates from the folder", async () => {
  const mod = await store(
    space({
      "ihome.meta/templates/device/light.json": serializeTemplateFile(device),
    }),
  );
  expect(mod.isTemplatesWritable()).toBe(true);
  expect(mod.getTemplateRegistry().templates.map((t) => t.id)).toEqual([
    "Light",
  ]);
});

it("migrates the legacy state into files once", async () => {
  h.legacy = JSON.stringify({
    version: 1,
    updatedAt: 1,
    templates: [PRESETS.Light],
  });
  const mod = await store(space({}));
  expect(mod.getTemplateRegistry().templates).toHaveLength(1);
  expect(
    h.writes.some((path) => path.endsWith("templates/device/Light.json")),
  ).toBe(true);
});

it("writes changed templates and removes deleted ones", async () => {
  const mod = await store(
    space({
      "ihome.meta/templates/device/light.json": serializeTemplateFile(device),
    }),
  );
  const changed = {
    ...mod.getTemplateRegistry(),
    templates: [{ ...PRESETS.Light, name: "Lamp" }],
  };
  expect(mod.commitTemplates(changed)).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(h.writes.some((path) => path.endsWith("Light.json"))).toBe(true);

  expect(mod.commitTemplates({ ...changed, templates: [] })).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 400));
  expect(h.deletes.some((path) => path.endsWith("Light.json"))).toBe(true);
});

it("blocks writes when the legacy state is unreadable and no files exist", async () => {
  h.legacy = "{not json";
  const mod = await store(space({}));
  expect(mod.isTemplatesWritable()).toBe(false);
});
