import { describe, expect, it } from "vitest";
import {
  groupOverrides,
  readStateOverrides,
  sameOverrideGroup,
  syncOverrideObjects,
} from "./override-sync";

const repair = {
  id: "a",
  stateId: "0_userdata.0.x",
  kind: "repair" as const,
  name: "level",
};
const derived = {
  id: "b",
  stateId: "0_userdata.0.x",
  kind: "derived" as const,
  name: "sum",
  expr: "$.a",
};

function host(objects: Record<string, any>) {
  const writes: Array<{ id: string; object: any }> = [];
  return {
    writes,
    getObject: async (id: string) => objects[id] ?? null,
    setObject: async (id: string, object: any) => {
      writes.push({ id, object });
    },
  };
}

describe("groupOverrides", () => {
  it("groups by state and keeps several overrides", () => {
    const grouped = groupOverrides([repair, derived]);
    expect(grouped.get("0_userdata.0.x")).toEqual([repair, derived]);
  });
});

describe("sameOverrideGroup", () => {
  it("ignores key order", () => {
    expect(
      sameOverrideGroup(
        [{ id: "a", stateId: "s", kind: "repair", name: "x", min: 0, max: 1 }],
        [{ id: "a", name: "x", kind: "repair", stateId: "s", max: 1, min: 0 }],
      ),
    ).toBe(true);
  });
});

describe("syncOverrideObjects", () => {
  const entry = (overrides: unknown[], updatedAt: number) => ({
    version: 1,
    updatedAt,
    overrides,
  });

  it("writes both overrides on one state and preserves other custom keys", async () => {
    const objects = {
      "0_userdata.0.x": {
        _id: "0_userdata.0.x",
        type: "state",
        common: { custom: { "history.0": { enabled: true } } },
        native: {},
      },
    };
    const h = host(objects);
    expect(
      await syncOverrideObjects(h, [repair, derived], [], { updatedAt: 7 }),
    ).toMatchObject({ updated: 1, removed: 0, failed: 0 });
    const custom = h.writes[0].object.common.custom;
    expect(custom["history.0"]).toEqual({ enabled: true });
    expect(custom.ihome.updatedAt).toBe(7);
    expect(custom.ihome.overrides.map((o: any) => o.name)).toEqual([
      "level",
      "sum",
    ]);
  });

  it("is a no-op when the group and timestamp are unchanged", async () => {
    const objects = {
      "0_userdata.0.x": {
        type: "state",
        common: { custom: { ihome: entry([repair], 7) } },
      },
    };
    const h = host(objects);
    expect(
      await syncOverrideObjects(h, [repair], [repair], { updatedAt: 7 }),
    ).toMatchObject({ updated: 0, failed: 0 });
    expect(h.writes).toEqual([]);
  });

  it("updates a changed override and keeps the object fields", async () => {
    const objects = {
      "0_userdata.0.x": {
        type: "state",
        common: { name: "X", custom: { ihome: entry([repair], 6) } },
        native: { keep: true },
      },
    };
    const h = host(objects);
    await syncOverrideObjects(h, [{ ...repair, max: 10 }], [repair], {
      updatedAt: 7,
    });
    expect(h.writes[0].object.native).toEqual({ keep: true });
    expect(h.writes[0].object.common.ihome).toBeUndefined();
    expect(h.writes[0].object.common.custom.ihome).toMatchObject({
      updatedAt: 7,
      overrides: [{ max: 10 }],
    });
  });

  it("removes ihome and keeps the object when the list empties", async () => {
    const objects = {
      "0_userdata.0.x": {
        type: "state",
        common: { custom: { ihome: entry([repair], 6) } },
      },
    };
    const h = host(objects);
    expect(
      await syncOverrideObjects(h, [], [repair], { updatedAt: 7 }),
    ).toMatchObject({ removed: 1 });
    expect(h.writes[0].object.common.custom).toEqual({ ihome: null });
  });

  it("does not overwrite a newer object entry", async () => {
    const objects = {
      "0_userdata.0.x": {
        type: "state",
        common: { custom: { ihome: entry([repair], 8) } },
      },
    };
    const h = host(objects);
    expect(
      await syncOverrideObjects(h, [{ ...repair, max: 10 }], [repair], {
        updatedAt: 7,
      }),
    ).toMatchObject({ updated: 0 });
    expect(h.writes).toEqual([]);
  });

  it("does not touch objects when the list is unknown", async () => {
    const objects = {
      "0_userdata.0.x": {
        type: "state",
        common: { custom: { ihome: entry([repair], 8) } },
      },
    };
    const h = host(objects);
    expect(
      await syncOverrideObjects(h, [repair], [], { updatedAt: 0 }),
    ).toMatchObject({ updated: 0 });
    expect(h.writes).toEqual([]);
  });

  it("resolves a variable-named state id before writing", async () => {
    const objects = {
      "0_userdata.0.x": { type: "state", common: {} },
    };
    const h = host(objects);
    await syncOverrideObjects(h, [repair], [], {
      updatedAt: 7,
      resolveStateId: (id) => (id === "myVar" ? "0_userdata.0.x" : undefined),
    });
    expect(h.writes[0].id).toBe("0_userdata.0.x");
  });

  it("skips a missing state and reports it", async () => {
    const h = host({});
    expect(
      await syncOverrideObjects(h, [repair], [], { updatedAt: 7 }),
    ).toMatchObject({ skipped: 1, updated: 0 });
    expect(h.writes).toEqual([]);
  });

  it("counts a getObject failure and continues", async () => {
    const h = {
      getObject: async () => {
        throw new Error("db");
      },
      setObject: async () => {},
    };
    expect(
      await syncOverrideObjects(h, [repair], [], { updatedAt: 7 }),
    ).toMatchObject({ failed: 1 });
  });

  it("counts a failed write and continues", async () => {
    const h = {
      getObject: async () => ({ type: "state", common: {}, native: {} }),
      setObject: async () => {
        throw new Error("denied");
      },
    };
    expect(
      await syncOverrideObjects(h, [repair], [], { updatedAt: 7 }),
    ).toMatchObject({ failed: 1 });
  });

  it("skips a non-state object", async () => {
    const h = host({ x: { type: "folder", common: {} } });
    expect(
      await syncOverrideObjects(h, [{ ...repair, stateId: "x" }], [], {
        updatedAt: 7,
      }),
    ).toMatchObject({ skipped: 1 });
    expect(h.writes).toEqual([]);
  });

  it("reads a state's overrides without writing", async () => {
    const h = host({
      "0_userdata.0.x": {
        type: "state",
        common: { custom: { ihome: entry([repair], 7) } },
      },
    });
    expect(await readStateOverrides(h, "0_userdata.0.x")).toEqual([repair]);
    expect(h.writes).toEqual([]);
  });
});
