import { it, expect } from "vitest";
import {
  BREAKPOINTS,
  DEFAULT_SPAN,
  SIZE_MAX,
  breakpointFor,
  clampSpan,
  tileColumns,
} from "$lib/config/size-ops";
import { modulesFor } from "$lib/config/section-layout";

it("clamps hints per breakpoint", () => {
  expect(breakpointFor(599)).toBe("phone");
  expect(breakpointFor(600)).toBe("tablet");
  expect(breakpointFor(1024)).toBe("tablet");
  expect(breakpointFor(1025)).toBe("desktop");
  // `w` counts half-modules: 2 is a plain tile, 4 an old 2-wide one.
  expect(clampSpan({ w: 2, h: 2 }, "phone")).toEqual({ w: 2, h: 2 });
  expect(clampSpan({ w: 4, h: 4 }, "phone")).toEqual({ w: 2, h: 2 });
  expect(clampSpan({ w: 4, h: 2 }, "tablet")).toEqual({ w: 4, h: 2 });
  expect(clampSpan({ w: 4, h: 4 }, "tablet")).toEqual({ w: 4, h: 4 });
  expect(clampSpan({ w: 4, h: 4 }, "desktop")).toEqual({ w: 4, h: 4 });
  // A big tile (A2): a tablet and a desktop show it whole, a phone still clamps.
  expect(clampSpan({ w: 10, h: 10 }, "tablet")).toEqual({ w: 10, h: 10 });
  expect(clampSpan({ w: 10, h: 10 }, "desktop")).toEqual({ w: 10, h: 10 });
  expect(clampSpan({ w: 10, h: 10 }, "phone")).toEqual({ w: 2, h: 2 });
  // Nothing in a document can ask for more than SIZE_MAX; every cap is ≤ it.
  // (A document is untrusted JSON, so 11 can reach the clamp at runtime.)
  expect(clampSpan({ w: 11, h: 11 } as never, "desktop")).toEqual({
    w: SIZE_MAX,
    h: SIZE_MAX,
  });
  expect(clampSpan(undefined, "desktop")).toEqual({ w: 1, h: 1 });
  expect(clampSpan({ w: 1, h: 1 }, "phone")).toEqual({ w: 1, h: 1 });
  expect(DEFAULT_SPAN).toEqual({ w: 1, h: 1 });
});

// A tile renders with its own span, and the layout pass clamps only the
// section — so a cap above the page's module count would push the tile out of
// its section. The widths here are the narrowest each breakpoint can be.
it("keeps every cap inside what a page of that breakpoint can show", () => {
  for (const b of BREAKPOINTS) {
    const width = b.name === "phone" ? 320 : b.minWidth;
    expect(b.maxW).toBeLessThanOrEqual(modulesFor(width, b.tileW, 6, 24));
  }
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
    ["phone", 45, 90, 2, 2],
    ["tablet", 51, 102, SIZE_MAX, SIZE_MAX],
    ["desktop", 57, 114, SIZE_MAX, SIZE_MAX],
  ]);
  // the column module is half the row module, which is what makes `w: 1` a
  // half-width card
  for (const b of BREAKPOINTS) expect(b.tileH / b.tileW).toBe(2);
});

it("covers every width exactly once", () => {
  expect(BREAKPOINTS.map((b) => b.minWidth)).toEqual([0, 600, 1025]);
});
