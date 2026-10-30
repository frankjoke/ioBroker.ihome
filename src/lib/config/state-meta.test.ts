import { it, expect } from "vitest";
import {
  normalizeStates,
  effectiveCommon,
  widgetForMeta,
  effectiveRoom,
  effectiveFunctions,
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

const enums = {
  getList: (type: string) =>
    type === "functions" ? [{ _id: "enum.functions.Licht" }] : [],
  get: (id: string) =>
    id === "alias.0.Kanal"
      ? { functions: [{ _id: "enum.functions.Licht" }] }
      : id === "alias.0.Raum"
        ? { rooms: [{ _id: "enum.rooms.Bad" }] }
        : undefined,
};

it("resolves room and functions control -> enum (parent walk) -> device", () => {
  expect(
    effectiveRoom(
      control({ room: "enum.rooms.Kueche" }),
      { _id: "alias.0.Kanal.SET" },
      "enum.rooms.Bad",
      enums,
    ),
  ).toBe("enum.rooms.Kueche");
  expect(
    effectiveRoom(control(), { _id: "alias.0.Raum.SET" }, undefined, enums),
  ).toBe("enum.rooms.Bad");
  expect(effectiveRoom(control(), undefined, "enum.rooms.EG", enums)).toBe(
    "enum.rooms.EG",
  );
  expect(
    effectiveFunctions(
      control({ functions: ["enum.functions.Heizung"] }),
      undefined,
      undefined,
      enums,
    ),
  ).toEqual(["enum.functions.Heizung"]);
  expect(
    effectiveFunctions(control(), { _id: "alias.0.Kanal.SET" }, [], enums),
  ).toEqual(["enum.functions.Licht"]);
  expect(
    effectiveFunctions(control(), undefined, ["enum.functions.Wetter"], enums),
  ).toEqual(["enum.functions.Wetter"]);
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
