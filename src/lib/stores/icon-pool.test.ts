import { it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const file = { text: null as string | null, writes: [] as string[] };
  const state = { value: null as unknown };
  const setState = vi.fn(async (_id: string, value: unknown) => {
    state.value = value;
  });
  return {
    file,
    state,
    setState,
    readLibraryFile: vi.fn(async () => file.text),
    writeLibraryFile: vi.fn(async (json: string) => {
      file.text = json;
      file.writes.push(json);
    }),
  };
});

vi.mock("$lib/config/icon-files", () => ({
  readLibraryFile: h.readLibraryFile,
  writeLibraryFile: h.writeLibraryFile,
}));

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    connected: true,
    getState: vi.fn(async () =>
      h.state.value === null ? null : { value: h.state.value },
    ),
    setState: h.setState,
    wait: vi.fn(async () => {}),
  },
}));

const doc = (updatedAt: number, id = "a", value = "x") =>
  JSON.stringify({
    version: 3,
    updatedAt,
    library: [{ id, name: id.toUpperCase(), value, keywords: [] }],
    twins: {},
    defaults: { roles: {}, templates: {} },
  });

/** A fresh module per scenario: absent, loaded and unreadable differ at init. */
async function load(fileText: string | null, legacy: unknown = null) {
  h.file.text = fileText;
  h.file.writes.length = 0;
  h.state.value = legacy;
  h.setState.mockClear();
  h.readLibraryFile.mockClear();
  h.writeLibraryFile.mockClear();
  vi.resetModules();
  const store = await import("./icon-pool.svelte");
  await store.initIconPool();
  return store;
}

it("loads the shared library file", async () => {
  const store = await load(doc(1));
  expect(store.iconPoolLoadKind()).toBe("loaded");
  expect(store.getIconPool().library).toHaveLength(1);
  expect(h.writeLibraryFile).not.toHaveBeenCalled();
});

it("migrates the legacy state into the shared file on first run", async () => {
  const store = await load(null, doc(4, "legacy", "y"));
  expect(store.iconPoolLoadKind()).toBe("loaded");
  expect(store.getIconPool().library[0].id).toBe("legacy");
  expect(h.writeLibraryFile).toHaveBeenCalledTimes(1);
  expect(h.file.text).toContain("legacy");
});

it("keeps an unreadable shared file untouched", async () => {
  const store = await load("{not json");
  expect(store.iconPoolLoadKind()).toBe("unreadable");
  expect(store.isIconPoolWritable()).toBe(false);
  expect(h.writeLibraryFile).not.toHaveBeenCalled();
});

it("starts empty and writable when neither file nor state exists", async () => {
  const store = await load(null, null);
  expect(store.iconPoolLoadKind()).toBe("absent");
  expect(store.isIconPoolWritable()).toBe(true);
  expect(h.writeLibraryFile).not.toHaveBeenCalled();
});

it("writes the file and mirrors the state on save", async () => {
  const store = await load(doc(1));
  const next = {
    version: 3 as const,
    updatedAt: 10,
    library: [{ id: "b", value: "z", keywords: [] }],
    twins: {},
    defaults: { roles: {}, templates: {} },
  };
  expect(await store.commitIconPool(next, 1)).toBe("saved");
  expect(h.writeLibraryFile).toHaveBeenCalledTimes(1);
  expect(h.setState).toHaveBeenCalledWith(
    store.ICON_POOL_ID,
    JSON.stringify(next),
  );
  expect(store.getIconPool().updatedAt).toBe(10);
});

it("refuses to overwrite a save made since load", async () => {
  const store = await load(doc(1));
  h.file.text = doc(2, "remote", "z");
  const result = await store.commitIconPool(
    {
      version: 3 as const,
      updatedAt: 3,
      library: [],
      twins: {},
      defaults: { roles: {}, templates: {} },
    },
    1,
  );
  expect(result).toBe("conflict");
  expect(h.writeLibraryFile).not.toHaveBeenCalled();
  expect(store.getIconPool().library[0].id).toBe("remote");
});
