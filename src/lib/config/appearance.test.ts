import { it, expect } from "vitest";
import { backgroundCss } from "$lib/config/appearance";

it("maps each background kind to the CSS a section or page needs", () => {
  expect(backgroundCss({ kind: "solid", value: "#101418" })).toBe(
    "background-color: #101418;",
  );
  expect(backgroundCss({ kind: "image", value: "bg.png" })).toBe(
    'background-image: url("bg.png"); background-size: cover; background-attachment: fixed;',
  );
  expect(
    backgroundCss({ kind: "gradient", value: "linear-gradient(#000, #fff)" }),
  ).toBe(
    "background-image: linear-gradient(#000, #fff); background-attachment: fixed;",
  );
});

it("says nothing for an unset or empty background", () => {
  expect(backgroundCss(undefined)).toBe("");
  expect(backgroundCss({ kind: "solid", value: "" })).toBe("");
});
