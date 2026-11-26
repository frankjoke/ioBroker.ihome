import { it, expect } from "vitest";
import {
  displayMenuItems,
  layoutMenuItems,
  layoutMenuTargetKind,
  type DisplayMenuContext,
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

it("offers add tile, add section and delete page on empty space", () => {
  const items = layoutMenuItems("empty", editable);
  expect(items.map((item) => item.id)).toEqual([
    "add-tile",
    "add-section",
    "delete-page",
  ]);
  expect(items.every((item) => !item.disabled)).toBe(true);
  expect(items.find((item) => item.id === "delete-page")?.danger).toBe(true);
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
  expect(
    layoutMenuItems("empty", { ...editable, hasPage: false }).some(
      (item) => item.id === "delete-page",
    ),
  ).toBe(false);
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

const liveMenu: DisplayMenuContext = {
  writable: true,
  templatesWritable: true,
};

it("offers the eye-view tile actions in order", () => {
  const items = displayMenuItems("tile", liveMenu);
  expect(items.map((item) => item.id)).toEqual([
    "edit",
    "duplicate",
    "save-template",
    "add-tile",
    "move",
    "delete",
  ]);
  expect(items.find((item) => item.id === "delete")?.danger).toBe(true);
});

it("keeps edit available but locks layout writes in the eye-view menu", () => {
  const items = displayMenuItems("tile", {
    writable: false,
    templatesWritable: false,
  });
  expect(items.find((item) => item.id === "edit")?.disabled).not.toBe(true);
  for (const id of [
    "duplicate",
    "save-template",
    "add-tile",
    "move",
    "delete",
  ] as const) {
    expect(items.find((item) => item.id === id)?.disabled).toBe(true);
  }
});

it("saves a template even when the layout document is read-only", () => {
  const items = displayMenuItems("tile", {
    writable: false,
    templatesWritable: true,
  });
  expect(items.find((item) => item.id === "save-template")?.disabled).not.toBe(
    true,
  );
  expect(items.find((item) => item.id === "duplicate")?.disabled).toBe(true);
});

it("offers add, move and delete on a section", () => {
  const items = displayMenuItems("section", liveMenu);
  expect(items.map((item) => item.id)).toEqual([
    "add-tile",
    "move-section",
    "delete",
  ]);
  expect(items.find((item) => item.id === "delete")?.danger).toBe(true);
  expect(items.every((item) => !item.disabled)).toBe(true);
});

it("offers add section on free page space", () => {
  const items = displayMenuItems("empty", liveMenu);
  expect(items.map((item) => item.id)).toEqual(["add-section"]);
  expect(items[0].disabled).not.toBe(true);
});

it("locks the section and empty-space writes when the layout is read-only", () => {
  const readOnly = { writable: false, templatesWritable: false };
  for (const kind of ["section", "empty"] as const) {
    expect(
      displayMenuItems(kind, readOnly).every((item) => item.disabled),
    ).toBe(true);
  }
});
