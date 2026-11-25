import { it, expect } from "vitest";
import { csvText } from "$lib/config/history-resample";
import { jsonText, parseHistoryText } from "$lib/config/history-file";

it("round-trips CSV values of every basic type", () => {
  const rows = [
    { ts: 0, val: 1.5 },
    { ts: 60_000, val: true },
    { ts: 120_000, val: 'a,"b"' },
    { ts: 180_000, val: null },
    { ts: 240_000, val: { a: 1 } },
  ];
  expect(parseHistoryText(csvText(rows))).toEqual(rows);
});

it("parses JSON rows and sorts them by time", () => {
  const rows = [
    { ts: 120_000, val: "b" },
    { ts: 0, val: 1 },
  ];
  expect(parseHistoryText(jsonText(rows))).toEqual([
    { ts: 0, val: 1 },
    { ts: 120_000, val: "b" },
  ]);
  expect(
    parseHistoryText(
      JSON.stringify({ rows: [{ ts: "1970-01-01T00:01:00Z", val: 2 }] }),
    ),
  ).toEqual([{ ts: 60_000, val: 2 }]);
});

it("accepts a UTF-8 BOM from a spreadsheet", () => {
  expect(
    parseHistoryText("\uFEFFtimestamp,value\n1970-01-01T00:00:00Z,1\n"),
  ).toEqual([{ ts: 0, val: 1 }]);
});

it("rejects rows without a valid timestamp", () => {
  expect(() => parseHistoryText("timestamp,value\nnot-a-time,1\n")).toThrow(
    "Line 2",
  );
  expect(() => parseHistoryText('[{"val":1}]')).toThrow("Row 1");
});

it("rejects text that is neither CSV nor JSON rows", () => {
  expect(() => parseHistoryText("hello")).toThrow("timestamp,value");
  expect(() => parseHistoryText("[]")).toThrow("no rows");
});
