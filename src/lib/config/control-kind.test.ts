import { describe, it, expect } from "vitest";
import { switchControlKind } from "$lib/config/control-kind";
import type { Control } from "$lib/types/device";

const base: Control = {
  id: "c",
  feature: "power",
  stateId: "a.0.b",
  writable: true,
  transform: { read: { kind: "formula", expr: "x" } },
};

describe("switchControlKind", () => {
  it("switching to virtual clears stateId/transform and makes it read-only", () => {
    const v = switchControlKind(base, "virtual");
    expect(v.kind).toBe("virtual");
    expect(v.stateId).toBeUndefined();
    expect(v.transform).toBeUndefined();
    expect(v.writable).toBe(false);
    expect(v.virtual).toEqual({ expr: "" });
  });
  it("switching to state clears virtual and restores writable", () => {
    const v = switchControlKind(
      { ...base, kind: "virtual", writable: false, virtual: { expr: "1" } },
      "state",
    );
    expect(v.kind).toBeUndefined();
    expect(v.virtual).toBeUndefined();
    expect(v.writable).toBe(true);
  });
});
