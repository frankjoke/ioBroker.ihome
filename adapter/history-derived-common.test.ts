import { expect, it } from "vitest";
import {
  derivedEntryProblemForObject,
  derivedNumber,
  parseDerivedDocument,
  parseDerivedDocumentResult,
  shouldWrite,
} from "./history-derived-common";

it("parses one valid entry and rejects malformed documents", () => {
  const doc = JSON.stringify({
    version: 1,
    entries: [
      {
        id: "0_userdata.0.T",
        adapter: "history.0",
        interval: "15m",
        startDelay: "10s",
        changesOnly: true,
        relogInterval: "1h",
        function: { code: "return 1;" },
      },
    ],
  });
  expect(parseDerivedDocument(doc)?.entries).toHaveLength(1);
  expect(parseDerivedDocument("{nope")).toBeNull();
  const brokenEntry = parseDerivedDocumentResult(
    '{"version":1,"entries":[{"id":"x"}]}',
  );
  expect(brokenEntry?.document.entries).toHaveLength(0);
  expect(brokenEntry?.problems).toHaveLength(1);
  const badInterval = parseDerivedDocumentResult({
    version: 1,
    entries: [
      {
        id: "0_userdata.0.T",
        adapter: "history.0",
        interval: "0s",
        startDelay: "0s",
        changesOnly: true,
        relogInterval: "0s",
        function: { code: "return 1;" },
      },
    ],
  });
  expect(badInterval?.document.entries).toHaveLength(0);
  expect(badInterval?.problems).toHaveLength(1);
});

it("keeps valid entries and drops duplicate or broken ones", () => {
  const valid = {
    id: "0_userdata.0.T",
    adapter: "history.0",
    interval: "15m",
    startDelay: "0s",
    changesOnly: true,
    relogInterval: "1h",
    function: { code: "return 1;" },
  };
  const parsed = parseDerivedDocumentResult({
    version: 1,
    entries: [
      valid,
      { ...valid },
      { ...valid, id: "0_userdata.0.U", function: { code: "" } },
    ],
  });
  expect(parsed?.document.entries.map((entry) => entry.id)).toEqual([
    "0_userdata.0.T",
  ]);
  expect(parsed?.problems).toHaveLength(2);
  expect(parsed?.problems[0]).toContain("duplicate");
  expect(parsed?.problems[1]).toContain("function");
});

it("skips equal values until the relog boundary", () => {
  const base = {
    value: 2,
    lastWritten: 2,
    lastWrittenTs: 0,
    changesOnly: true,
    relogMs: 3_600_000,
  };
  expect(shouldWrite({ ...base, to: 900_000 })).toBe(false);
  expect(shouldWrite({ ...base, to: 3_600_000 })).toBe(true);
  expect(shouldWrite({ ...base, value: 3, to: 900_000 })).toBe(true);
  expect(shouldWrite({ ...base, lastWritten: undefined, to: 900_000 })).toBe(
    true,
  );
  expect(shouldWrite({ ...base, changesOnly: false, to: 900_000 })).toBe(true);
});

it("selects a number or mixed state with raw off and no alias", () => {
  const config = { enabled: false, aliasId: "" };
  const object = {
    common: {
      type: "number",
      custom: { "history.0": config },
    },
  };
  expect(derivedEntryProblemForObject(object, "history.0")).toBeNull();
  expect(
    derivedEntryProblemForObject(
      { common: { type: "mixed", custom: { "history.0": config } } },
      "history.0",
    ),
  ).toBeNull();
  expect(
    derivedEntryProblemForObject(
      { common: { type: "string", custom: { "history.0": config } } },
      "history.0",
    ),
  ).toContain("mixed");
  expect(
    derivedEntryProblemForObject(
      {
        common: { type: "number", custom: { "history.0": { enabled: true } } },
      },
      "history.0",
    ),
  ).toContain("enabled");
  expect(
    derivedEntryProblemForObject(
      {
        common: {
          type: "number",
          custom: { "history.0": { enabled: false, aliasId: "x" } },
        },
      },
      "history.0",
    ),
  ).toContain("alias");
});

it("coerces sample values to finite numbers", () => {
  expect(derivedNumber(12.5)).toBe(12.5);
  expect(derivedNumber("12.5")).toBe(12.5);
  expect(derivedNumber(true)).toBe(1);
  expect(derivedNumber(false)).toBe(0);
  expect(derivedNumber("nope")).toBeNull();
  expect(derivedNumber({ value: 1 })).toBeNull();
  expect(derivedNumber(Number.NaN)).toBeNull();
  expect(derivedNumber(Number.POSITIVE_INFINITY)).toBeNull();
});
