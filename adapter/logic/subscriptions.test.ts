import { expect, it } from "vitest";
import { subscriptionDiff } from "./subscriptions";
import { createEngine } from "./engine";
import { createHarness } from "./testing";
import type { LogicDocument } from "./types";

const logicDoc = (ref: string): LogicDocument => ({
  version: 1,
  logics: [
    {
      id: "watch",
      name: "Watch",
      kind: "function",
      inputs: { v: { from: { type: "state", ref }, kind: "event" } },
      output: { scope: "memory" },
      expr: { ref: "v" },
    },
  ],
});

it("splits additions and removals into the adapter's two calls", () => {
  expect(
    subscriptionDiff(
      ["ihome.0.Logic.a", "0_userdata.0.X", "hue.0.Y"],
      ["ihome.0.Logic.b", "0_userdata.0.X", "zigbee.0.Z"],
      "ihome.0",
    ),
  ).toEqual({
    own: { add: ["ihome.0.Logic.b"], remove: ["ihome.0.Logic.a"] },
    foreign: { add: ["zigbee.0.Z"], remove: ["hue.0.Y"] },
  });
});

it("drops a deleted logic's states from the subscription set", () => {
  const h = createHarness({ "0_userdata.0.X": 1 });
  const engine = createEngine(logicDoc("0_userdata.0.X"), h.deps);
  const before = engine.subscriptions();
  expect(before).toEqual(["0_userdata.0.X"]);

  const empty = createEngine({ version: 1, logics: [] }, h.deps);
  expect(empty.subscriptions()).toEqual([]);
  expect(subscriptionDiff(before, empty.subscriptions(), "ihome.0")).toEqual({
    own: { add: [], remove: [] },
    foreign: { add: [], remove: ["0_userdata.0.X"] },
  });
});

it("drops a variable's state when the variable is gone", () => {
  const h = createHarness({ "0_userdata.0.T": 3 });
  const resolveVariable = (name: string) =>
    name === "Temp"
      ? { kind: "state" as const, stateId: "0_userdata.0.T" }
      : undefined;
  const engine = createEngine(logicDoc("Temp"), { ...h.deps, resolveVariable });
  expect(engine.subscriptions()).toEqual(["0_userdata.0.T"]);

  const gone = createEngine(logicDoc("Temp"), {
    ...h.deps,
    resolveVariable: () => undefined,
  });
  expect(gone.subscriptions()).toEqual([]);
});

it("a disabled logic subscribes to nothing", () => {
  const doc = logicDoc("0_userdata.0.X");
  doc.logics[0].enabled = false;
  const h = createHarness({});
  expect(createEngine(doc, h.deps).subscriptions()).toEqual([]);
});
