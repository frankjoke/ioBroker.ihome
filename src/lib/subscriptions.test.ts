import { it, expect } from "vitest";
import { subscriptionPlan } from "$lib/subscriptions";

it("subscribes to the used ids plus the adapter's own namespace", () => {
  const plan = subscriptionPlan(
    ["zigbee.0.lamp.state", "ihome.0.config.pageList"],
    "ihome.0",
  );
  expect(plan.states).toEqual([
    "zigbee.0.lamp.state",
    "ihome.0.config.pageList",
    "ihome.0.*",
  ]);
  expect(plan.objects).toEqual(plan.states);
});

it("never repeats an id, whatever order it comes in", () => {
  const plan = subscriptionPlan(
    ["a.0.x", "ihome.0.*", "a.0.x", "b.0.y"],
    "ihome.0",
  );
  expect(plan.states).toEqual(["a.0.x", "b.0.y", "ihome.0.*"]);
});

it("drops junk and trims, and still carries the namespace", () => {
  const plan = subscriptionPlan(
    ["  a.0.x  ", "", "   ", 7 as never],
    "ihome.0",
  );
  expect(plan.states).toEqual(["a.0.x", "ihome.0.*"]);
  expect(subscriptionPlan([], "ihome.0").states).toEqual(["ihome.0.*"]);
});

it("an empty namespace changes nothing (the wildcard is the namespace's)", () => {
  expect(subscriptionPlan(["a.0.x"], "").states).toEqual(["a.0.x"]);
});
