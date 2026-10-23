import { it, expect } from "vitest";
import {
  DEVICE_LIST_ID,
  getUsedStateIds,
  setCanonicalRegistry,
  setObjectSource,
} from "$lib/stores/devices.svelte";

/**
 * Every id the *logic* reads has to be in the used set: the subscription and
 * the stateChange filter both come from it. A virtual control's expression is
 * the easy one to forget — it is not a control `stateId` and not a rule.
 */
it("the used set covers a virtual control's expression and the rules", () => {
  setCanonicalRegistry({
    version: 1,
    updatedAt: 0,
    devices: [
      {
        id: "dev-1",
        name: "Virtual",
        type: "Custom",
        icon: "",
        rooms: [],
        functions: [],
        favorites: [],
        watch: ["watch.0.one"],
        controls: [
          {
            id: "c-1",
            feature: "value",
            widget: "value",
            stateId: "state.0.read",
            virtual: {
              expr: 'get("alias.0.X.SET") * 2 > get("0_userdata.0.y")',
            },
            readable: true,
          },
          {
            id: "c-2",
            feature: "value",
            widget: "value",
            stateId: "",
            rules: [{ when: 'get("rule.0.input") == 1', style: {} }],
            readable: true,
          },
        ],
        rules: [],
        slots: [],
      },
    ],
  } as never);

  const used = [...getUsedStateIds()];
  expect(used).toContain(DEVICE_LIST_ID);
  expect(used).toContain("state.0.read");
  expect(used).toContain("watch.0.one");
  expect(used).toContain("rule.0.input");
  expect(used).toContain("alias.0.X.SET");
  expect(used).toContain("0_userdata.0.y");
});

it("the used set covers a device slot's raw source and its rules", () => {
  setObjectSource(new Map([["slot.0.raw", {}]]));
  setCanonicalRegistry({
    version: 1,
    updatedAt: 0,
    devices: [
      {
        id: "dev-2",
        name: "Slotted",
        type: "Custom",
        icon: "",
        rooms: [],
        functions: [],
        favorites: [],
        slots: [
          {
            kind: "value",
            source: "slot.0.raw",
            rules: [{ when: 'get("slot.0.rule") > 1' }],
          },
          { kind: "value", source: "power" }, // a feature name is not a state id
        ],
        controls: [],
      },
    ],
  } as never);

  const used = [...getUsedStateIds()];
  expect(used).toContain("slot.0.raw");
  expect(used).toContain("slot.0.rule");
  expect(used).not.toContain("power");
});
