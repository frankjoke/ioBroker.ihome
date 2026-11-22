import { expect, it } from "vitest";
import { statesForOverride } from "./override-states";
import type { SourceOverride } from "$lib/types/overrides";

const common = {
  type: "multistate",
  states: { "0": "Closed", "1": "Open", "2": "Closing" },
};

function repair(extra: Partial<SourceOverride> = {}): SourceOverride {
  return {
    id: "o",
    stateId: "mqtt.0.door",
    kind: "repair",
    name: "door",
    ...extra,
  } as SourceOverride;
}

it("loads an mstate's labels for a new repair", () => {
  expect(statesForOverride(undefined, common)).toEqual(common.states);
});

it("loads them for an existing repair that stored none", () => {
  expect(statesForOverride(repair(), common)).toEqual(common.states);
});

it("keeps the repair's own labels and ignores derived overrides", () => {
  expect(
    statesForOverride(repair({ states: { "1": "Mine" } }), common),
  ).toEqual({ "1": "Mine" });
  expect(
    statesForOverride(
      { ...repair(), kind: "derived" } as SourceOverride,
      common,
    ),
  ).toBeUndefined();
});
