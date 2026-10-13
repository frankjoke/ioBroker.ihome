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
    kind: undefined,
    virtual: undefined,
    formulaId: undefined,
    history: undefined,
    writable: true,
    label: undefined,
    unit: undefined,
    hidden: undefined,
    transform: undefined,
  });
});

it("keeps formulaId on a projected control", () => {
  const c: any = {
    id: "v",
    feature: "value",
    writable: false,
    formulaId: "t1",
  };
  expect(projectControl(c).formulaId).toBe("t1");
});

it("keeps kind and virtual on a projected virtual control", () => {
  const c: any = {
    id: "v",
    kind: "virtual",
    feature: "value",
    writable: false,
    label: "Dew point",
    virtual: { expr: "temperature - 5", precision: 1 },
    liveValue: 9,
    widget: "value",
  };
  const out = projectControl(c);
  expect(out.kind).toBe("virtual");
  expect(out.virtual).toEqual({ expr: "temperature - 5", precision: 1 });
  expect(out).not.toHaveProperty("liveValue");
});

it("keeps history on a projected control", () => {
  const c: any = {
    id: "h",
    feature: "temperature",
    stateId: "a.0.temp",
    writable: false,
    history: { duration: 24, durationUnit: "hours", count: 200 },
    liveValue: 21,
  };
  const out = projectControl(c);
  expect(out.history).toEqual({ duration: 24, durationUnit: "hours", count: 200 });
  expect(out).not.toHaveProperty("liveValue");
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
