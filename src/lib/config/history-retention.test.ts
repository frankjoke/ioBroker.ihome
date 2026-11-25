import { it, expect } from "vitest";
import {
  retentionDays,
  retentionLabel,
  retentionValues,
  supportsStateRetention,
} from "$lib/config/history-retention";

it("reads seconds and custom days from a history config", () => {
  expect(retentionDays(undefined)).toBeUndefined();
  expect(retentionDays({})).toBeUndefined();
  expect(retentionDays({ retention: 0 })).toBe(0);
  expect(retentionDays({ retention: 30 * 86_400 })).toBe(30);
  expect(retentionDays({ retention: 365 * 86_400 })).toBe(365);
  expect(retentionDays({ retention: -1, customRetentionDuration: 45 })).toBe(
    45,
  );
  expect(retentionDays({ retention: -1 })).toBeUndefined();
  expect(retentionDays({ retention: "2592000" })).toBe(30);
  expect(
    retentionDays({ retention: "-1", customRetentionDuration: "45" }),
  ).toBe(45);
});

it("writes both fields the history/sql adapters understand", () => {
  expect(retentionValues(30)).toEqual({
    retention: 30 * 86_400,
    customRetentionDuration: 30,
  });
  expect(retentionValues(0)).toEqual({
    retention: 0,
    customRetentionDuration: 0,
  });
});

it("labels the common retention windows compactly", () => {
  expect(retentionLabel(undefined)).toBe("");
  expect(retentionLabel(0)).toBe("forever");
  expect(retentionLabel(30)).toBe("30d");
  expect(retentionLabel(90)).toBe("90d");
  expect(retentionLabel(365)).toBe("1y");
  expect(retentionLabel(730)).toBe("2y");
  expect(retentionLabel(45)).toBe("45d");
});

it("knows which adapters enforce per-state retention", () => {
  expect(supportsStateRetention("history.0")).toBe(true);
  expect(supportsStateRetention("sql.0")).toBe(true);
  expect(supportsStateRetention("influxdb.0")).toBe(false);
  expect(supportsStateRetention("timescaledb.0")).toBe(false);
  expect(supportsStateRetention("history")).toBe(false);
});
