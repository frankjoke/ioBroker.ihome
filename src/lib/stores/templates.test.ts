import { it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  legacy: null as unknown,
  writes: [] as string[],
  deletes: [] as string[],
  stateCalls: [] as string[],
  registered: [] as string[],
}));

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    namespace: "ihome.42",
    connected: true,
    wait: vi.fn(async () => {}),
    emitAsync: vi.fn(async () => undefined),
    getState: vi.fn(async (id: string) => {
      h.stateCalls.push(id);
      return h.legacy === null ? null : { value: h.legacy };
    }),
    setState: vi.fn(async () => undefined),
  },
}));
vi.mock("$lib/stores/program-states.svelte", () => ({
  registerProgramStateId: vi.fn((id: string) => {
    h.registered.push(id);
  }),
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
  h.stateCalls.length = 0;
  h.registered.length = 0;
});

it("loads templates from the folder", async () => {
  const mod = await store(
    space({
      "ihome.meta/templates/ihome.42/device/light.json":
        serializeTemplateFile(device),
    }),
  );
  expect(mod.isTemplatesWritable()).toBe(true);
  expect(h.registered).toContain("ihome.42.config.templateList");
  // The file name is the id, whatever the definition carried.
  expect(mod.getTemplateRegistry().templates.map((t) => t.id)).toEqual([
    "light",
  ]);
});

it("does not fall back to the legacy document when the folder cannot be read", async () => {
  h.legacy = JSON.stringify({
    version: 1,
    updatedAt: 1,
    templates: [PRESETS.Light],
  });
  vi.resetModules();
  const meta = await import("$lib/config/meta-files");
  meta.setMetaTransport({
    async call(event) {
      if (event === "readDir") throw new Error("denied");
      return undefined;
    },
  });
  const mod = await import("./templates.svelte");
  await mod.initTemplates();
  expect(mod.isTemplatesWritable()).toBe(false);
  expect(mod.getTemplateRegistry().templates).toEqual([]);
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
    h.writes.some((path) =>
      path.endsWith("templates/ihome.42/device/Light.json"),
    ),
  ).toBe(true);
});

it("writes changed templates and removes deleted ones", async () => {
  const mod = await store(
    space({
      "ihome.meta/templates/ihome.42/device/light.json":
        serializeTemplateFile(device),
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
