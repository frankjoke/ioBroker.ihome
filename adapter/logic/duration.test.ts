import { expect, it } from "vitest";
import { formatDuration, parseDuration } from "./duration";

it("parses the three duration units", () => {
  expect(parseDuration("30s")).toBe(30_000);
  expect(parseDuration("2m")).toBe(120_000);
  expect(parseDuration("1h")).toBe(3_600_000);
  expect(parseDuration(" 45s ")).toBe(45_000);
  expect(parseDuration("0s")).toBe(0);
});

it("rejects anything else", () => {
  for (const bad of ["30", "1d", "-5s", "1.5m", "", "m"]) {
    expect(parseDuration(bad)).toBeNull();
  }
  expect(parseDuration(30 as never)).toBeNull();
});

it("formats whole units", () => {
  expect(formatDuration(30_000)).toBe("30s");
  expect(formatDuration(120_000)).toBe("2m");
  expect(formatDuration(3_600_000)).toBe("1h");
});
