import { expect, it } from "vitest";
import type { LogicDef } from "$logic/types";
import type { Template } from "$lib/types/display";
import {
  collectionTileDefinition,
  suggestCollectionStates,
} from "./collection-capture";

const logic: LogicDef = {
  id: "calc",
  name: "Calc",
  kind: "function",
  inputs: {
    sensor: {
      from: { type: "state", ref: "0_userdata.0.sensor" },
      kind: "event",
    },
  },
  output: { scope: "state", ref: "0_userdata.0.total", type: "number" },
  mode: "statements",
  expr: { code: 'get("0_userdata.0.helper")' },
};

it("suggests refs and code calls, with the output owned", () => {
  const rows = suggestCollectionStates([logic], () => undefined);
  expect(rows.map((row) => row.id)).toEqual([
    "0_userdata.0.helper",
    "0_userdata.0.sensor",
    "0_userdata.0.total",
  ]);
  expect(
    rows.find((row) => row.id === "0_userdata.0.total")?.ownedByDefault,
  ).toBe(true);
  expect(
    rows.find((row) => row.id === "0_userdata.0.sensor")?.ownedByDefault,
  ).toBe(false);
});

it("ignores pseudo refs such as $logic sources", () => {
  const dependency: LogicDef = {
    ...logic,
    inputs: {
      follow: {
        from: { type: "state", ref: "$logic.TestAction" },
        kind: "event",
      },
    },
  };
  expect(
    suggestCollectionStates([dependency], () => undefined).map((row) => row.id),
  ).not.toContain("$logic.TestAction");
});

it("finds state refs inside machine exit code", () => {
  const machine = {
    id: "m",
    name: "Machine",
    kind: "machine" as const,
    states: {
      Idle: {
        exit: { code: 'set("0_userdata.0.machineExit", 1)' },
      },
    },
  } as unknown as LogicDef;
  expect(
    suggestCollectionStates([machine], () => undefined).map((row) => row.id),
  ).toEqual(["0_userdata.0.machineExit"]);
});

it("resolves variables and strips tile provenance", () => {
  const varLogic: LogicDef = {
    ...logic,
    inputs: {
      sensor: {
        from: { type: "state", ref: "sensorVar" },
        kind: "event",
      },
    },
  };
  const rows = suggestCollectionStates([varLogic], (name) =>
    name === "sensorVar" ? "0_userdata.0.sensor" : undefined,
  );
  expect(rows.some((row) => row.id === "0_userdata.0.sensor")).toBe(true);
  const tile = {
    id: "t",
    name: "T",
    type: "Custom",
    builtin: true,
    basedOn: "x",
    features: [],
    slots: [],
  } as unknown as Template;
  expect(collectionTileDefinition(tile)).not.toHaveProperty("builtin");
  expect(collectionTileDefinition(tile)).not.toHaveProperty("basedOn");
});

it("pre-binds a contributed tile's slots to owned states by name", () => {
  const tile = {
    id: "t2",
    name: "T",
    type: "Custom",
    features: [],
    slots: [
      { kind: "level", source: "level", label: "TestVariable" },
      { kind: "enum", source: "level_state2", label: "TestLogic" },
      { kind: "value", source: "value", label: "Unknown" },
    ],
  } as unknown as Template;
  const defined = collectionTileDefinition(
    tile,
    new Map([
      ["testvariable", "ihome.0.Variables.TestState"],
      ["testlogic", "ihome.0.Logic.TestLogic"],
    ]),
  );
  expect(defined.slots.map((slot) => slot.origin)).toEqual([
    "ihome.0.Variables.TestState",
    "ihome.0.Logic.TestLogic",
    undefined,
  ]);
});
