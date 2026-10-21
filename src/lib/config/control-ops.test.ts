import { describe, expect, it } from "vitest";
import { applyPickedState } from "./control-ops";
import type { Control } from "$lib/types/device";

const row = (over: Partial<Control> = {}): Control => ({
  id: "c1",
  feature: "switch",
  stateId: "bambulab.0.0309.ColdBed",
  writable: true,
  label: "Temperature",
  unit: "°C",
  transform: {
    read: { kind: "scale", inMin: 0, inMax: 100, outMin: 0, outMax: 1 },
  },
  history: { duration: 24, durationUnit: "hours", aggregate: "average" },
  ...over,
});

const picked: Control = {
  id: "new",
  feature: "value",
  stateId: "bambulab.0.0309.BedTemp",
  writable: false,
  label: "Temperature",
  unit: "°C",
};

describe("applyPickedState", () => {
  it("takes the state-derived fields from the pick", () => {
    const next = applyPickedState(row(), picked, {
      label: "Temperature",
      unit: "°C",
    });
    expect(next.stateId).toBe("bambulab.0.0309.BedTemp");
    expect(next.feature).toBe("value");
    expect(next.writable).toBe(false);
  });

  it("refreshes a label/unit that still holds the old default", () => {
    const next = applyPickedState(
      row(),
      { ...picked, label: "Farbtemperatur", unit: "K" },
      {
        label: "Temperature",
        unit: "°C",
      },
    );
    expect(next.label).toBe("Farbtemperatur");
    expect(next.unit).toBe("K");
  });

  it("keeps a hand-written label/unit", () => {
    const next = applyPickedState(row({ label: "Bett", unit: "K" }), picked, {
      label: "Temperature",
      unit: "°C",
    });
    expect(next.label).toBe("Bett");
    expect(next.unit).toBe("K");
  });

  it("keeps the row's own settings", () => {
    const next = applyPickedState(row(), picked, {
      label: "Temperature",
      unit: "°C",
    });
    expect(next.id).toBe("c1");
    expect(next.transform).toEqual({
      read: { kind: "scale", inMin: 0, inMax: 100, outMin: 0, outMax: 1 },
    });
    expect(next.history).toEqual({
      duration: 24,
      durationUnit: "hours",
      aggregate: "average",
    });
  });
});
