import { describe, it, expect } from "vitest";
import { applyRead, applyWrite } from "$lib/utils/transform";

describe("applyRead", () => {
  it("runs the read step", () => {
    expect(
      applyRead(50, {
        read: { kind: "scale", inMin: 0, inMax: 100, outMin: 0, outMax: 1 },
      }),
    ).toBe(0.5);
  });
  it("returns the value unchanged without a transform", () => {
    expect(applyRead(5, undefined)).toBe(5);
  });
  it("never throws on a bad formula", () => {
    expect(applyRead(5, { read: { kind: "formula", expr: "x*" } })).toBe(5);
  });
});

describe("applyWrite", () => {
  it("runs the write step", () => {
    expect(
      applyWrite(1, {
        write: { kind: "scale", inMin: 0, inMax: 1, outMin: 0, outMax: 100 },
      }),
    ).toBe(100);
  });
  it("returns the value unchanged without a transform", () => {
    expect(applyWrite("A", undefined)).toBe("A");
  });
});
