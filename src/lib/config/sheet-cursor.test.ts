import { it, expect } from "vitest";
import { sheetCursor, swapDecision, tileLabel } from "$lib/config/sheet-cursor";
import type { Group, Page, PageRegistry, Placement } from "$lib/types/display";

const placement = (id: string, device = "d1"): Placement => ({
  id,
  device,
});

const section = (id: string, tiles: Placement[] = []): Group => ({
  id,
  title: id.toUpperCase(),
  tiles,
});

const reg = (pages: Page[]): PageRegistry => ({
  version: 1,
  updatedAt: 1,
  pages,
});

/** Two pages, so "a section of another page is not honoured" can be tested. */
const twoPages = (): PageRegistry =>
  reg([
    {
      id: "rooms",
      title: "Rooms",
      groups: [section("bad", [placement("t1"), placement("t2")])],
    },
    {
      id: "home",
      title: "Home",
      groups: [section("klima", [placement("t3", "d9")]), section("empty")],
    },
  ]);

it("falls back to the first page when the selection names a page that is gone", () => {
  const c = sheetCursor(twoPages(), { kind: "page", pageId: "gone" });
  expect(c.pageId).toBe("rooms");
  expect(c.sectionId).toBe("bad");
  expect(c.tileId).toBe("t1");
});

it("does not honour a section from another page", () => {
  const c = sheetCursor(twoPages(), {
    kind: "section",
    pageId: "rooms",
    sectionId: "klima",
  });
  expect(c.pageId).toBe("rooms");
  expect(c.sectionId).toBe("bad");
});

it("falls back to the section's first tile, and reports -1 when there are none", () => {
  const filled = sheetCursor(twoPages(), {
    kind: "section",
    pageId: "home",
    sectionId: "klima",
  });
  expect(filled.tileId).toBe("t3");
  expect(filled.tileIndex).toBe(0);

  const empty = sheetCursor(twoPages(), {
    kind: "section",
    pageId: "home",
    sectionId: "empty",
  });
  expect(empty.tileId).toBe("");
  expect(empty.tile).toBeUndefined();
  expect(empty.tileIndex).toBe(-1);
});

it("keeps a tile that is still there", () => {
  const c = sheetCursor(twoPages(), {
    kind: "tile",
    pageId: "rooms",
    sectionId: "bad",
    placementId: "t2",
  });
  expect(c.tileId).toBe("t2");
  expect(c.tileIndex).toBe(1);
  expect(c.tile?.device).toBe("d1");
});

it("falls back to the section's first tile when the selected one is gone", () => {
  const c = sheetCursor(twoPages(), {
    kind: "tile",
    pageId: "rooms",
    sectionId: "bad",
    placementId: "deleted-tile",
  });
  expect(c.tileId).toBe("t1");
  expect(c.tileIndex).toBe(0);
});

it("survives a document with no pages at all", () => {
  const c = sheetCursor(reg([]), null);
  expect(c.pageId).toBe("");
  expect(c.sectionId).toBe("");
  expect(c.tileId).toBe("");
  expect(c.tileIndex).toBe(-1);
});

it("takes the display's page when it is given, and the selection's otherwise", () => {
  const c = sheetCursor(twoPages(), { kind: "page", pageId: "rooms" }, "home");
  expect(c.pageId).toBe("home");
  expect(c.sectionId).toBe("klima");
  // The display's page is gone (deleted meanwhile): the first page wins.
  expect(sheetCursor(twoPages(), null, "gone").pageId).toBe("rooms");
});

it("decides what changing a tile's device means", () => {
  expect(swapDecision(undefined, "d2")).toBe("noop");
  expect(swapDecision(placement("t1", "d1"), "")).toBe("noop");
  expect(swapDecision(placement("t1", "d1"), "d1")).toBe("noop");
  expect(swapDecision(placement("t1", "d1"), "d2")).toBe("apply");
  const own = { ...placement("t1", "d1"), tile: { slots: [] } };
  expect(swapDecision(own, "d2")).toBe("confirm");
});

it("labels a tile name · w×h, degrading one step at a time", () => {
  const sized: Placement = {
    ...placement("t1", "d1"),
    tile: { size: { w: 6, h: 4 } },
  };
  expect(tileLabel(sized, "Heizung")).toBe("Heizung · 6×4");
  expect(tileLabel({ ...sized, title: "Warmwasser" }, "Heizung")).toBe(
    "Warmwasser · 6×4",
  );
  // No device left (deleted), no title: the id it still points at.
  expect(tileLabel(placement("t1", "e59a"))).toBe("e59a");
  expect(tileLabel({ ...placement("t1"), title: "" }, "Garten")).toBe("Garten");
});

it("labels a blank placement and keeps a title over the fallback", () => {
  expect(tileLabel({ id: "t", device: "@blank" })).toBe("Blank tile");
  expect(tileLabel({ id: "t", device: "@blank", title: "Frame" })).toBe(
    "Frame",
  );
});

it("swaps a blank placement without the config-loss confirmation", () => {
  expect(
    swapDecision({ id: "t", device: "@blank", tile: { slots: [] } }, "dev-1"),
  ).toBe("apply");
  expect(swapDecision({ id: "t", device: "@blank" }, "")).toBe("noop");
});
