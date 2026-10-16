import { it, expect } from "vitest";
import {
  contrastColor,
  formatAge,
  formatNumber,
  formatSlotText,
  formatValue,
  splitValueUnit,
} from "$lib/config/format";

it("returns dark text for light colors", () => {
  expect(contrastColor("#ffcc00")).toBe("#1a1a1a");
});
it("returns light text for dark colors", () => {
  expect(contrastColor("#003366")).toBe("#ffffff");
});
it("expands 3-digit hex", () => {
  expect(contrastColor("#fff")).toBe("#1a1a1a");
});
it("falls back for a non-hex color", () => {
  expect(contrastColor("rebeccapurple")).toBe("#1a1a1a");
});

const now = 1_000_000_000_000;
it("formats 'now' under 4s", () =>
  expect(formatAge(now - 1000, now)).toBe("now"));
it("formats seconds", () => expect(formatAge(now - 5000, now)).toBe("5s"));
it("formats minutes", () =>
  expect(formatAge(now - 3 * 60_000, now)).toBe("3m"));
it("formats hours", () =>
  expect(formatAge(now - 2 * 3_600_000, now)).toBe("2h"));
it("formats days", () =>
  expect(formatAge(now - 2 * 86_400_000, now)).toBe("2d"));
it("returns empty for a missing timestamp", () =>
  expect(formatAge(0, now)).toBe(""));
it("formats a value with a unit", () =>
  expect(formatValue(23.5, "°C")).toBe("23.5 °C"));
it("formats booleans", () => expect(formatValue(true)).toBe("true"));
it("formats booleans from an OFF/ON unit pair", () => {
  expect(formatValue(false, "OFF/ON")).toBe("OFF");
  expect(formatValue(true, "OFF/ON")).toBe("ON");
});
it("formats booleans from an arbitrary false/true pair", () => {
  expect(formatValue(false, "CLOSED/OPEN")).toBe("CLOSED");
  expect(formatValue(true, "CLOSED/OPEN")).toBe("OPEN");
});
it("ignores a unit without a pair for booleans", () =>
  expect(formatValue(true, "°C")).toBe("true"));
it("formats objects as JSON", () =>
  expect(formatValue({ a: 1 })).toBe('{"a":1}'));

it("renders a bare boolean as On/Off for a slot", () => {
  expect(formatSlotText(true, undefined)).toBe("On");
  expect(formatSlotText(false, "")).toBe("Off");
  // A configured pair wins, so German installs keep "Ein"/"Aus".
  expect(formatSlotText(true, "Aus/Ein")).toBe("Ein");
  expect(formatSlotText(false, "Aus/Ein")).toBe("Aus");
  // Numbers keep their unit.
  expect(formatSlotText(21.5, "°C")).toBe("21.5 °C");
  expect(formatSlotText(null, "°C")).toBe("—");
});

it("splits a slot's value from its unit so the unit can be styled apart", () => {
  expect(splitValueUnit(11.3, "°C")).toEqual({ value: "11.3", unit: "°C" });
  expect(splitValueUnit(42, "%")).toEqual({ value: "42", unit: "%" });
  expect(splitValueUnit(21.5, undefined)).toEqual({ value: "21.5", unit: "" });
  // a boolean's unit is its false/true pair, so it is consumed as the label
  expect(splitValueUnit(false, "OFF/ON")).toEqual({ value: "OFF", unit: "" });
  expect(splitValueUnit(true, "OFF/ON")).toEqual({ value: "ON", unit: "" });
  expect(splitValueUnit(true, undefined)).toEqual({ value: "On", unit: "" });
  // nothing to show: the unit would be noise
  expect(splitValueUnit(null, "°C")).toEqual({ value: "—", unit: "" });
  expect(splitValueUnit(undefined, "°C")).toEqual({ value: "—", unit: "" });
  expect(splitValueUnit("abc", "x")).toEqual({ value: "abc", unit: "x" });
});

it("rounds a reading to its slot's precision, trailing zeros dropped", () => {
  expect(formatNumber(54.32, 1)).toBe("54.3");
  expect(formatNumber(54.36, 1)).toBe("54.4");
  expect(formatNumber(54.32, 0)).toBe("54");
  expect(formatNumber(54, 1)).toBe("54");
  expect(formatNumber(0.30000000000000004, 2)).toBe("0.3");
  // adapters that store readings as strings round too
  expect(formatNumber("54.32", 1)).toBe("54.3");
  // no precision (or junk) leaves the value alone
  expect(formatNumber(54.32)).toBe("54.32");
  expect(formatNumber(54.32, -1)).toBe("54.32");
  expect(formatNumber("abc", 1)).toBe("abc");
  // the parse is strict — the whole string must be numeric, so a German comma
  // and a baked-in unit stay untouched (parseFloat would read 54 / 54.32 and
  // mangle them)
  expect(formatNumber("54,32", 1)).toBe("54,32");
  expect(formatNumber("54.32 %", 1)).toBe("54.32 %");
  expect(splitValueUnit(54.32, "%", 1)).toEqual({ value: "54.3", unit: "%" });
});
