import { it, expect } from "vitest";
import {
  addPage,
  addSection,
  appendDevices,
  deletePage,
  deletePlacement,
  deleteSection,
  duplicatePage,
  duplicatePlacement,
  duplicateSection,
  moveItem,
  movePage,
  movePlacement,
  moveSection,
  patchPage,
  patchPlacement,
  patchSection,
} from "$lib/config/layout-ops";
import type { Group, Page, PageRegistry } from "$lib/types/display";

const reg = (pages: Page[]): PageRegistry => ({
  version: 1,
  updatedAt: 1,
  pages,
});

const section = (id: string, devices: string[] = []): Group => ({
  id,
  title: id.toUpperCase(),
  tiles: devices.map((device, i) => ({ id: `${id}-t${i}`, device })),
});

/** One page, two sections: `g` holds one tile (device `t1dev`), `g2` is empty. */
const regWithTiles = (): PageRegistry =>
  reg([
    {
      id: "p",
      title: "P",
      groups: [section("g", ["t1dev"]), section("g2")],
    },
  ]);

it("moves an item, and does nothing for an equal or out-of-range index", () => {
  expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  expect(moveItem(["a", "b"], 0, 9)).toEqual(["a", "b"]);
  expect(moveItem(["a", "b"], -1, 0)).toEqual(["a", "b"]);
  expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  // always a copy, never the same array
  const list = ["a"];
  expect(moveItem(list, 0, 0)).not.toBe(list);
});

it("duplicates a section with fresh ids at every level below it", () => {
  const reg0 = regWithTiles();
  const next = duplicateSection(reg0, "p", "g");
  const [orig, copy] = next.pages[0].groups;
  expect(copy.id).not.toBe(orig.id);
  expect(copy.tiles?.[0].id).not.toBe(orig.tiles?.[0].id);
  expect(copy.tiles?.[0].device).toBe(orig.tiles?.[0].device);
  expect(next.pages[0].groups).toHaveLength(3);
  // the input registry is untouched
  expect(reg0.pages[0].groups).toHaveLength(2);
  expect(reg0.pages[0].groups[0].tiles?.[0].id).toBe("g-t0");
});

it("duplicates a page with fresh ids for its sections and tiles", () => {
  const next = duplicatePage(regWithTiles(), "p");
  const [orig, copy] = next.pages;
  expect(copy.id).not.toBe(orig.id);
  expect(copy.groups[0].id).not.toBe(orig.groups[0].id);
  expect(copy.groups[0].tiles?.[0].id).not.toBe(orig.groups[0].tiles?.[0].id);
  expect(copy.groups[0].tiles?.[0].device).toBe("t1dev");
});

it("appends devices once, in order, skipping what is already there", () => {
  const next = appendDevices(regWithTiles(), "p", "g", [
    "x",
    "t1dev",
    "y",
    "x",
  ]);
  expect(next.pages[0].groups[0].tiles?.map((t) => t.device)).toEqual([
    "t1dev",
    "x",
    "y",
  ]);
});

it("moves a placement between sections", () => {
  const next = movePlacement(
    regWithTiles(),
    { pageId: "p", sectionId: "g", index: 0 },
    { pageId: "p", sectionId: "g2", index: 0 },
  );
  expect(next.pages[0].groups[0].tiles).toEqual([]);
  expect(next.pages[0].groups[1].tiles?.map((t) => t.device)).toEqual([
    "t1dev",
  ]);
});

it("reorders inside a section and refuses an impossible move", () => {
  const two = reg([
    { id: "p", title: "P", groups: [section("g", ["a", "b", "c"])] },
  ]);
  const next = movePlacement(
    two,
    { pageId: "p", sectionId: "g", index: 0 },
    { pageId: "p", sectionId: "g", index: 2 },
  );
  expect(next.pages[0].groups[0].tiles?.map((t) => t.device)).toEqual([
    "b",
    "c",
    "a",
  ]);
  const same = movePlacement(
    two,
    { pageId: "p", sectionId: "g", index: 1 },
    { pageId: "p", sectionId: "g", index: 9 },
  );
  expect(same.pages[0].groups[0].tiles?.map((t) => t.device)).toEqual([
    "a",
    "b",
    "c",
  ]);
});

it("deletes and duplicates a single placement", () => {
  const del = deletePlacement(regWithTiles(), "p", "g", "g-t0");
  expect(del.pages[0].groups[0].tiles).toEqual([]);
  const dup = duplicatePlacement(regWithTiles(), "p", "g", "g-t0");
  expect(dup.pages[0].groups[0].tiles?.map((t) => t.device)).toEqual([
    "t1dev",
    "t1dev",
  ]);
  expect(dup.pages[0].groups[0].tiles?.[0].id).not.toBe(
    dup.pages[0].groups[0].tiles?.[1].id,
  );
});

it("adds a page and a section with a fresh id and an empty list", () => {
  const withPage = addPage(regWithTiles(), "Chores");
  expect(withPage.pages).toHaveLength(2);
  expect(withPage.pages[1].title).toBe("Chores");
  expect(withPage.pages[1].groups).toEqual([]);

  const withSection = addSection(withPage, "p", "New");
  expect(withSection.pages[0].groups).toHaveLength(3);
  expect(withSection.pages[0].groups[2].tiles).toEqual([]);
  expect(withSection.pages[0].groups[2].id).toBeTruthy();
});

it("moves a page and a section by index", () => {
  const twoPages = addPage(regWithTiles(), "Second");
  expect(movePage(twoPages, 1, 0).pages.map((p) => p.title)).toEqual([
    "Second",
    "P",
  ]);
  expect(
    moveSection(regWithTiles(), "p", 1, 0).pages[0].groups.map((g) => g.id),
  ).toEqual(["g2", "g"]);
});

it("returns the registry unchanged for an unknown page or section", () => {
  const reg0 = regWithTiles();
  expect(deleteSection(reg0, "nope", "g").pages).toEqual(reg0.pages);
  expect(deletePage(reg0, "nope").pages).toEqual(reg0.pages);
  expect(
    appendDevices(reg0, "p", "nope", ["x"]).pages[0].groups[0].tiles,
  ).toEqual(reg0.pages[0].groups[0].tiles);
  expect(deletePage(reg0, "nope").pages[0].groups[0].tiles?.[0].device).toBe(
    "t1dev",
  );
});

it("patches a section's own fields and drops a cleared one", () => {
  const next = patchSection(regWithTiles(), "p", "g", {
    title: "Neue",
    appearance: { border: true },
  });
  const [patched, other] = next.pages[0].groups;
  expect(patched.title).toBe("Neue");
  expect(patched.appearance).toEqual({ border: true });
  expect(patched.tiles).toHaveLength(1); // the placements are untouched
  expect(other.title).toBe("G2");
  // an empty field removes the property instead of storing ""
  const cleared = patchSection(regWithTiles(), "p", "g", { title: undefined });
  expect(cleared.pages[0].groups[0].title).toBeUndefined();
  expect(regWithTiles().pages[0].groups[0].title).toBe("G");
});

it("patches one placement and leaves its siblings alone", () => {
  const reg0 = reg([
    { id: "p", title: "P", groups: [section("g", ["a", "b"])] },
  ]);
  const next = patchPlacement(reg0, "p", "g", "g-t1", {
    title: "B",
    tile: { size: { w: 2, h: 1 } },
  });
  const tiles = next.pages[0].groups[0].tiles ?? [];
  expect(tiles[1].title).toBe("B");
  expect(tiles[1].tile?.size).toEqual({ w: 2, h: 1 });
  expect(tiles[0].title).toBeUndefined();
  expect(tiles[0].tile).toBeUndefined();
  // the input registry is untouched
  expect(reg0.pages[0].groups[0].tiles?.[1].title).toBeUndefined();
});

it("patches a page (its title) without touching its sections", () => {
  const next = patchPage(regWithTiles(), "p", { title: "Wohnen" });
  expect(next.pages[0].title).toBe("Wohnen");
  expect(next.pages[0].groups).toHaveLength(2);
  expect(next.pages[0].groups[0].tiles).toHaveLength(1);
  expect(regWithTiles().pages[0].title).toBe("P");
});
