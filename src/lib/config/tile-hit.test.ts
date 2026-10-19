import { it, expect } from "vitest";
import { placementAt, type HitElement } from "$lib/config/tile-hit";

const el = (attrs: Record<string, string>): HitElement => ({
  getAttribute: (name: string) => attrs[name] ?? null,
});

it("takes the innermost element that carries a placement", () => {
  const stack = [
    el({}),
    el({
      "data-placement-id": "inner",
      "data-page-id": "p",
      "data-section-id": "s",
    }),
    el({
      "data-placement-id": "outer",
      "data-page-id": "p",
      "data-section-id": "s",
    }),
  ];
  expect(placementAt(stack)?.placementId).toBe("inner");
});

it("returns null when nothing in the stack carries one", () => {
  // A gap, a section heading, the page background.
  expect(placementAt([el({}), el({ class: "grid" })])).toBeNull();
  expect(placementAt([])).toBeNull();
});

it("reads page, section and placement from the element", () => {
  const stack = [
    el({
      "data-placement-id": "t1",
      "data-page-id": "rooms",
      "data-section-id": "bad",
    }),
  ];
  expect(placementAt(stack)).toEqual({
    pageId: "rooms",
    sectionId: "bad",
    placementId: "t1",
  });
});

it("ignores an element whose placement id is empty", () => {
  const stack = [
    el({
      "data-placement-id": "",
      "data-page-id": "rooms",
      "data-section-id": "bad",
    }),
    el({
      "data-placement-id": "t1",
      "data-page-id": "rooms",
      "data-section-id": "bad",
    }),
  ];
  expect(placementAt(stack)?.placementId).toBe("t1");
});
