import { it, expect } from "vitest";
import {
  resolveSlotSource,
  sourceStateIds,
  type SourceLook,
} from "$lib/config/slot-source";
import type { EnrichedControl, EnrichedDevice } from "$lib/types/device";
import type { SourceOverride } from "$lib/types/overrides";

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

/** One state (default `s`) with an object and live value, plus what the
 *  override layer reads. */
const stateLook = (
  opts: {
    id?: string;
    object?: any;
    value?: unknown;
    overrides?: SourceOverride[];
    derived?: SourceLook["derived"];
  } = {},
): SourceLook => {
  const id = opts.id ?? "s";
  return {
    devices: [],
    states: new Map([[id, { val: opts.value }]]),
    objects: opts.object ? new Map([[id, opts.object]]) : new Map(),
    overrides: opts.overrides,
    derived: opts.derived,
  };
};

const repair = (over: Partial<SourceOverride> = {}): SourceOverride => ({
  id: "o",
  stateId: "s",
  kind: "repair",
  name: "power",
  ...over,
});

it("resolves a state source that names a variable to its real state", () => {
  const variables = [
    {
      name: "LampVar",
      kind: "state",
      stateId: "0_userdata.0.lamp",
      type: "boolean",
      role: "switch",
    },
  ] as SourceLook["variables"];
  const l = look([], {
    states: new Map([["0_userdata.0.lamp", { val: true }]]),
    objects: new Map([
      [
        "0_userdata.0.lamp",
        { common: { write: true, type: "boolean", role: "switch" } },
      ],
    ]),
  });
  l.variables = variables;
  expect(
    resolveSlotSource({ kind: "state", stateId: "LampVar" }, l),
  ).toMatchObject({
    value: true,
    writable: true,
    available: true,
    stateId: "0_userdata.0.lamp",
    widget: "switch",
  });
  expect(
    sourceStateIds({ kind: "state", stateId: "LampVar" }, [], variables),
  ).toEqual(["0_userdata.0.lamp"]);
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

it("a control source carries its corrected meta, not the object", () => {
  const control = {
    id: "c",
    feature: "power",
    stateId: "a.0.x",
    liveValue: 1,
    writable: true,
    available: true,
    meta: {
      role: "switch",
      unit: "",
      states: { "0": "Aus", "1": "Ein" },
    },
    widget: "switch",
  } as any;
  const res = resolveSlotSource(
    { kind: "control", device: "d", control: "c" },
    {
      devices: [{ id: "d", controls: [control] }] as any,
      states: new Map(),
      objects: new Map(),
    },
  );
  expect(res).toMatchObject({
    role: "switch",
    unit: "",
    states: { "0": "Aus", "1": "Ein" },
  });
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

it("a repair override wins over the object", () => {
  const source = resolveSlotSource(
    { kind: "state", stateId: "mqtt.0.x", override: "o" },
    stateLook({
      id: "mqtt.0.x",
      value: "12",
      object: { common: { name: "raw", type: "string", unit: "" } },
      overrides: [
        repair({
          stateId: "mqtt.0.x",
          unit: "A",
          type: "number",
          min: 6,
          max: 16,
        }),
      ],
    }),
  );
  expect(source).toMatchObject({
    unit: "A",
    type: "number",
    meta: { min: 6, max: 16 },
    value: 12,
  });
});

it("a repair reads through its transform and write flag", () => {
  const source = resolveSlotSource(
    { kind: "state", stateId: "s", override: "o" },
    stateLook({
      value: "500",
      object: { common: { name: "S", write: true } },
      overrides: [
        repair({
          label: "Power",
          unit: "W",
          type: "number",
          write: false,
          transform: {
            read: {
              kind: "scale",
              inMin: 0,
              inMax: 1000,
              outMin: 0,
              outMax: 1,
            },
          },
        }),
      ],
    }),
  );
  expect(source).toMatchObject({
    value: 0.5,
    writable: false,
    label: "Power",
    unit: "W",
    overrideId: "o",
  });
});

it("a missing override falls back to the raw state and says so", () => {
  const source = resolveSlotSource(
    { kind: "state", stateId: "s", override: "gone" },
    stateLook({ value: "raw", object: { common: { name: "S" } } }),
  );
  expect(source?.value).toBe("raw");
  expect(source?.error).toContain("gone");
});

it("ignores an override bound to another state", () => {
  const source = resolveSlotSource(
    { kind: "state", stateId: "s", override: "o" },
    stateLook({
      value: 1,
      object: { common: { name: "S" } },
      overrides: [repair({ stateId: "other" })],
    }),
  );
  expect(source).toMatchObject({ value: 1 });
  expect(source?.overrideId).toBeUndefined();
  expect(source?.error).toContain("other");
});

it("a derived override returns its computed value", () => {
  const source = resolveSlotSource(
    { kind: "state", stateId: "s", override: "d" },
    stateLook({ derived: () => ({ value: 9.3 }) }),
  );
  expect(source).toMatchObject({
    value: 9.3,
    writable: false,
    overrideId: "d",
  });
});

it("a derived override carries its own presentation, not the anchor's", () => {
  const source = resolveSlotSource(
    { kind: "state", stateId: "s", override: "d" },
    stateLook({
      value: 55,
      object: { common: { name: "Humidity", type: "number", unit: "%" } },
      overrides: [
        {
          id: "d",
          stateId: "s",
          kind: "derived",
          name: "dewpoint",
          unit: "°C",
          type: "number",
        },
      ],
      derived: () => ({ value: 9.3 }),
    }),
  );
  expect(source).toMatchObject({
    value: 9.3,
    unit: "°C",
    label: "dewpoint",
    overrideId: "d",
  });
});

it("surfaces a derived error without a value", () => {
  const source = resolveSlotSource(
    { kind: "state", stateId: "s", override: "d" },
    stateLook({
      value: 1,
      object: { common: { name: "S" } },
      overrides: [{ id: "d", stateId: "s", kind: "derived", name: "dew" }],
      derived: () => ({ error: 'unknown sibling "nope"' }),
    }),
  );
  expect(source).toMatchObject({
    value: undefined,
    writable: false,
    available: false,
  });
  expect(source?.error).toContain("nope");
});

it("carries the override's history to the chart", () => {
  const history = { duration: 24, durationUnit: "hours" as const };
  const source = resolveSlotSource(
    { kind: "state", stateId: "s", override: "o" },
    stateLook({
      object: { common: { name: "S" } },
      overrides: [repair({ history })],
    }),
  );
  expect(source?.history).toEqual(history);
});

it("sourceStateIds subscribes a derived override's inputs", () => {
  expect(
    sourceStateIds(
      { kind: "state", stateId: "s", override: "d" },
      [],
      [],
      [
        {
          id: "d",
          stateId: "s",
          kind: "derived",
          name: "dew",
          inputs: ["s.a", "s.b"],
        },
      ],
    ),
  ).toEqual(["s", "s.a", "s.b"]);
});
