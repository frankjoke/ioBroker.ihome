import { it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = { value: null as unknown };
  const file = { text: null as string | null, failWrites: false };
  const setState = vi.fn(async (_id: string, value: unknown) => {
    state.value = value;
  });
  return {
    state,
    file,
    setState,
    readLibraryFile: vi.fn(async () => file.text),
    writeLibraryFile: vi.fn(async (json: string) => {
      if (file.failWrites) throw new Error("broken");
      file.text = json;
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

async function load(stateValue: string | null, fileText: string | null) {
  h.state.value = stateValue;
  h.file.text = fileText;
  h.file.failWrites = false;
  h.setState.mockClear();
  h.writeLibraryFile.mockClear();
  h.readLibraryFile.mockClear();
  vi.resetModules();
  const store = await import("./icon-pool.svelte");
  await store.initIconPool();
  return store;
}

it("loads from the state and keeps the mirror in step", async () => {
  const store = await load(doc(5), null);
  expect(store.iconPoolLoadKind()).toBe("loaded");
  expect(store.getIconPool().library[0].id).toBe("a");
  expect(h.writeLibraryFile).toHaveBeenCalledTimes(1);
});

it("joins an existing shared file when the state is empty", async () => {
  const store = await load(null, doc(7, "joined", "y"));
  expect(store.iconPoolLoadKind()).toBe("loaded");
  expect(store.getIconPool().library[0].id).toBe("joined");
  expect(h.setState).toHaveBeenCalled();
});

it("prefers the newer of state and file", async () => {
  const store = await load(doc(3, "state"), doc(9, "file"));
  expect(store.getIconPool().library[0].id).toBe("file");
  expect(h.setState).toHaveBeenCalled();
});

it("recovers from a corrupt state using a valid mirror", async () => {
  const store = await load("{not json", doc(4, "mirror", "m"));
  expect(store.iconPoolLoadKind()).toBe("loaded");
  expect(store.getIconPool().library[0].id).toBe("mirror");
  expect(h.setState).toHaveBeenCalled();
});

it("starts empty when neither side exists", async () => {
  const store = await load(null, null);
  expect(store.iconPoolLoadKind()).toBe("absent");
  expect(store.isIconPoolWritable()).toBe(true);
});

it("saves the state first and refreshes the mirror", async () => {
  const store = await load(doc(1), doc(1));
  const next = {
    version: 3 as const,
    updatedAt: 10,
    library: [{ id: "b", value: "z", keywords: [] }],
    twins: {},
    defaults: { roles: {}, templates: {} },
  };
  expect(await store.commitIconPool(next, 1)).toBe("saved");
  expect(h.setState).toHaveBeenCalledWith(
    store.ICON_POOL_ID,
    JSON.stringify(next),
  );
  expect(h.writeLibraryFile).toHaveBeenCalledTimes(1);
  expect(store.iconPoolMirrorStale()).toBe(false);
});

it("a broken mirror does not fail the save", async () => {
  const store = await load(doc(1), doc(1));
  h.file.failWrites = true;
  const next = {
    version: 3 as const,
    updatedAt: 11,
    library: [],
    twins: {},
    defaults: { roles: {}, templates: {} },
  };
  expect(await store.commitIconPool(next, 1)).toBe("saved");
  expect(store.iconPoolMirrorStale()).toBe(true);
});

it("refuses to overwrite a state changed since load", async () => {
  const store = await load(doc(1), doc(1));
  h.state.value = doc(2, "remote", "z");
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
  expect(store.getIconPool().library[0].id).toBe("remote");
});
