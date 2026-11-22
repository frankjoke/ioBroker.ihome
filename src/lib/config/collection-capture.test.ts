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
