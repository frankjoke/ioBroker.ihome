import { it, expect } from "vitest";
import { BREAKPOINTS } from "$lib/config/size-ops";
import {
  UI_DEFAULTS,
  effectiveUi,
  scaledTile,
  uiCss,
} from "$lib/config/ui-settings";

it("effectiveUi returns the shipped defaults for an empty document", () => {
  expect(effectiveUi({})).toEqual({
    primary: 0.9,
    secondary: 0.84,
    tileScale: 1,
    reloadMinutes: 0,
  });
  expect(UI_DEFAULTS).toEqual({
    primary: 0.9,
    secondary: 0.84,
    tileScale: 1,
    reloadMinutes: 0,
  });
});

it("effectiveUi accepts only hex colours", () => {
  const ui = effectiveUi({
    "ui.pageBackground": "#abc",
    "ui.sectionBackground": "#aabbcc",
    "ui.tileBackground": "#aabbccdd",
  });
  expect(ui.pageBackground).toBe("#abc");
  expect(ui.sectionBackground).toBe("#aabbcc");
  expect(ui.tileBackground).toBe("#aabbccdd");
  const bad = effectiveUi({
    "ui.pageBackground": "red",
    "ui.sectionBackground": "#12",
    "ui.tileBackground": 42,
  });
  expect(bad.pageBackground).toBeUndefined();
  expect(bad.sectionBackground).toBeUndefined();
  expect(bad.tileBackground).toBeUndefined();
});

it("effectiveUi clamps the numbers and ignores non-numbers", () => {
  expect(effectiveUi({ "ui.primaryText": 0.1 }).primary).toBe(0.7);
  expect(effectiveUi({ "ui.primaryText": 3 }).primary).toBe(1.6);
  expect(effectiveUi({ "ui.secondaryText": 0.1 }).secondary).toBe(0.6);
  expect(effectiveUi({ "ui.secondaryText": 9 }).secondary).toBe(1.4);
  expect(effectiveUi({ "ui.tileScale": 0.5 }).tileScale).toBe(1);
  expect(effectiveUi({ "ui.tileScale": 3 }).tileScale).toBe(2);
  expect(effectiveUi({ "ui.primaryText": "1.2" }).primary).toBe(0.9); // a string is not a number
  expect(effectiveUi({ "ui.primaryText": Number.NaN }).primary).toBe(0.9);
  expect(effectiveUi({ "ui.reloadMinutes": -5 }).reloadMinutes).toBe(0);
  expect(effectiveUi({ "ui.reloadMinutes": 9999 }).reloadMinutes).toBe(1440);
  expect(effectiveUi({ "ui.reloadMinutes": 15.4 }).reloadMinutes).toBe(15);
});

it("uiCss emits colours only when set and always the sizes", () => {
  const plain = uiCss(effectiveUi({}));
  expect(plain).not.toContain("--ui-page-bg");
  expect(plain).not.toContain("--ui-section-bg");
  expect(plain).not.toContain("--ui-tile-bg");
  expect(plain).toContain("--ui-value-size: 0.9rem");
  expect(plain).toContain("--ui-name-size: 0.75rem"); // 0.9 × 12 / 14.4
  expect(plain).toContain("--ui-secondary-size: 0.84rem");

  const custom = uiCss(
    effectiveUi({
      "ui.pageBackground": "#112233",
      "ui.primaryText": 1.2,
      "ui.secondaryText": 1,
    }),
  );
  expect(custom).toContain("--ui-page-bg: #112233");
  expect(custom).toContain("--ui-value-size: 1.2rem");
  expect(custom).toContain("--ui-name-size: 1rem"); // 1.2 × 12 / 14.4
  expect(custom).toContain("--ui-secondary-size: 1rem");
});

it("scaledTile scales the 1×1 module and rounds to 0.1 px", () => {
  const desktop = BREAKPOINTS.find((b) => b.name === "desktop")!;
  expect(scaledTile(desktop, 1)).toEqual({ w: 57, h: 114 });
  expect(scaledTile(desktop, 2)).toEqual({ w: 114, h: 228 });
  expect(scaledTile(desktop, 1.05)).toEqual({ w: 59.9, h: 119.7 });
});
