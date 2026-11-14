import { expect, it } from "vitest";
import {
  addFeature,
  moveFeature,
  removeFeature,
  setPrimaryFeature,
  updateFeature,
} from "./template-features";
import type { FeatureDef } from "./features";

function feature(
  name: string,
  overrides: Partial<FeatureDef> = {},
): FeatureDef {
  return {
    feature: name,
    label: name,
    widget: "value",
    roleHints: [],
    ...overrides,
  };
}

it("keeps the feature list immutable", () => {
  const source = [feature("power")];
  const next = addFeature(source, feature("brightness"));
  expect(next.map((f) => f.feature)).toEqual(["power", "brightness"]);
  expect(next[1].primary).toBe(false);
  expect(source).toHaveLength(1);
});

it("updates one row without touching the others", () => {
  const source = [feature("power"), feature("brightness")];
  const next = updateFeature(source, 1, { label: "Dim" });
  expect(next[1].label).toBe("Dim");
  expect(next[0]).toBe(source[0]);
});

it("moves the primary flag exclusively", () => {
  const next = setPrimaryFeature([feature("power"), feature("brightness")], 1);
  expect(next.map((f) => f.primary === true)).toEqual([false, true]);
});

it("moves and removes by index", () => {
  expect(
    moveFeature([feature("a"), feature("b")], 0, 1).map((f) => f.feature),
  ).toEqual(["b", "a"]);
  expect(
    removeFeature([feature("a"), feature("b")], 0).map((f) => f.feature),
  ).toEqual(["b"]);
});
