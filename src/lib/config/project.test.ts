import { it, expect } from "vitest";
import { projectControl, projectDevice } from "$lib/config/project";

it("strips non-model fields from a control", () => {
  const c: any = {
    id: "c",
    feature: "power",
    stateId: "a.0.b",
    writable: true,
    readable: true,
    object: { _id: "a.0.b" },
    liveValue: 1,
    widget: "switch",
    exists: true,
    available: true,
    displayRoom: "x",
  };
  const out = projectControl(c);
  expect(out).toEqual({
    id: "c",
    feature: "power",
    stateId: "a.0.b",
    writable: true,
    label: undefined,
    unit: undefined,
    hidden: undefined,
    transform: undefined,
  });
});

it("projects a device and its controls", () => {
  const d: any = {
    id: "d",
    name: "D",
    type: "Switch",
    controls: [
      {
        id: "c",
        feature: "power",
        stateId: "a.0.b",
        writable: true,
        readable: true,
        widget: "switch",
      },
    ],
  };
  const out = projectDevice(d);
  expect(out.name).toBe("D");
  expect(out.controls[0]).not.toHaveProperty("widget");
});
