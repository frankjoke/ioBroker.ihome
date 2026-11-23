import { expect, it } from "vitest";
import {
  applyCollection,
  baselineOf,
  captureCollection,
  classifyCollection,
  collectionOf,
  collectionPluginOf,
  mergeCapturedPlugin,
  removeCollection,
  type CaptureRequest,
  type CollectionHost,
  type CollectionPlugin,
} from "./plugin-collection";
import { pluginContributionsOf } from "./plugin-contributions";
import type { LogicDocument, LogicDef } from "./logic/types";

const state = {
  id: "0_userdata.0.pv.total",
  type: "state" as const,
  common: {
    name: "Total",
    type: "number",
    role: "value",
    read: true,
    write: false,
  },
};
const logic = {
  id: "calc",
  name: "Calc",
  kind: "function" as const,
  expr: { code: "1" },
};

function plugin(
  overrides: Partial<CollectionPlugin["collection"]> = {},
): CollectionPlugin {
  return {
    id: "col.test",
    version: "1.0.0",
    collection: {
      version: 1,
      states: [structuredClone(state)],
      logics: [structuredClone(logic) as LogicDef],
      ...overrides,
    },
  };
}

interface FakeHost extends CollectionHost {
  doc: LogicDocument;
  objects: Record<string, Record<string, unknown>>;
  writes: string[];
}

function fakeHost(
  doc: LogicDocument = { version: 3, logics: [] },
  objects: Record<string, Record<string, unknown>> = {},
): FakeHost {
  const host: FakeHost = {
    doc,
    objects,
    writes: [],
    async getObject(id) {
      return host.objects[id];
    },
    async setObject(id, object) {
      host.objects[id] = structuredClone(object);
      host.writes.push(id);
    },
    async deleteObject(id) {
      delete host.objects[id];
      host.writes.push(`delete:${id}`);
    },
    async readLogicDocument() {
      return structuredClone(host.doc);
    },
    async writeLogicDocument(next) {
      host.doc = structuredClone(next);
      host.writes.push("logic");
    },
    resolveVariable: () => undefined,
    log: () => {},
    async listObjects() {
      return Object.keys(host.objects);
    },
  };
  return host;
}

it("reconciles owned states and logics without touching unrelated ones", async () => {
  const unrelated: LogicDef = {
    id: "mine",
    name: "Mine",
    kind: "function",
    expr: { code: "2" },
  };
  const host = fakeHost({ version: 3, logics: [unrelated] });
  const result = await applyCollection(host, plugin(), {
    enabled: false,
    mode: "reconcile",
  });
  expect(result).toEqual({ applied: true, conflicts: [], changed: true });
  expect(host.doc.logics.map((entry) => entry.id)).toEqual(["mine", "calc"]);
  const added = host.doc.logics.find((entry) => entry.id === "calc");
  expect(added).toMatchObject({
    enabled: false,
    managed: {
      plugin: "col.test",
      version: "1.0.0",
      baseline: baselineOf(logic, "logic"),
    },
  });
  expect(host.objects[state.id]).toMatchObject({
    type: "state",
    common: state.common,
    native: {
      ihomeCollection: {
        plugin: "col.test",
        version: "1.0.0",
        baseline: baselineOf(state, "state"),
      },
    },
  });
});

it("enables owned logic when the plugin is enabled", async () => {
  const host = fakeHost();
  await applyCollection(host, plugin(), { enabled: true, mode: "reconcile" });
  expect(host.doc.logics[0].enabled).toBe(true);
});

it("refuses a live definition that differs from its baseline", async () => {
  const host = fakeHost({
    version: 3,
    logics: [
      {
        ...logic,
        expr: { code: "9" },
        managed: {
          plugin: "col.test",
          version: "0.9.0",
          baseline: "0".repeat(64),
        },
      } as LogicDef,
    ],
  });
  const report = await classifyCollection(host, plugin());
  expect(report.conflicts).toEqual([
    { kind: "logic", id: "calc", reason: "conflict" },
  ]);
  const result = await applyCollection(host, plugin(), {
    enabled: true,
    mode: "reconcile",
  });
  expect(result).toMatchObject({ applied: false, changed: false });
  expect(host.doc.logics[0].expr).toEqual({ code: "9" });
  expect(host.writes).toEqual([]);
});

it("claims an unmanaged item only on explicit overwrite", async () => {
  const host = fakeHost({ version: 3, logics: [structuredClone(logic)] });
  const report = await classifyCollection(host, plugin());
  expect(report.conflicts).toEqual([
    { kind: "logic", id: "calc", reason: "unmanaged" },
  ]);
  expect(
    await applyCollection(host, plugin(), {
      enabled: true,
      mode: "reconcile",
    }),
  ).toMatchObject({ applied: false, changed: false });
  expect(host.doc.logics[0].managed).toBeUndefined();
  const applied = await applyCollection(host, plugin(), {
    enabled: true,
    mode: "reconcile",
    overwrite: true,
  });
  expect(applied.applied).toBe(true);
  expect(host.doc.logics[0].managed?.plugin).toBe("col.test");
});

it("refuses another plugin's item even with overwrite", async () => {
  const host = fakeHost({
    version: 3,
    logics: [
      {
        ...logic,
        managed: {
          plugin: "other.plugin",
          version: "1.0.0",
          baseline: "0".repeat(64),
        },
      } as LogicDef,
    ],
  });
  expect((await classifyCollection(host, plugin())).conflicts).toEqual([
    { kind: "logic", id: "calc", reason: "foreign" },
  ]);
  expect(
    await applyCollection(host, plugin(), {
      enabled: true,
      mode: "reconcile",
      overwrite: true,
    }),
  ).toMatchObject({ applied: false, changed: false });
  expect(host.writes).toEqual([]);
});

it("overwrites a conflict only when asked", async () => {
  const live = {
    ...logic,
    expr: { code: "9" },
    managed: {
      plugin: "col.test",
      version: "0.9.0",
      baseline: "0".repeat(64),
    },
  } as LogicDef;
  const host = fakeHost({ version: 3, logics: [live] });
  const result = await applyCollection(host, plugin(), {
    enabled: true,
    mode: "reconcile",
    overwrite: true,
  });
  expect(result.applied).toBe(true);
  expect(host.doc.logics[0].expr).toEqual({ code: "1" });
  expect(host.doc.logics[0].managed?.baseline).toBe(baselineOf(logic, "logic"));
});

it("sync keeps a conflicting definition and only sets enabled", async () => {
  const live = {
    ...logic,
    expr: { code: "9" },
    enabled: false,
    managed: {
      plugin: "col.test",
      version: "0.9.0",
      baseline: "0".repeat(64),
    },
  } as LogicDef;
  const host = fakeHost({ version: 3, logics: [live] });
  const result = await applyCollection(host, plugin(), {
    enabled: true,
    mode: "sync",
  });
  expect(result.applied).toBe(true);
  expect(host.doc.logics[0].expr).toEqual({ code: "9" });
  expect(host.doc.logics[0].enabled).toBe(true);
});

it("removes dropped logic and clears a dropped state marker", async () => {
  const oldLogic = {
    id: "old",
    name: "Old",
    kind: "function",
    expr: { code: "3" },
    managed: {
      plugin: "col.test",
      version: "0.9.0",
      baseline: "0".repeat(64),
    },
  } as LogicDef;
  const oldState = "0_userdata.0.pv.old";
  const host = fakeHost(
    { version: 3, logics: [oldLogic] },
    {
      [oldState]: {
        id: oldState,
        type: "state",
        common: { name: "Old", type: "number" },
        native: {
          ihomeCollection: {
            plugin: "col.test",
            version: "0.9.0",
            baseline: "0".repeat(64),
          },
        },
      },
    },
  );
  await applyCollection(host, plugin(), { enabled: false, mode: "reconcile" });
  expect(host.doc.logics.some((entry) => entry.id === "old")).toBe(false);
  expect(host.objects[oldState]).toMatchObject({ type: "state" });
  expect(host.objects[oldState].native).toBeUndefined();
});

it("keeps states and their marker when the plugin is removed", async () => {
  const host = fakeHost();
  await applyCollection(host, plugin(), { enabled: true, mode: "reconcile" });
  await removeCollection(host, plugin(), { removeStates: false });
  expect(host.doc.logics).toEqual([]);
  expect(host.objects[state.id]).toBeDefined();
  expect(host.objects[state.id].native).toMatchObject({
    ihomeCollection: { plugin: "col.test" },
  });
});

it("ignores local common.custom in the baseline and keeps it on apply", async () => {
  const localCustom = { ihome: { version: 1, updatedAt: 1, overrides: [] } };
  const live = {
    id: state.id,
    type: "state",
    common: { ...state.common, custom: localCustom },
    native: {
      ihomeCollection: {
        plugin: "col.test",
        version: "1.0.0",
        baseline: baselineOf(state, "state"),
      },
    },
  };
  const host = fakeHost({ version: 3, logics: [] }, { [state.id]: live });
  expect((await classifyCollection(host, plugin())).conflicts).toEqual([]);
  const result = await applyCollection(host, plugin(), {
    enabled: true,
    mode: "reconcile",
  });
  expect(result.applied).toBe(true);
  expect(
    (host.objects[state.id].common as Record<string, unknown>).custom,
  ).toEqual(localCustom);
});

it("keeps local common.custom out of the captured state", async () => {
  const host = captureHost();
  (host.objects[state.id].common as Record<string, unknown>).custom = {
    ihome: { version: 1 },
  };
  const result = await captureCollection(host, request());
  expect(
    (result.collection.states[0].common as Record<string, unknown>).custom,
  ).toBeUndefined();
  expect(
    (host.objects[state.id].common as Record<string, unknown>).custom,
  ).toEqual({ ihome: { version: 1 } });
});

it("deletes states only when removal is explicit", async () => {
  const host = fakeHost();
  await applyCollection(host, plugin(), { enabled: true, mode: "reconcile" });
  await removeCollection(host, plugin(), { removeStates: true });
  expect(host.objects[state.id]).toBeUndefined();
});

it("treats a live object's _id like the manifest id", async () => {
  const host = fakeHost();
  await applyCollection(host, plugin(), { enabled: false, mode: "reconcile" });
  const live = host.objects[state.id];
  const broker = { ...live, _id: state.id };
  delete (broker as { id?: unknown }).id;
  host.objects[state.id] = broker;
  expect((await classifyCollection(host, plugin())).conflicts).toEqual([]);
});

it("creates the parent folders of a state before the state", async () => {
  const host = fakeHost();
  await applyCollection(host, plugin(), { enabled: false, mode: "reconcile" });
  expect(host.writes).toContain("0_userdata.0.pv");
  expect(host.objects["0_userdata.0.pv"]).toMatchObject({
    type: "folder",
    common: { name: "pv" },
  });
});

it("returns undefined for a plugin without a version", () => {
  expect(
    collectionPluginOf({
      id: "col.test",
      name: "C",
      enabled: true,
      timeoutMs: 5000,
      debug: false,
      collection: plugin().collection,
    }),
  ).toBeUndefined();
});

function captureHost(
  extraLogics: LogicDef[] = [],
  objects: Record<string, Record<string, unknown>> = {},
): FakeHost {
  const doc: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "calc",
        name: "Calc",
        kind: "function",
        enabled: true,
        inputs: {
          sensor: {
            from: { type: "state", ref: "0_userdata.0.sensor" },
            kind: "event",
          },
        },
        output: { scope: "state", ref: state.id, type: "number" },
        expr: { code: 'get("0_userdata.0.helper")' },
      },
      ...extraLogics,
    ],
  };
  return fakeHost(doc, {
    [state.id]: {
      id: state.id,
      type: "state",
      common: structuredClone(state.common),
    },
    ...objects,
  });
}

function request(overrides: Partial<CaptureRequest> = {}): CaptureRequest {
  return {
    id: "col.test",
    name: "Collection",
    version: "2.0.0",
    logicIds: ["calc"],
    stateIds: [state.id],
    tiles: [],
    ...overrides,
  };
}

it("captures live items, strips lifecycle fields and builds uses", async () => {
  const host = captureHost();
  const result = await captureCollection(host, request());
  expect(result.uses).toEqual(["0_userdata.0.helper", "0_userdata.0.sensor"]);
  expect("problem" in collectionOf(result.collection)).toBe(false);
  expect(result.collection.logics[0].enabled).toBeUndefined();
  expect(result.collection.logics[0].managed).toBeUndefined();
  expect(result.collection.states[0].id).toBe(state.id);
  const live = host.doc.logics[0];
  expect(live.enabled).toBe(true);
  expect(live.managed?.baseline).toBe(
    baselineOf(result.collection.logics[0], "logic"),
  );
  expect(host.objects[state.id].native).toMatchObject({
    ihomeCollection: {
      plugin: "col.test",
      version: "2.0.0",
      baseline: baselineOf(result.collection.states[0], "state"),
    },
  });
});

it("resolves a variable ref into uses", async () => {
  const host = captureHost([
    {
      id: "varuse",
      name: "Var",
      kind: "function",
      expr: { code: 'get("totalVar")' },
    },
  ]);
  host.resolveVariable = (name) =>
    name === "totalVar" ? "0_userdata.0.pv.other" : undefined;
  const result = await captureCollection(
    host,
    request({ logicIds: ["varuse"], stateIds: [] }),
  );
  expect(result.uses).toContain("0_userdata.0.pv.other");
});

it("refuses another plugin's item and reports a missing id", async () => {
  const host = captureHost([
    {
      id: "foreign",
      name: "Foreign",
      kind: "function",
      expr: { code: "1" },
      managed: {
        plugin: "other.plugin",
        version: "1.0.0",
        baseline: "0".repeat(64),
      },
    },
  ]);
  await expect(
    captureCollection(host, request({ logicIds: ["foreign"], stateIds: [] })),
  ).rejects.toThrow(/another plugin/);
  await expect(
    captureCollection(host, request({ logicIds: ["nope"], stateIds: [] })),
  ).rejects.toThrow(/nope/);
  await expect(
    captureCollection(
      host,
      request({ logicIds: [], stateIds: ["0_userdata.0.nope"] }),
    ),
  ).rejects.toThrow(/0_userdata\.0\.nope/);
});

it("copies selected tiles without their builtin reference", async () => {
  const host = captureHost();
  const result = await captureCollection(
    host,
    request({
      tiles: [
        {
          id: "t",
          name: "T",
          type: "Custom",
          builtin: true,
          basedOn: ["pairing"],
          features: [],
          slots: [],
        },
      ],
    }),
  );
  const tiles = result.contributions?.tiles ?? [];
  expect(tiles[0]).not.toHaveProperty("builtin");
  expect(tiles[0]).not.toHaveProperty("basedOn");
  expect("problem" in pluginContributionsOf({ tiles })).toBe(false);
});

it("merges a capture into an existing manifest", () => {
  const existing = {
    id: "col.test",
    name: "Old",
    api: 1,
    version: "1.0.0",
    help: "help",
    usage: "usage",
    settings: { port: 1 },
    settingsSchema: [{ name: "port", label: "Port", type: "number" }],
    settingsTabs: [{ id: "main", label: "Main", fields: [] }],
    code: "module.exports = {}",
    contributions: {
      snippets: [{ id: "s", name: "S", code: "x" }],
      tiles: [{ id: "old", name: "Old", type: "Custom" }],
    },
  };
  const capture = {
    collection: plugin().collection,
    contributions: {
      tiles: [{ id: "new", name: "New", type: "Custom" }],
    },
    uses: [],
  };
  const merged = mergeCapturedPlugin(existing, request(), capture);
  expect(merged).toMatchObject({
    id: "col.test",
    name: "Collection",
    version: "2.0.0",
    api: 1,
    help: "help",
    usage: "usage",
    settings: { port: 1 },
    code: "module.exports = {}",
  });
  expect(merged.settingsTabs).toEqual(existing.settingsTabs);
  expect(merged.contributions?.snippets).toEqual(
    existing.contributions.snippets,
  );
  expect(merged.contributions?.tiles).toEqual([
    { id: "new", name: "New", type: "Custom" },
  ]);
  expect(merged.collection).toEqual(capture.collection);
});
