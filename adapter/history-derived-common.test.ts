import { expect, it } from "vitest";
import {
  derivedEntryProblemForObject,
  parseDerivedDocument,
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
  expect(
    parseDerivedDocument('{"version":1,"entries":[{"id":"x"}]}'),
  ).toBeNull();
  expect(
    parseDerivedDocument({
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
    }),
  ).toBeNull();
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

it("selects only a number state with raw off and no alias", () => {
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
      { common: { type: "string", custom: { "history.0": config } } },
      "history.0",
    ),
  ).toContain("number");
  expect(
    derivedEntryProblemForObject(
      { common: { type: "number", custom: { "history.0": { enabled: true } } } },
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
