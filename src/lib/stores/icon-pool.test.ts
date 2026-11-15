import { it, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    raw: null as unknown,
    onUpdate: null as
      null | ((client: unknown, state: { val: unknown }) => boolean),
  };
  const register = vi.fn();
  const setState = vi.fn(async (_id: string, value: unknown) => {
    state.raw = value;
  });
  const getState = vi.fn(async () => {
    if (state.raw === null) return null;
    return {
      value: state.raw,
      set onUpdate(fn: typeof state.onUpdate) {
        state.onUpdate = fn;
      },
      get onUpdate() {
        return state.onUpdate;
      },
    };
  });
  return { state, register, setState, getState };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    connected: true,
    getState: h.getState,
    setState: h.setState,
    getObject: vi.fn(async () => ({})),
    emitAsync: vi.fn(async () => ({})),
    wait: vi.fn(async () => {}),
  },
}));

vi.mock("$lib/stores/devices.svelte", () => ({
  registerProgramStateId: h.register,
}));

const doc = (updatedAt: number, id = "a", value = "x") =>
  JSON.stringify({
    version: 2,
    updatedAt,
    library: [{ id, name: id.toUpperCase(), value, keywords: [] }],
    defaults: { roles: {}, templates: {} },
  });

/** A fresh module per scenario: absent, loaded and unreadable differ at init. */
async function load(raw: unknown) {
  h.state.raw = raw;
  h.state.onUpdate = null;
  h.register.mockClear();
  h.setState.mockClear();
  vi.resetModules();
  const store = await import("./icon-pool.svelte");
  await store.initIconPool();
  return store;
}

it("registers the document and loads it", async () => {
  const store = await load(doc(1));
  expect(h.register).toHaveBeenCalledWith(store.ICON_POOL_ID);
  expect(store.iconPoolLoadKind()).toBe("loaded");
  expect(store.getIconPool().library).toHaveLength(1);
});

it("treats an adapter-created empty document as absent and writable", async () => {
  // The object exists (getObject truthy) but no value was ever written.
  const store = await load(null);
  expect(store.iconPoolLoadKind()).toBe("absent");
  expect(store.isIconPoolWritable()).toBe(true);
});

it("keeps a malformed document unreadable and unwritable", async () => {
  const store = await load("{not json");
  expect(store.iconPoolLoadKind()).toBe("unreadable");
  expect(store.isIconPoolWritable()).toBe(false);
});

it("ignores its own echo and accepts a remote change", async () => {
  const store = await load(doc(1));
  const next = {
    version: 2 as const,
    updatedAt: 10,
    library: [{ id: "b", name: "B", value: "y", keywords: [] }],
    defaults: { roles: {}, templates: {} },
  };
  expect(await store.commitIconPool(next, 1)).toBe("saved");
  h.state.onUpdate?.(null, {
    val: JSON.stringify({ ...next, library: [] }),
  });
  expect(store.getIconPool().library).toHaveLength(1);
  h.state.onUpdate?.(null, {
    val: JSON.stringify({ ...next, updatedAt: 11, library: [] }),
  });
  expect(store.getIconPool().library).toHaveLength(0);
});

it("refuses to overwrite a remote save made since load", async () => {
  const store = await load(doc(1));
  h.state.raw = doc(2, "remote", "z");
  const result = await store.commitIconPool(
    {
      version: 2 as const,
      updatedAt: 3,
      library: [],
      defaults: { roles: {}, templates: {} },
    },
    1,
  );
  expect(result).toBe("conflict");
  expect(h.setState).not.toHaveBeenCalled();
  expect(store.getIconPool().library[0].id).toBe("remote");
});

it("creates the first document and subscribes to it", async () => {
  const store = await load(null);
  const next = {
    version: 2 as const,
    updatedAt: 5,
    library: [{ id: "a", name: "A", value: "x", keywords: [] }],
    defaults: { roles: {}, templates: {} },
  };
  expect(await store.commitIconPool(next, 0)).toBe("saved");
  await store.initIconPool();
  expect(store.iconPoolLoadKind()).toBe("loaded");
  h.state.onUpdate?.(null, { val: doc(6, "b", "y") });
  expect(store.getIconPool().library[0].id).toBe("b");
});
