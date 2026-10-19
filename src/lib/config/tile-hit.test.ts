import { it, expect } from "vitest";
import {
  placementAt,
  placementUnder,
  type HitElement,
} from "$lib/config/tile-hit";

const box = { left: 0, top: 0, right: 10, bottom: 10 };

const el = (
  attrs: Record<string, string>,
  rect: typeof box = box,
): HitElement => ({
  getAttribute: (name: string) => attrs[name] ?? null,
  getBoundingClientRect: () => rect,
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

it("finds the tile whose box holds the point — the later one on overlap", () => {
  const left = el(
    {
      "data-placement-id": "left",
      "data-page-id": "rooms",
      "data-section-id": "bad",
    },
    { left: 0, top: 0, right: 10, bottom: 10 },
  );
  const right = el(
    {
      "data-placement-id": "right",
      "data-page-id": "rooms",
      "data-section-id": "bad",
    },
    { left: 8, top: 0, right: 18, bottom: 10 },
  );
  expect(placementUnder([left, right], 5, 5)?.placementId).toBe("left");
  expect(placementUnder([left, right], 9, 5)?.placementId).toBe("right");
  expect(placementUnder([left, right], 25, 5)).toBeNull();
  expect(placementUnder([], 5, 5)).toBeNull();
});
