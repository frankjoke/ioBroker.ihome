import { describe, it, expect } from "vitest";
import {
  runStep,
  resolveJsonPath,
  migrateTransform,
  migrateRegistry,
} from "$lib/config/transform-ops";

describe("runStep scale", () => {
  it("maps the input range to the output range", () => {
    expect(
      runStep({ kind: "scale", inMin: 0, inMax: 100, outMin: 0, outMax: 1 }, 50)
        .value,
    ).toBe(0.5);
  });
  it("clamps when clamp is not false", () => {
    expect(
      runStep(
        { kind: "scale", inMin: 0, inMax: 100, outMin: 0, outMax: 1 },
        200,
      ).value,
    ).toBe(1);
  });
  it("does not divide by zero when inMin === inMax", () => {
    expect(
      runStep({ kind: "scale", inMin: 5, inMax: 5, outMin: 7, outMax: 9 }, 5)
        .value,
    ).toBe(7);
  });
  it("rounds to the given number of decimals", () => {
    expect(
      runStep(
        { kind: "scale", inMin: 0, inMax: 3, outMin: 0, outMax: 1, round: 2 },
        1,
      ).value,
    ).toBe(0.33);
  });
  it("ignores an out-of-range round instead of throwing", () => {
    const r = runStep(
      { kind: "scale", inMin: 0, inMax: 100, outMin: 0, outMax: 1, round: -1 },
      50,
    );
    expect(r.value).toBe(0.5);
  });
});

describe("runStep map", () => {
  it("maps known keys", () => {
    expect(
      runStep({ kind: "map", map: { ON: true, OFF: false } }, "ON").value,
    ).toBe(true);
  });
  it("passes unknown keys through", () => {
    expect(runStep({ kind: "map", map: { ON: true } }, "X").value).toBe("X");
  });
});

describe("runStep formula", () => {
  it("evaluates a valid expression", () => {
    expect(runStep({ kind: "formula", expr: "x*2+1" }, 3).value).toBe(7);
  });
  it("falls back to the raw value and reports an error on invalid syntax", () => {
    const r = runStep({ kind: "formula", expr: "x*" }, 3);
    expect(r.value).toBe(3);
    expect(r.error).toBeTruthy();
  });
  it("falls back to the raw value and reports an error on a runtime throw", () => {
    const r = runStep({ kind: "formula", expr: "x.foo.bar" }, 3);
    expect(r.value).toBe(3);
    expect(r.error).toBeTruthy();
  });
});

describe("runStep jsonpath", () => {
  it("extracts a nested value", () => {
    expect(
      runStep({ kind: "jsonpath", path: "a.b" }, { a: { b: 42 } }).value,
    ).toBe(42);
  });
  it("extracts an array index", () => {
    expect(
      runStep({ kind: "jsonpath", path: "s[0].v" }, { s: [{ v: 9 }] }).value,
    ).toBe(9);
  });
  it("returns the original value when the path is missing", () => {
    expect(
      runStep({ kind: "jsonpath", path: "a.z" }, { a: { b: 1 } }).value,
    ).toEqual({ a: { b: 1 } });
  });
});

describe("resolveJsonPath", () => {
  it("returns undefined for a missing segment", () => {
    expect(resolveJsonPath({ a: 1 }, "a.b")).toBeUndefined();
  });
});

describe("migrateTransform", () => {
  it("migrates a legacy scale to both directions", () => {
    const t = migrateTransform({
      type: "scale",
      inMin: 0,
      inMax: 10,
      outMin: 0,
      outMax: 100,
    });
    expect(t?.read).toMatchObject({ kind: "scale", outMax: 100 });
    expect(t?.write).toMatchObject({ kind: "scale" });
  });
  it("migrates a legacy map read/write", () => {
    const t = migrateTransform({
      type: "map",
      read: { A: 1 },
      write: { 1: "A" },
    });
    expect(t?.read).toEqual({ kind: "map", map: { A: 1 } });
    expect(t?.write).toEqual({ kind: "map", map: { 1: "A" } });
  });
  it("passes through an already-migrated transform", () => {
    const t = migrateTransform({ read: { kind: "formula", expr: "x" } });
    expect(t?.read).toEqual({ kind: "formula", expr: "x" });
  });
  it("returns undefined for undefined", () => {
    expect(migrateTransform(undefined)).toBeUndefined();
  });
});

describe("migrateRegistry", () => {
  it("migrates each control's transform and preserves the rest", () => {
    const raw = {
      version: 1,
      updatedAt: 0,
      devices: [
        {
          id: "d1",
          name: "D",
          type: "Switch",
          controls: [
            {
              id: "c1",
              feature: "power",
              stateId: "a.0.b",
              writable: true,
              readable: true,
              transform: {
                type: "scale",
                inMin: 0,
                inMax: 1,
                outMin: 0,
                outMax: 100,
              },
            },
          ],
        },
      ],
    };
    const out = migrateRegistry(raw);
    expect(out.devices[0].controls[0].transform.read.kind).toBe("scale");
    expect(out.devices[0].controls[0].feature).toBe("power");
  });
  it("normalises a legacy boolean ON/OFF unit to OFF/ON", () => {
    const raw = {
      version: 1,
      updatedAt: 0,
      devices: [
        {
          id: "d1",
          name: "D",
          type: "Switch",
          controls: [
            { id: "c1", feature: "power", stateId: "a.0.b", unit: "ON/OFF" },
          ],
        },
      ],
    };
    const out = migrateRegistry(raw);
    expect(out.devices[0].controls[0].unit).toBe("OFF/ON");
  });

  it("aligns a control's feature with its device type", () => {
    const raw = {
      version: 1,
      updatedAt: 0,
      devices: [
        {
          id: "d1",
          name: "B",
          type: "Button",
          controls: [{ id: "c1", feature: "power", stateId: "a.0.b" }],
        },
        {
          id: "d2",
          name: "S",
          type: "Switch",
          controls: [{ id: "c2", feature: "power", stateId: "a.0.c" }],
        },
        {
          id: "d3",
          name: "X",
          type: "Mystery",
          controls: [{ id: "c3", feature: "power", stateId: "a.0.d" }],
        },
      ],
    };
    const out = migrateRegistry(raw);
    expect(out.devices[0].controls[0].feature).toBe("press");
    expect(out.devices[1].controls[0].feature).toBe("power");
    // An unknown type is left alone (there is no feature list to align to).
    expect(out.devices[2].controls[0].feature).toBe("power");
  });
});
