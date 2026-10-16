import { it, expect } from "vitest";
import { gradientValue, inspectGradient, isHexColor } from "./appearance";

it("writes and reads back the builder's gradient", () => {
  expect(gradientValue(180, "#101418", "#2a3550")).toBe(
    "linear-gradient(180deg, #101418, #2a3550)",
  );
  expect(inspectGradient(gradientValue(45, "#000", "#fff"))).toEqual({
    angle: 45,
    from: "#000",
    to: "#fff",
  });
});

it("refuses what it cannot represent", () => {
  expect(inspectGradient(undefined)).toBeNull();
  expect(inspectGradient("#101418")).toBeNull();
  expect(inspectGradient("url(some.png)")).toBeNull();
  expect(isHexColor("#101418")).toBe(true);
  expect(isHexColor("#abc")).toBe(true);
  expect(isHexColor("#abcdefff")).toBe(true);
  expect(isHexColor("red")).toBe(false);
  expect(isHexColor("#12")).toBe(false);
});
