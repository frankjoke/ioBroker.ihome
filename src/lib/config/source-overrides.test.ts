import { describe, expect, it } from "vitest";
import {
  emptyOverrideRegistry,
  normalizeOverrideRegistry,
  overrideById,
  overrideNameTaken,
  overridesForState,
  removeOverride,
  upsertOverride,
} from "./source-overrides";

const repair = (over: Record<string, unknown> = {}) => ({
  id: "a",
  stateId: "s",
  kind: "repair" as const,
  name: "power",
  ...over,
});

describe("normalizeOverrideRegistry", () => {
  it("parses a registry and rejects junk", () => {
    const reg = normalizeOverrideRegistry({
      version: 1,
      updatedAt: 5,
      overrides: [{ id: "a", stateId: "s", kind: "repair", name: "power" }],
    });
    expect(reg?.overrides).toHaveLength(1);
    expect(
      normalizeOverrideRegistry({ version: 1, overrides: [{ id: "" }] }),
    ).toBeNull();
    expect(normalizeOverrideRegistry("x")).toBeNull();
  });

  it("drops entries without an id, stateId or name", () => {
    const reg = normalizeOverrideRegistry({
      version: 1,
      updatedAt: 5,
      overrides: [
        { id: "a", stateId: "s", kind: "repair", name: "power" },
        { id: "b", stateId: "", kind: "repair", name: "power" },
        { id: "c", stateId: "s", kind: "repair", name: " " },
        { stateId: "s", kind: "repair", name: "power" },
      ],
    });
    expect(reg?.overrides.map((o) => o.id)).toEqual(["a"]);
  });

  it("keeps only repair and derived, preserving optional fields", () => {
    const reg = normalizeOverrideRegistry({
      version: 1,
      updatedAt: 5,
      overrides: [
        repair({
          kind: "other",
        }),
        repair({
          id: "b",
          kind: "derived",
          unit: "°C",
          expr: "$.temp",
          inputs: ["s.temp"],
          transform: {
            read: { kind: "scale", inMin: 0, inMax: 1, outMin: 0, outMax: 100 },
          },
        }),
      ],
    });
    expect(reg?.overrides.map((o) => o.id)).toEqual(["b"]);
    expect(reg?.overrides[0].unit).toBe("°C");
    expect(reg?.overrides[0].expr).toBe("$.temp");
    expect(reg?.overrides[0].inputs).toEqual(["s.temp"]);
    expect(reg?.overrides[0].transform?.read?.kind).toBe("scale");
  });

  it("keeps an empty list and the migration marker", () => {
    const reg = normalizeOverrideRegistry({
      version: 1,
      updatedAt: 0,
      overrides: [],
      migratedDevices: true,
    });
    expect(reg?.overrides).toEqual([]);
    expect(reg?.migratedDevices).toBe(true);
  });

  it("rejects a document without an overrides array", () => {
    expect(normalizeOverrideRegistry({ version: 1, updatedAt: 5 })).toBeNull();
    expect(
      normalizeOverrideRegistry({ version: 1, overrides: "x" }),
    ).toBeNull();
  });
});

describe("registry lookups", () => {
  it("finds by id and by state", () => {
    const reg = upsertOverride(
      upsertOverride(emptyOverrideRegistry(), repair({ id: "a" })),
      repair({ id: "b", stateId: "other" }),
    );
    expect(overrideById(reg, "b")?.stateId).toBe("other");
    expect(overrideById(reg, "missing")).toBeUndefined();
    expect(overridesForState(reg, "s").map((o) => o.id)).toEqual(["a"]);
    expect(overridesForState(reg, "other").map((o) => o.id)).toEqual(["b"]);
  });

  it("keeps names unique per state, case-insensitive", () => {
    const reg = upsertOverride(emptyOverrideRegistry(), {
      id: "a",
      stateId: "s",
      kind: "repair",
      name: "Power",
    });
    expect(overrideNameTaken(reg, "s", "power")).toBe(true);
    expect(overrideNameTaken(reg, "s", " POWER ")).toBe(true);
    expect(overrideNameTaken(reg, "s", "power", "a")).toBe(false);
    expect(overrideNameTaken(reg, "other", "power")).toBe(false);
    expect(overrideNameTaken(reg, "s", "  ")).toBe(false);
  });
});

describe("upsertOverride / removeOverride", () => {
  it("upserts by id and removes by id", () => {
    const reg = upsertOverride(emptyOverrideRegistry(), {
      id: "a",
      stateId: "s",
      kind: "repair",
      name: "power",
    });
    const updated = upsertOverride(reg, {
      id: "a",
      stateId: "s",
      kind: "repair",
      name: "switch",
    });
    expect(updated.overrides).toHaveLength(1);
    expect(updated.overrides[0].name).toBe("switch");
    expect(removeOverride(updated, "a").overrides).toEqual([]);
  });

  it("appends a new id and never mutates the input", () => {
    const reg = upsertOverride(emptyOverrideRegistry(), repair());
    const next = upsertOverride(reg, repair({ id: "b" }));
    expect(reg.overrides).toHaveLength(1);
    expect(next.overrides.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("does not bump updatedAt and keeps the migration marker", () => {
    const base = {
      ...emptyOverrideRegistry(),
      updatedAt: 7,
      migratedDevices: true,
    };
    const next = upsertOverride(base, repair());
    expect(next.updatedAt).toBe(7);
    expect(next.migratedDevices).toBe(true);
    expect(removeOverride(next, "a").updatedAt).toBe(7);
  });
});
