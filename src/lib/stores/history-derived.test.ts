import { beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  raw: null as unknown,
  writes: [] as Array<{ id: string; value: string }>,
  registered: [] as string[],
}));

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({
  ioBroker: {
    namespace: "ihome.42",
    connected: true,
    wait: vi.fn(async () => {}),
    getObject: vi.fn(async () => ({ _id: "doc" })),
    emitAsync: vi.fn(async () => ({})),
    getState: vi.fn(async () => (h.raw === null ? null : { val: h.raw })),
    setState: vi.fn(async (id: string, value: string) => {
      h.writes.push({ id, value });
      h.raw = value;
    }),
  },
}));
vi.mock("$lib/stores/program-states.svelte", () => ({
  registerProgramStateId: (id: string) => h.registered.push(id),
}));

beforeEach(() => {
  h.raw = null;
  h.writes.length = 0;
  h.registered.length = 0;
  vi.resetModules();
});

it("loads an empty document and saves under the instance id", async () => {
  const store = await import("./history-derived.svelte");
  await store.initHistoryDerived();
  expect(store.isHistoryDerivedLoaded()).toBe(true);
  expect(h.registered).toContain("ihome.42.config.historyList");
  const entries = [
    {
      id: "0_userdata.0.T",
      adapter: "history.0",
      interval: "15m",
      startDelay: "0s",
      changesOnly: true,
      relogInterval: "1h",
      function: { code: "return 1;" },
    },
  ];
  expect(await store.saveHistoryDerived(entries)).toBe(true);
  expect(h.writes[0].id).toBe("ihome.42.config.historyList");
  expect(JSON.parse(h.writes[0].value).entries).toHaveLength(1);
  expect(store.getHistoryDerived().entries).toHaveLength(1);
});

it("refuses to save an entry with an empty function", async () => {
  const store = await import("./history-derived.svelte");
  await store.initHistoryDerived();
  const entries = [
    {
      id: "0_userdata.0.T",
      adapter: "history.0",
      interval: "15m",
      startDelay: "0s",
      changesOnly: true,
      relogInterval: "1h",
      function: { code: "   " },
    },
  ];
  expect(await store.saveHistoryDerived(entries)).toBe(false);
  expect(h.writes).toEqual([]);
  expect(store.historyDerivedSaveFailed()).toBe(true);
});

it("keeps an unreadable document read-only", async () => {
  h.raw = "{not json";
  const store = await import("./history-derived.svelte");
  await store.initHistoryDerived();
  expect(store.isHistoryDerivedLoaded()).toBe(false);
  expect(await store.saveHistoryDerived([])).toBe(false);
  expect(h.writes).toEqual([]);
});
