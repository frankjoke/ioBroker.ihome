import { it, expect } from "vitest";
import {
  BREAKPOINTS,
  DEFAULT_SPAN,
  SIZE_MAX_H,
  SIZE_MAX_W,
  breakpointFor,
  clampSpan,
  tileColumns,
} from "$lib/config/size-ops";

it("clamps hints per breakpoint", () => {
  expect(breakpointFor(599)).toBe("phone");
  expect(breakpointFor(600)).toBe("tablet");
  expect(breakpointFor(1024)).toBe("tablet");
  expect(breakpointFor(1025)).toBe("desktop");
  // `w` counts fine modules: 2 is today's plain 1×1 card, 4 an old 2-wide one.
  expect(clampSpan({ w: 2, h: 2 }, "phone")).toEqual({ w: 2, h: 2 });
  expect(clampSpan({ w: 4, h: 4 }, "phone")).toEqual({ w: 4, h: 4 });
  expect(clampSpan({ w: 4, h: 2 }, "tablet")).toEqual({ w: 4, h: 2 });
  expect(clampSpan({ w: 4, h: 4 }, "tablet")).toEqual({ w: 4, h: 4 });
  expect(clampSpan({ w: 4, h: 4 }, "desktop")).toEqual({ w: 4, h: 4 });
  // Every breakpoint shows the hint whole; the rendered width is clamped by
  // layoutSection/tileColumns, not by the size hint.
  expect(clampSpan({ w: 10, h: 10 }, "tablet")).toEqual({ w: 10, h: 10 });
  expect(clampSpan({ w: 10, h: 10 }, "desktop")).toEqual({ w: 10, h: 10 });
  expect(clampSpan({ w: 10, h: 10 }, "phone")).toEqual({ w: 10, h: 10 });
  expect(clampSpan({ w: 40, h: 20 }, "desktop")).toEqual({ w: 40, h: 20 });
  // Nothing in a document can ask for more than the axis cap.
  // (A document is untrusted JSON, so 41/21 can reach the clamp at runtime.)
  expect(clampSpan({ w: 41, h: 21 } as never, "desktop")).toEqual({
    w: SIZE_MAX_W,
    h: SIZE_MAX_H,
  });
  expect(clampSpan(undefined, "desktop")).toEqual({ w: 2, h: 2 });
  expect(clampSpan({ w: 1, h: 1 }, "phone")).toEqual({ w: 1, h: 1 });
  expect(DEFAULT_SPAN).toEqual({ w: 2, h: 2 });
});

it("floors a nonsense size to one module", () => {
  expect(clampSpan({ w: 0, h: -2 } as never, "desktop")).toEqual({
    w: 1,
    h: 1,
  });
});

it("clamps a tile's rendered columns to the section's module count", () => {
  expect(tileColumns(10, 7)).toBe(7); // a wide tile in a scaled, narrower section
  expect(tileColumns(2, 7)).toBe(2);
  expect(tileColumns(10, 0)).toBe(10); // fluid/preview: nothing to clamp to
});

it("keeps the values the stylesheet needs", () => {
  expect(
    BREAKPOINTS.map((b) => [b.name, b.tileW, b.tileH, b.maxW, b.maxH]),
  ).toEqual([
    ["phone", 28.5, 58, SIZE_MAX_W, SIZE_MAX_H],
    ["tablet", 23.5, 48, SIZE_MAX_W, SIZE_MAX_H],
    ["desktop", 26.5, 54, SIZE_MAX_W, SIZE_MAX_H],
  ]);
});

it("renders a 2×2 exactly as today's 1×1 plus 2px width", () => {
  // A 2-span tile adds one 6px grid gap. The row module stays exactly half, so
  // today's 1×1 height is preserved; the width is the approved +2px.
  expect(BREAKPOINTS.map((b) => [2 * b.tileW + 6, 2 * b.tileH + 6])).toEqual([
    [63, 122],
    [53, 102],
    [59, 114],
  ]);
});

it("covers every width exactly once", () => {
  expect(BREAKPOINTS.map((b) => b.minWidth)).toEqual([0, 600, 1025]);
});
