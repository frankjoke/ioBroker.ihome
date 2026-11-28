import { expect, it } from "vitest";
import { formatDuration, parseDuration } from "./duration";

it("parses the four duration units", () => {
  expect(parseDuration("100ms")).toBe(100);
  expect(parseDuration("250ms")).toBe(250);
  expect(parseDuration("30s")).toBe(30_000);
  expect(parseDuration("2m")).toBe(120_000);
  expect(parseDuration("1h")).toBe(3_600_000);
  expect(parseDuration(" 45s ")).toBe(45_000);
  expect(parseDuration("0ms")).toBe(0);
  expect(parseDuration("0s")).toBe(0);
});

it("rejects anything else", () => {
  for (const bad of ["30", "1d", "-5s", "1.5m", "100 ms", "ms", "", "m"]) {
    expect(parseDuration(bad)).toBeNull();
  }
  expect(parseDuration(30 as never)).toBeNull();
});

it("formats whole units", () => {
  expect(formatDuration(100)).toBe("100ms");
  expect(formatDuration(1_500)).toBe("1500ms");
  expect(formatDuration(30_000)).toBe("30s");
  expect(formatDuration(120_000)).toBe("2m");
  expect(formatDuration(3_600_000)).toBe("1h");
});
