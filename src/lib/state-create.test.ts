import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => {
  const objects = new Map<string, any>();
  const writes: any[] = [];
  const states: unknown[][] = [];
  const ioBroker = {
    namespace: "ihome.0",
    connected: true,
    objects: {
      get: (id: string) => objects.get(id),
      update: (id: string, object: any) => objects.set(id, object),
    },
    emitAsync: async (event: string, ...args: any[]) => {
      if (event === "getObject") return objects.get(args[0]);
      if (event === "setObject") {
        objects.set(args[0], args[1]);
        writes.push(args[1]);
        return;
      }
      return undefined;
    },
    setState: async (id: string, value: unknown) => {
      states.push([id, value]);
    },
  };
  return { objects, writes, states, ioBroker };
});

vi.mock("$lib/ioBrokerConnect.svelte.js", () => ({ ioBroker: mock.ioBroker }));

import { ensureStateObject, readStateObject } from "./state-create";

const spec = {
  id: "ihome.0.Variables.x",
  common: {
    name: "X",
    type: "number",
    read: true,
    write: true,
    unit: "",
    states: {},
    def: 0,
  },
  initial: 0,
};

beforeEach(() => {
  mock.objects.clear();
  mock.writes.length = 0;
  mock.states.length = 0;
  mock.ioBroker.connected = true;
});

describe("ensureStateObject", () => {
  it("creates a missing state and sets its initial value", async () => {
    await expect(ensureStateObject(spec)).resolves.toBe("created");
    expect(mock.writes).toHaveLength(1);
    expect(mock.states).toEqual([["ihome.0.Variables.x", 0]]);
  });

  it("does not write an equal state twice", async () => {
    await ensureStateObject(spec);
    await expect(ensureStateObject(spec)).resolves.toBe("unchanged");
    expect(mock.writes).toHaveLength(1);
  });

  it("updates with a full object and replaces states", async () => {
    mock.objects.set("ihome.0.Variables.x", {
      _id: "ihome.0.Variables.x",
      type: "state",
      common: { type: "number", states: { "0": "Off" }, custom: "keep" },
      native: { a: 1 },
    });
    await expect(
      ensureStateObject({
        id: "ihome.0.Variables.x",
        common: { type: "number", states: {} },
      }),
    ).resolves.toBe("updated");
    expect(mock.writes[0].common).toEqual({
      type: "number",
      states: {},
      custom: "keep",
    });
    expect(mock.writes[0].native).toEqual({ a: 1 });
  });

  it("skips an existing foreign state", async () => {
    mock.objects.set("0_userdata.0.X", {
      _id: "0_userdata.0.X",
      type: "state",
      common: { type: "number" },
    });
    await expect(
      ensureStateObject({
        id: "0_userdata.0.X",
        common: { type: "number" },
      }),
    ).resolves.toBe("foreign-skipped");
    expect(mock.writes).toHaveLength(0);
  });

  it("refuses to turn a folder into a state", async () => {
    mock.objects.set("ihome.0.Variables.x", {
      _id: "ihome.0.Variables.x",
      type: "folder",
      common: { name: "X" },
    });
    await expect(ensureStateObject(spec)).rejects.toThrow(
      "exists but is not a state",
    );
    expect(mock.writes).toHaveLength(0);
  });
});

describe("readStateObject", () => {
  it("fails instead of pretending a disconnected read is missing", async () => {
    mock.ioBroker.connected = false;
    await expect(readStateObject("ihome.0.Variables.x")).rejects.toThrow(
      "Not connected",
    );
    expect(mock.writes).toHaveLength(0);
  });
});
