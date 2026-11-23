import { describe, expect, it } from "vitest";
import {
  OVERRIDE_CUSTOM_KEY,
  customOverridesOf,
  parseOverrideList,
  withCustomOverrides,
} from "./override-common";

const repair = {
  id: "a",
  stateId: "0_userdata.0.x",
  kind: "repair" as const,
  name: "level",
};

const derived = {
  id: "b",
  stateId: "0_userdata.0.x",
  kind: "derived" as const,
  name: "sum",
  expr: "$.a",
};

describe("parseOverrideList", () => {
  it("parses a JSON list and filters incomplete entries", () => {
    expect(
      parseOverrideList(
        JSON.stringify({
          version: 1,
          overrides: [repair, derived, { id: "x" }],
        }),
      ),
    ).toEqual([repair, derived]);
  });

  it("accepts a document object and a state envelope", () => {
    expect(parseOverrideList({ overrides: [repair] })).toEqual([repair]);
    expect(
      parseOverrideList({ val: JSON.stringify({ overrides: [repair] }) }),
    ).toEqual([repair]);
  });

  it("rejects unusable data", () => {
    expect(parseOverrideList("not json")).toBeNull();
    expect(parseOverrideList(undefined)).toBeNull();
    expect(parseOverrideList({ overrides: "nope" })).toBeNull();
  });
});

describe("customOverridesOf", () => {
  it("reads the versioned per-state array", () => {
    const object = {
      common: {
        custom: {
          [OVERRIDE_CUSTOM_KEY]: { version: 1, overrides: [repair, derived] },
        },
      },
    };
    expect(customOverridesOf(object)).toEqual([repair, derived]);
  });

  it("ignores other versions, other keys and junk", () => {
    expect(
      customOverridesOf({
        common: { custom: { ihome: { version: 2, overrides: [repair] } } },
      }),
    ).toEqual([]);
    expect(
      customOverridesOf({
        common: { custom: { "history.0": { enabled: true } } },
      }),
    ).toEqual([]);
    expect(customOverridesOf(null)).toEqual([]);
  });
});

describe("withCustomOverrides", () => {
  it("preserves other custom keys and writes the versioned array", () => {
    expect(
      withCustomOverrides({ "history.0": { enabled: true } }, [repair]),
    ).toEqual({
      "history.0": { enabled: true },
      ihome: { version: 1, overrides: [repair] },
    });
  });

  it("removes only the ihome key when the last override goes", () => {
    expect(
      withCustomOverrides(
        {
          "history.0": { enabled: true },
          ihome: { version: 1, overrides: [repair] },
        },
        [],
      ),
    ).toEqual({ "history.0": { enabled: true } });
  });
});
