import { it, expect } from "vitest";
import {
  BREAKPOINTS,
  DEFAULT_SPAN,
  breakpointFor,
  clampSpan,
} from "$lib/config/size-ops";

it("clamps hints per breakpoint", () => {
  expect(breakpointFor(599)).toBe("phone");
  expect(breakpointFor(600)).toBe("tablet");
  expect(breakpointFor(1024)).toBe("tablet");
  expect(breakpointFor(1025)).toBe("desktop");
  expect(clampSpan({ w: 2, h: 2 }, "phone")).toEqual({ w: 1, h: 2 });
  expect(clampSpan({ w: 4, h: 2 }, "tablet")).toEqual({ w: 2, h: 2 });
  expect(clampSpan({ w: 4, h: 4 }, "desktop")).toEqual({ w: 4, h: 4 });
  expect(clampSpan(undefined, "desktop")).toEqual({ w: 1, h: 1 });
  expect(clampSpan({ w: 1, h: 1 }, "phone")).toEqual({ w: 1, h: 1 });
  expect(DEFAULT_SPAN).toEqual({ w: 1, h: 1 });
});

it("floors a nonsense size to one module", () => {
  expect(clampSpan({ w: 0, h: -2 } as never, "desktop")).toEqual({
    w: 1,
    h: 1,
  });
});

it("keeps the values the stylesheet needs", () => {
  expect(BREAKPOINTS.map((b) => [b.name, b.tileMin, b.maxW, b.maxH])).toEqual([
    ["phone", 150, 1, 2],
    ["tablet", 170, 2, 2],
    ["desktop", 190, 4, 4],
  ]);
});

it("covers every width exactly once", () => {
  expect(BREAKPOINTS.map((b) => b.minWidth)).toEqual([0, 600, 1025]);
});
