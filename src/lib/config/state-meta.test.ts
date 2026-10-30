import { it, expect } from "vitest";
import {
  normalizeStates,
  effectiveCommon,
  widgetForMeta,
} from "$lib/config/state-meta";
import type { Control } from "$lib/types/device";

const control = (patch: Partial<Control> = {}): Control =>
  ({ id: "c", feature: "power", writable: true, ...patch }) as Control;

it("normalizes object and array states, rejects junk", () => {
  expect(normalizeStates({ "0": "Standby", "1": "Heizung" })).toEqual({
    "0": "Standby",
    "1": "Heizung",
  });
  expect(normalizeStates(["Standby", "Heizung"])).toEqual({
    "0": "Standby",
    "1": "Heizung",
  });
  expect(normalizeStates(undefined)).toBeUndefined();
  expect(normalizeStates("nope")).toBeUndefined();
});

it("lets the control beat the broker object", () => {
  const object = {
    common: {
      role: "value",
      type: "boolean",
      unit: "W",
      states: { "0": "aus" },
    },
  };
  const meta = effectiveCommon(
    control({ role: "switch", states: { "0": "Standby" } }),
    object,
  );
  expect(meta.role).toBe("switch");
  expect(meta.states).toEqual({ "0": "Standby" });
});

it("keeps the object value when the control says nothing", () => {
  const meta = effectiveCommon(control(), {
    common: { role: "value.power", unit: "W" },
  });
  expect(meta.role).toBe("value.power");
  expect(meta.unit).toBe("W");
});

it("distinguishes hideUnit from an inherited unit", () => {
  const object = { common: { unit: "W" } };
  expect(effectiveCommon(control({ hideUnit: true }), object).unit).toBe("");
  expect(effectiveCommon(control(), object).unit).toBe("W");
});

it("infers a widget from the effective shape, then the fallback", () => {
  expect(widgetForMeta({ states: { "0": "a" } })).toBe("enum");
  expect(widgetForMeta({ role: "level.dimmer", type: "number" })).toBe("level");
  expect(widgetForMeta({ role: "switch", type: "boolean" })).toBe("switch");
  expect(widgetForMeta({ type: "boolean" }, "switch")).toBe("switch");
  expect(widgetForMeta({ type: "boolean", write: true })).toBe("switch");
  expect(widgetForMeta({ type: "boolean" })).toBe("value");
  expect(widgetForMeta({})).toBe("value");
});
