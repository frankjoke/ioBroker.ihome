import { expect, it } from "vitest";
import {
  dropTargetFrom,
  planDrop,
  planUndo,
  type DragRect,
  type DragSection,
  type DragTile,
  type DropTarget,
} from "$lib/config/drag-drop";
import type { PageRegistry, Placement } from "$lib/types/display";

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
): DragRect => ({
  left,
  top,
  right: left + width,
  bottom: top + height,
  width,
  height,
});

const tile = (
  placementId: string,
  sectionId: string,
  box: DragRect,
): DragTile => ({ pageId: "p", sectionId, placementId, rect: box });

const styles = (
  sectionId: string,
  box: DragRect,
  contentRect?: DragRect,
): DragSection => ({ pageId: "p", sectionId, rect: box, contentRect });

const placement = (id: string): Placement => ({ id });

const registry = (): PageRegistry => ({
  version: 1,
  updatedAt: 1,
  pages: [
    {
      id: "p",
      title: "P",
      groups: [
        { id: "s", title: "S", tiles: [placement("a"), placement("b")] },
        { id: "t", title: "T", tiles: [] },
      ],
    },
  ],
});

const target = (index: number): DropTarget => ({
  pageId: "p",
  sectionId: "t",
  index,
  line: { left: 0, top: 0, height: 10 },
});

it("drops before or after a tile by its horizontal half", () => {
  const tiles = [
    tile("a", "s", rect(0, 0, 50, 50)),
    tile("b", "s", rect(60, 0, 50, 50)),
  ];
  const sections = [styles("s", rect(0, 0, 120, 60))];

  expect(dropTargetFrom(tiles, sections, 80, 10)).toEqual({
    pageId: "p",
    sectionId: "s",
    index: 1,
    line: { left: 56, top: 0, height: 50 },
  });
  expect(dropTargetFrom(tiles, sections, 100, 10)).toEqual({
    pageId: "p",
    sectionId: "s",
    index: 2,
    line: { left: 114, top: 0, height: 50 },
  });
});

it("appends when a section is hit outside its tiles", () => {
  const tiles = [
    tile("a", "s", rect(0, 0, 50, 50)),
    tile("b", "s", rect(60, 0, 50, 50)),
  ];
  const sections = [styles("s", rect(0, 0, 120, 60))];
  expect(dropTargetFrom(tiles, sections, 10, 55)).toEqual({
    pageId: "p",
    sectionId: "s",
    index: 2,
    line: { left: 114, top: 0, height: 50 },
  });
});

it("uses the grid box for an empty section", () => {
  const sections = [styles("u", rect(0, 100, 100, 60), rect(10, 120, 80, 30))];
  expect(dropTargetFrom([], sections, 20, 130)).toEqual({
    pageId: "p",
    sectionId: "u",
    index: 0,
    line: { left: 14, top: 128, height: 40 },
  });
});

it("answers null outside every section", () => {
  expect(
    dropTargetFrom(
      [tile("a", "s", rect(0, 0, 50, 50))],
      [styles("s", rect(0, 0, 50, 50))],
      500,
      500,
    ),
  ).toBeNull();
});

it("moves a tile to index 0 of another section", () => {
  const plan = planDrop(
    registry(),
    { pageId: "p", sectionId: "s", placementId: "a" },
    target(0),
  );
  expect(plan).not.toBeNull();
  expect(plan?.after.pages[0].groups[1].tiles?.map((t) => t.id)).toEqual(["a"]);
  expect(plan?.after.pages[0].groups[0].tiles?.map((t) => t.id)).toEqual(["b"]);
  expect(plan?.from).toEqual({
    pageId: "p",
    sectionId: "s",
    placementId: "a",
  });
  expect(plan?.to).toEqual({
    pageId: "p",
    sectionId: "t",
    placementId: "a",
  });
});

it("drops on itself as a no-op in the same section", () => {
  for (const index of [0, 1]) {
    expect(
      planDrop(
        registry(),
        { pageId: "p", sectionId: "s", placementId: "a" },
        {
          pageId: "p",
          sectionId: "s",
          index,
          line: { left: 0, top: 0, height: 1 },
        },
      ),
    ).toBeNull();
  }
});

it("reorders within the same section with the gap correction", () => {
  const plan = planDrop(
    registry(),
    { pageId: "p", sectionId: "s", placementId: "a" },
    {
      pageId: "p",
      sectionId: "s",
      index: 2,
      line: { left: 0, top: 0, height: 1 },
    },
  );
  expect(plan?.after.pages[0].groups[0].tiles?.map((t) => t.id)).toEqual([
    "b",
    "a",
  ]);
});

it("refuses a missing source or target section", () => {
  expect(
    planDrop(
      registry(),
      { pageId: "p", sectionId: "s", placementId: "missing" },
      target(0),
    ),
  ).toBeNull();
  expect(
    planDrop(
      registry(),
      { pageId: "p", sectionId: "s", placementId: "a" },
      { ...target(0), sectionId: "missing" },
    ),
  ).toBeNull();
});

it("allows undo only while the layout is still the moved one", () => {
  const plan = planDrop(
    registry(),
    { pageId: "p", sectionId: "s", placementId: "a" },
    target(0),
  );
  expect(plan).not.toBeNull();
  if (!plan) return;
  expect(planUndo(plan, plan.after, plan.after)).toBe(plan.before);
  expect(planUndo(plan, plan.after, registry())).toBeNull();
});
