import { it, expect } from "vitest";
import { resolveTile } from "$lib/config/tile-resolve";

it("carries a control's effective metadata into the synthetic bag", () => {
  const control = {
    id: "c",
    feature: "power",
    stateId: "s",
    liveValue: 0,
    writable: false,
    available: true,
    exists: true,
    widget: "value" as const,
    meta: {
      states: { "0": "Frei" },
      role: "value.power",
      unit: "W",
    },
  };
  const res = resolveTile(
    {
      slots: [
        {
          kind: "badge",
          source: { kind: "control", device: "d", control: "c" },
        },
      ],
    } as any,
    "T",
    {
      devices: [{ id: "d", controls: [control] }] as any,
      states: new Map(),
      objects: new Map(),
    },
  );
  expect(res.device.controls[0].meta?.states).toEqual({ "0": "Frei" });
  expect(res.device.controls[0].states).toEqual({ "0": "Frei" });
});
