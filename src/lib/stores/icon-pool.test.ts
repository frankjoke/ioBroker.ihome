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
  return { state, register, setState };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    connected: true,
    getState: vi.fn(async () => ({
      value: h.state.raw,
      set onUpdate(fn: typeof h.state.onUpdate) {
        h.state.onUpdate = fn;
      },
      get onUpdate() {
        return h.state.onUpdate;
      },
    })),
    setState: h.setState,
    getObject: vi.fn(async () => ({})),
    emitAsync: vi.fn(async () => ({})),
    wait: vi.fn(async () => {}),
  },
}));

vi.mock("$lib/stores/devices.svelte", () => ({
  registerProgramStateId: h.register,
}));

import {
  ICON_POOL_ID,
  commitIconPool,
  getIconPool,
  iconPoolLoadKind,
  initIconPool,
} from "./icon-pool.svelte";

const doc = (updatedAt: number, id = "a", value = "x") =>
  JSON.stringify({
    version: 1,
    updatedAt,
    icons: [{ id, name: id.toUpperCase(), value }],
  });

it("registers the document and loads it", async () => {
  h.state.raw = doc(1);
  await initIconPool();
  expect(h.register).toHaveBeenCalledWith(ICON_POOL_ID);
  expect(iconPoolLoadKind()).toBe("loaded");
  expect(getIconPool().icons).toHaveLength(1);
});

it("ignores its own echo and accepts a remote change", async () => {
  const next = {
    version: 1 as const,
    updatedAt: 10,
    icons: [{ id: "b", name: "B", value: "y" }],
  };
  expect(await commitIconPool(next)).toBe(true);
  // The same updatedAt is this tab's echo, even if the payload differs.
  h.state.onUpdate?.(null, {
    val: JSON.stringify({ ...next, icons: [] }),
  });
  expect(getIconPool().icons).toHaveLength(1);
  // Another writer bumps updatedAt: accept it.
  h.state.onUpdate?.(null, {
    val: JSON.stringify({ ...next, updatedAt: 11, icons: [] }),
  });
  expect(getIconPool().icons).toHaveLength(0);
});
