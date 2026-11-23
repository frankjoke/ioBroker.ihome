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
  it("writes both overrides on one state and preserves other custom keys", async () => {
    const objects = {
      "0_userdata.0.x": {
        _id: "0_userdata.0.x",
        common: { custom: { "history.0": { enabled: true } } },
        native: {},
      },
    };
    const h = host(objects);
    expect(await syncOverrideObjects(h, [repair, derived], [])).toMatchObject({
      updated: 1,
      removed: 0,
      failed: 0,
    });
    const custom = h.writes[0].object.common.custom;
    expect(custom["history.0"]).toEqual({ enabled: true });
    expect(custom.ihome.overrides.map((o: any) => o.name)).toEqual([
      "level",
      "sum",
    ]);
  });

  it("is a no-op when the group is unchanged", async () => {
    const objects = {
      "0_userdata.0.x": {
        common: { custom: { ihome: { version: 1, overrides: [repair] } } },
      },
    };
    const h = host(objects);
    expect(await syncOverrideObjects(h, [repair], [repair])).toMatchObject({
      updated: 0,
      failed: 0,
    });
    expect(h.writes).toEqual([]);
  });

  it("updates a changed override and keeps the object fields", async () => {
    const objects = {
      "0_userdata.0.x": {
        common: {
          name: "X",
          custom: { ihome: { version: 1, overrides: [repair] } },
        },
        native: { keep: true },
      },
    };
    const h = host(objects);
    await syncOverrideObjects(h, [{ ...repair, max: 10 }], [repair]);
    expect(h.writes[0].object.native).toEqual({ keep: true });
    expect(h.writes[0].object.common.ihome).toBeUndefined();
    expect(h.writes[0].object.common.custom.ihome.overrides[0].max).toBe(10);
  });

  it("removes ihome and keeps the object when the last override goes", async () => {
    const objects = {
      "0_userdata.0.x": {
        common: { custom: { ihome: { version: 1, overrides: [repair] } } },
      },
    };
    const h = host(objects);
    expect(await syncOverrideObjects(h, [], [repair])).toMatchObject({
      removed: 1,
    });
    expect(h.writes[0].object.common.custom).toEqual({ ihome: null });
  });

  it("skips a missing state and reports it", async () => {
    const h = host({});
    expect(await syncOverrideObjects(h, [repair], [])).toMatchObject({
      skipped: 1,
      updated: 0,
    });
    expect(h.writes).toEqual([]);
  });

  it("counts a failed write and continues", async () => {
    const h = {
      getObject: async () => ({ common: {}, native: {} }),
      setObject: async () => {
        throw new Error("denied");
      },
    };
    expect(await syncOverrideObjects(h, [repair], [])).toMatchObject({
      failed: 1,
    });
  });

  it("keeps an override that only exists on the object", async () => {
    const foreign = {
      id: "f",
      stateId: "0_userdata.0.x",
      kind: "repair" as const,
      name: "foreign",
    };
    const objects = {
      "0_userdata.0.x": {
        common: {
          custom: { ihome: { version: 1, overrides: [repair, foreign] } },
        },
      },
    };
    const h = host(objects);
    await syncOverrideObjects(h, [{ ...repair, max: 10 }], [repair]);
    expect(h.writes[0].object.common.custom.ihome.overrides).toEqual([
      { ...repair, max: 10 },
      foreign,
    ]);
  });

  it("removes only the override that left the list", async () => {
    const foreign = {
      id: "f",
      stateId: "0_userdata.0.x",
      kind: "repair" as const,
      name: "foreign",
    };
    const objects = {
      "0_userdata.0.x": {
        common: {
          custom: { ihome: { version: 1, overrides: [repair, foreign] } },
        },
      },
    };
    const h = host(objects);
    expect(await syncOverrideObjects(h, [], [repair])).toMatchObject({
      removed: 1,
    });
    expect(h.writes[0].object.common.custom.ihome.overrides).toEqual([foreign]);
  });

  it("reads a state's overrides without writing", async () => {
    const h = host({
      "0_userdata.0.x": {
        common: { custom: { ihome: { version: 1, overrides: [repair] } } },
      },
    });
    expect(await readStateOverrides(h, "0_userdata.0.x")).toEqual([repair]);
    expect(h.writes).toEqual([]);
  });
});
