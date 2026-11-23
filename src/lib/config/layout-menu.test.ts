import { it, expect } from "vitest";
import {
  layoutMenuItems,
  layoutMenuTargetKind,
  type LayoutMenuContext,
} from "$lib/config/layout-menu";

const editable: LayoutMenuContext = {
  writable: true,
  hasSection: true,
  hasPage: true,
};

const readOnly: LayoutMenuContext = {
  writable: false,
  hasSection: false,
  hasPage: false,
};

it("maps a tile selection to the tile actions", () => {
  const items = layoutMenuItems("tile", editable);
  expect(items.map((item) => item.id)).toEqual([
    "edit",
    "duplicate",
    "move",
    "delete",
  ]);
  expect(items.find((item) => item.id === "delete")?.danger).toBe(true);
});

it("keeps edit available but locks the writes when the layout is not writable", () => {
  const items = layoutMenuItems("tile", readOnly);
  expect(items.find((item) => item.id === "edit")?.disabled).not.toBe(true);
  for (const id of ["duplicate", "move", "delete"] as const) {
    expect(items.find((item) => item.id === id)?.disabled).toBe(true);
  }
});

it("adds a tile from a section and offers its deletion", () => {
  const items = layoutMenuItems("section", editable);
  expect(items.map((item) => item.id)).toEqual(["edit", "add-tile", "delete"]);
  expect(items.find((item) => item.id === "delete")?.danger).toBe(true);
});

it("offers add tile and add section on empty space", () => {
  const items = layoutMenuItems("empty", editable);
  expect(items.map((item) => item.id)).toEqual(["add-tile", "add-section"]);
  expect(items.every((item) => !item.disabled)).toBe(true);
});

it("disables empty-space creation without a section or page", () => {
  const items = layoutMenuItems("empty", readOnly);
  expect(items.every((item) => item.disabled)).toBe(true);
  expect(items.some((item) => item.id === "add-page")).toBe(true);
});

it("only offers Add page while no page exists", () => {
  expect(
    layoutMenuItems("empty", editable).some((item) => item.id === "add-page"),
  ).toBe(false);
  expect(
    layoutMenuItems("empty", { ...editable, hasPage: false }).some(
      (item) => item.id === "add-page",
    ),
  ).toBe(true);
});

it("reads the menu kind from the current selection", () => {
  expect(
    layoutMenuTargetKind({
      kind: "tile",
      pageId: "p",
      sectionId: "s",
      placementId: "t",
    }),
  ).toBe("tile");
  expect(
    layoutMenuTargetKind({ kind: "section", pageId: "p", sectionId: "s" }),
  ).toBe("section");
  expect(layoutMenuTargetKind({ kind: "page", pageId: "p" })).toBe("empty");
  expect(layoutMenuTargetKind(null)).toBe("empty");
});
