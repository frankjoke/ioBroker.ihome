import { it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => {
  const state = { value: null as unknown, failWrite: false };
  const states = new Map<string, any>();
  const objects = new Map<string, any>();
  const registered: string[] = [];
  const link = { connected: true };
  const setState = vi.fn(async (_id: string, value: unknown) => {
    if (state.failWrite) throw new Error("write denied");
    state.value = value;
  });
  return { state, states, objects, registered, link, setState };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    get connected() {
      return h.link.connected;
    },
    wait: vi.fn(async (ms: number) => {
      if (vi.isFakeTimers()) vi.advanceTimersByTime(ms);
    }),
    getState: vi.fn(async () =>
      h.state.value === null ? null : { value: h.state.value },
    ),
    setState: h.setState,
    states: h.states,
    objects: h.objects,
  },
}));

vi.mock("$lib/stores/devices.svelte", () => ({
  registerProgramStateId: vi.fn((id: string) => h.registered.push(id)),
}));

import {
  OVERRIDE_LIST_ID,
  emptyOverrideRegistry,
} from "$lib/config/source-overrides";
import type { SourceOverride } from "$lib/types/overrides";

const doc = (updatedAt: number, overrides: unknown[]): string =>
  JSON.stringify({ version: 1, updatedAt, overrides });

const repair = (id: string, stateId: string, name: string): SourceOverride => ({
  id,
  stateId,
  kind: "repair",
  name,
});

/** A fresh store module wired to the fake broker document. */
async function load(
  stateValue: string | null,
  values: {
    states?: [string, any][];
    objects?: [string, any][];
  } = {},
  connected = true,
) {
  h.state.value = stateValue;
  h.state.failWrite = false;
  h.link.connected = connected;
  h.states.clear();
  h.objects.clear();
  h.registered.length = 0;
  h.setState.mockClear();
  for (const [id, state] of values.states ?? []) h.states.set(id, state);
  for (const [id, object] of values.objects ?? []) h.objects.set(id, object);
  vi.resetModules();
  const store = await import("./overrides.svelte");
  await store.initOverrides();
  return store;
}

beforeEach(() => {
  h.state.value = null;
  h.state.failWrite = false;
});

it("loads and normalizes the stored document", async () => {
  const store = await load(
    doc(7, [
      { ...repair("o1", "s.0.a", "power"), future: "kept" },
      { id: "", stateId: "s.0.a", kind: "repair", name: "dropped" },
      { id: "o2", stateId: "s.0.b", kind: "weird", name: "dropped too" },
    ]),
  );
  const reg = store.getOverrideRegistry();
  expect(reg.updatedAt).toBe(7);
  expect(reg.overrides.map((o) => o.id)).toEqual(["o1"]);
  expect((reg.overrides[0] as any).future).toBe("kept");
  expect(store.isOverridesWritable()).toBe(true);
});

it("an absent document is an empty writable registry", async () => {
  const store = await load(null);
  expect(store.getOverrideRegistry().overrides).toEqual([]);
  expect(store.isOverridesWritable()).toBe(true);
});

it("an unreadable document is never overwritten", async () => {
  const store = await load("{not json");
  expect(store.isOverridesWritable()).toBe(false);
  expect(await store.commitOverrides(emptyOverrideRegistry(), 0)).toBe(
    "failed",
  );
  expect(h.setState).not.toHaveBeenCalled();
});

it("a document that was never read keeps the store read-only", async () => {
  vi.useFakeTimers();
  try {
    h.link.connected = false;
    const store = await load(null, {}, false);
    expect(store.isOverridesWritable()).toBe(false);
    expect(await store.commitOverrides(emptyOverrideRegistry(), 0)).toBe(
      "failed",
    );

    // A later init, now connected, loads the document.
    h.link.connected = true;
    await store.initOverrides();
    expect(store.isOverridesWritable()).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});

it("a save writes the document with a fresh updatedAt", async () => {
  const store = await load(doc(1, [repair("o1", "s.0.a", "power")]));
  const next = {
    ...store.getOverrideRegistry(),
    overrides: [repair("o1", "s.0.a", "current")],
  };
  expect(await store.commitOverrides(next, 1)).toBe("saved");
  expect(h.setState).toHaveBeenCalledWith(OVERRIDE_LIST_ID, expect.any(String));
  const written = JSON.parse(h.state.value as string);
  expect(written.overrides[0].name).toBe("current");
  expect(written.updatedAt).toBeGreaterThan(1);
  expect(store.getOverrideRegistry().updatedAt).toBe(written.updatedAt);
  expect(store.overrideSaveFailed()).toBe(false);
});

it("refuses to overwrite a document changed since the load", async () => {
  const store = await load(doc(1, [repair("o1", "s.0.a", "power")]));
  h.state.value = doc(2, [repair("remote", "s.0.a", "power")]);
  expect(
    await store.commitOverrides(
      { ...store.getOverrideRegistry(), overrides: [] },
      1,
    ),
  ).toBe("conflict");
  expect(h.setState).not.toHaveBeenCalled();
  expect(store.getOverrideRegistry().updatedAt).toBe(2);
  expect(store.getOverrideRegistry().overrides[0].id).toBe("remote");
});

it("a failed write keeps the in-memory document", async () => {
  const store = await load(doc(1, [repair("o1", "s.0.a", "power")]));
  const before = store.getOverrideRegistry();
  h.state.failWrite = true;
  expect(
    await store.commitOverrides(
      { ...before, overrides: [repair("o2", "s.0.a", "draft")] },
      1,
    ),
  ).toBe("failed");
  expect(store.getOverrideRegistry()).toBe(before);
  expect(store.overrideSaveFailed()).toBe(true);
});

it("derives the value and inputs from the live state group", async () => {
  const store = await load(
    doc(1, [
      {
        id: "d1",
        stateId: "s.0.anchor",
        kind: "derived",
        name: "sum",
        expr: "$.temperature + 1",
        inputs: ["stale.0.id"],
      },
    ]),
    {
      states: [
        ["s.0.anchor", { val: 10 }],
        ["s.0.temperature", { val: 2 }],
      ],
      objects: [
        ["s.0.anchor", { type: "state", common: { name: "anchor" } }],
        ["s.0.temperature", { type: "state", common: { name: "Temperature" } }],
      ],
    },
  );
  expect(store.getDerived("d1")).toEqual({ value: 3 });
  // The stored inputs are not trusted: the live expression decides.
  expect(h.registered).toContain("s.0.temperature");
  expect(h.registered).not.toContain("stale.0.id");
  expect(h.registered).toContain(OVERRIDE_LIST_ID);
  expect(store.getOverrideRegistry().overrides[0].inputs).toEqual([
    "s.0.temperature",
  ]);

  // A changed input is picked up on the next read.
  h.states.set("s.0.temperature", { val: 5 });
  expect(store.getDerived("d1")).toEqual({ value: 6 });
});

it("a derived error is reported, not thrown", async () => {
  const store = await load(
    doc(1, [
      {
        id: "d1",
        stateId: "s.0.anchor",
        kind: "derived",
        name: "broken",
        expr: "$.nope + 1",
      },
    ]),
    {
      objects: [["s.0.anchor", { type: "state", common: { name: "anchor" } }]],
    },
  );
  expect(store.getDerived("d1").error).toContain("nope");
  expect(store.getDerived("missing")).toEqual({
    error: 'unknown derived override "missing"',
  });
});
