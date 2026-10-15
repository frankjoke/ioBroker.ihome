import { it, expect } from "vitest";
import { layoutSection, modulesFor } from "$lib/config/section-layout";
import type { Group, Placement } from "$lib/types/display";
import type { ResolvedTile } from "$lib/config/pages-ops";

const tile = (id: string, span: number, newLine = false): ResolvedTile => {
  SPANS[id] = span;
  return {
    placement: {
      id,
      device: `dev-${id}`,
      ...(newLine ? { newLine } : {}),
    } as Placement,
    device: {
      id: `dev-${id}`,
      name: id,
      type: "Value",
      visibleControls: 1,
    } as ResolvedTile["device"],
  };
};
const spanOf = (t: ResolvedTile) => SPANS[t.placement.id] ?? 1;
const SPANS: Record<string, number> = {};

const section = (g: Partial<Group> = {}): Group => ({ id: "g", ...g });

it("counts how many tile modules fit in a width", () => {
  expect(modulesFor(57, 57, 6, 0)).toBe(1);
  expect(modulesFor(120, 57, 6, 0)).toBe(2);
  expect(modulesFor(119, 57, 6, 0)).toBe(1);
  expect(modulesFor(1000, 57, 6, 24)).toBe(15);
  expect(modulesFor(10, 57, 6, 0)).toBe(1); // never zero
});

it("places tiles left to right and wraps when the line is full", () => {
  const placed = layoutSection(
    section(),
    [tile("a", 1), tile("b", 2), tile("c", 1)],
    spanOf,
    4,
  );
  expect(
    placed.tiles.map((t) => [t.placement.id, t.row, t.column, t.span]),
  ).toEqual([
    ["a", 0, 0, 1],
    ["b", 0, 1, 2],
    ["c", 0, 3, 1],
  ]);
  expect(placed.modules).toBe(4);
  expect(placed.rows).toBe(1);
});

it("starts a new row only when the tile does not fit", () => {
  const placed = layoutSection(
    section(),
    [tile("a", 2), tile("b", 2), tile("c", 2)],
    spanOf,
    3,
  );
  expect(placed.tiles.map((t) => [t.placement.id, t.row, t.column])).toEqual([
    ["a", 0, 0],
    ["b", 1, 0],
    ["c", 2, 0],
  ]);
  expect(placed.modules).toBe(2);
  expect(placed.rows).toBe(3);
});

it("honours newLine on a tile even when it would still fit", () => {
  const placed = layoutSection(
    section(),
    [tile("a", 1), tile("b", 1, true), tile("c", 1)],
    spanOf,
    4,
  );
  expect(placed.tiles.map((t) => [t.placement.id, t.row, t.column])).toEqual([
    ["a", 0, 0],
    ["b", 1, 0],
    ["c", 1, 1],
  ]);
  expect(placed.modules).toBe(2);
});

it("clamps a span wider than the page and keeps single tiles on their own row", () => {
  const placed = layoutSection(
    section(),
    [tile("wide", 4), tile("b", 1)],
    spanOf,
    2,
  );
  expect(
    placed.tiles.map((t) => [t.placement.id, t.row, t.column, t.span]),
  ).toEqual([
    ["wide", 0, 0, 2],
    ["b", 1, 0, 1],
  ]);
  expect(placed.modules).toBe(2);
});

it("carries the section, including its own newLine, and an empty section has no modules", () => {
  const empty = layoutSection(section({ newLine: true }), [], spanOf, 4);
  expect(empty.modules).toBe(0);
  expect(empty.rows).toBe(0);
  expect(empty.group.newLine).toBe(true);
});
