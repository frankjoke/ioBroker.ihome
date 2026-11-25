import { it, expect } from "vitest";
import { resamplePoints, csvText } from "$lib/config/history-resample";

const rows = [
  { ts: 0, val: 10 },
  { ts: 5 * 60_000, val: 20 },
  { ts: 10 * 60_000, val: 30 },
  { ts: 15 * 60_000, val: "not a number" },
  { ts: 20 * 60_000, val: 40 },
];

it("averages raw points into buckets at the bucket start", () => {
  expect(resamplePoints(rows, 15 * 60_000, "average")).toEqual([
    { ts: 0, val: 20 },
    { ts: 15 * 60_000, val: 40 },
  ]);
});

it("supports min, max and last", () => {
  expect(resamplePoints(rows, 15 * 60_000, "min")).toEqual([
    { ts: 0, val: 10 },
    { ts: 15 * 60_000, val: 40 },
  ]);
  expect(resamplePoints(rows, 15 * 60_000, "max")).toEqual([
    { ts: 0, val: 30 },
    { ts: 15 * 60_000, val: 40 },
  ]);
  expect(resamplePoints(rows, 15 * 60_000, "last")).toEqual([
    { ts: 0, val: 30 },
    { ts: 15 * 60_000, val: 40 },
  ]);
});

it("skips non-numeric values and empty buckets", () => {
  const onlyText = [
    { ts: 0, val: "a" },
    { ts: 5 * 60_000, val: null },
  ];
  expect(resamplePoints(onlyText, 15 * 60_000)).toEqual([]);
});

it("sorts by timestamp before choosing the last value", () => {
  const unsorted = [
    { ts: 20 * 60_000, val: 40 },
    { ts: 5 * 60_000, val: 20 },
    { ts: 0, val: 10 },
    { ts: 10 * 60_000, val: 30 },
  ];
  expect(resamplePoints(unsorted, 15 * 60_000, "last")).toEqual([
    { ts: 0, val: 30 },
    { ts: 15 * 60_000, val: 40 },
  ]);
});

it("returns no points for an invalid step", () => {
  expect(resamplePoints(rows, 0)).toEqual([]);
  expect(resamplePoints(rows, -1)).toEqual([]);
});

it("writes CSV with ISO timestamps and escaped values", () => {
  expect(
    csvText([
      { ts: 0, val: 1 },
      { ts: 60_000, val: 'a,"b"' },
      { ts: 120_000, val: null },
    ]),
  ).toBe(
    'timestamp,value\n1970-01-01T00:00:00.000Z,1\n1970-01-01T00:01:00.000Z,"a,""b"""\n1970-01-01T00:02:00.000Z,\n',
  );
});
