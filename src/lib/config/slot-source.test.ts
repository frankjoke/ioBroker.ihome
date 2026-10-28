import { it, expect } from "vitest";
import {
  resolveSlotSource,
  sourceStateIds,
  type SourceLook,
} from "$lib/config/slot-source";
import type { EnrichedControl, EnrichedDevice } from "$lib/types/device";

const ctl = (
  id: string,
  feature: string,
  stateId: string,
  liveValue: unknown,
  over: Partial<EnrichedControl> = {},
): EnrichedControl => ({
  id,
  feature,
  stateId,
  liveValue,
  writable: true,
  available: true,
  exists: true,
  widget: "level",
  unit: "%",
  ...over,
});

const device = (over: Partial<EnrichedDevice> = {}): EnrichedDevice => ({
  id: "dev",
  name: "Dev",
  type: "Light",
  controls: [],
  ...over,
});

const look = (
  devices: EnrichedDevice[],
  extra: { states?: Map<string, any>; objects?: Map<string, any> } = {},
): SourceLook => ({
  devices,
  states: extra.states ?? new Map(),
  objects: extra.objects ?? new Map(),
});

it("resolves a control reference live, through the device alias", () => {
  const d = device({ controls: [ctl("c1", "brightness", "s1", 42)] });
  expect(
    resolveSlotSource(
      { kind: "control", device: "dev", control: "c1" },
      look([d]),
    ),
  ).toMatchObject({ value: 42, writable: true, available: true });
  // Re-pointing the control's stateId resolves the new state without touching the slot.
  const moved = device({ controls: [ctl("c1", "brightness", "s2", 7)] });
  expect(
    resolveSlotSource(
      { kind: "control", device: "dev", control: "c1" },
      look([moved]),
    )?.value,
  ).toBe(7);
});

it("resolves a raw state and its write flag", () => {
  const objects = new Map([
    ["0_userdata.0.x", { common: { type: "boolean", write: true, name: "X" } }],
  ]);
  const states = new Map([["0_userdata.0.x", { val: true }]]);
  expect(
    resolveSlotSource(
      { kind: "state", stateId: "0_userdata.0.x" },
      look([], { states, objects }),
    ),
  ).toMatchObject({
    value: true,
    writable: true,
    available: true,
    widget: "switch",
    label: "X",
  });
  const readonly = new Map([
    ["0_userdata.0.x", { common: { type: "boolean", write: false } }],
  ]);
  expect(
    resolveSlotSource(
      { kind: "state", stateId: "0_userdata.0.x" },
      look([], { states, objects: readonly }),
    )?.writable,
  ).toBe(false);
});

it("marks a missing control/device unavailable", () => {
  expect(
    resolveSlotSource(
      { kind: "control", device: "gone", control: "c1" },
      look([]),
    ),
  ).toMatchObject({ available: false, writable: false });
  expect(
    resolveSlotSource(
      { kind: "control", device: "dev", control: "gone" },
      look([device()]),
    ),
  ).toMatchObject({ available: false, writable: false });
});

it("a device source is available while one of its controls is", () => {
  const live = device({
    controls: [ctl("c1", "power", "s1", true, { available: false })],
  });
  expect(
    resolveSlotSource({ kind: "device", device: "dev" }, look([live])),
  ).toMatchObject({
    available: false,
  });
  expect(
    resolveSlotSource(
      { kind: "device", device: "dev" },
      look([device({ controls: [ctl("c1", "power", "s1", true)] })]),
    ),
  ).toMatchObject({ available: true, writable: false });
});

it("sourceStateIds names the state behind a control and a raw state", () => {
  const d = device({
    controls: [ctl("c1", "brightness", "0_userdata.0.lamp", 1)],
  });
  expect(
    sourceStateIds({ kind: "control", device: "dev", control: "c1" }, [d]),
  ).toEqual(["0_userdata.0.lamp"]);
  expect(
    sourceStateIds({ kind: "state", stateId: "0_userdata.0.x" }, [d]),
  ).toEqual(["0_userdata.0.x"]);
  expect(sourceStateIds({ kind: "device", device: "dev" }, [d])).toEqual([]);
});
