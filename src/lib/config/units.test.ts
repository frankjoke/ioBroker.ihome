import { it, expect } from "vitest";
import { defaultUnit } from "$lib/config/units";

it("uses the state's own unit when present", () => {
  expect(defaultUnit({ common: { unit: "°C" } })).toBe("°C");
});
it("lists an object states map with values", () => {
  expect(defaultUnit({ common: { states: { 0: "Off", 1: "On" } } })).toBe(
    "(0: Off, 1: On)",
  );
});
it("lists an array states list with indices", () => {
  expect(defaultUnit({ common: { states: ["Off", "On"] } })).toBe(
    "(0: Off, 1: On)",
  );
});
it("uses OFF/ON for boolean states", () => {
  expect(defaultUnit({ common: { type: "boolean" } })).toBe("OFF/ON");
});
it("uses Number (min-max) for numeric ranges", () => {
  expect(defaultUnit({ common: { type: "number", min: 0, max: 100 } })).toBe(
    "Number (0-100)",
  );
});
it("returns empty when nothing applies", () => {
  expect(defaultUnit({ common: { type: "string" } })).toBe("");
});
