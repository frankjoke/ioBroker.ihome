import { it, expect } from "vitest";
import {
  resolveSlotSource,
  sourceChipKey,
  type SourceLook,
} from "$lib/config/slot-source";
import type { EnrichedDevice } from "$lib/types/device";
import type { SourceOverride } from "$lib/types/overrides";

const look = (
  _devices: EnrichedDevice[],
  extra: { states?: Map<string, any>; objects?: Map<string, any> } = {},
): SourceLook => ({
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

it("carries a repair override's transform for the write path", () => {
  const transform = {
    read: {
      kind: "scale" as const,
      inMin: 0,
      inMax: 1,
      outMin: 0,
      outMax: 100,
    },
    write: {
      kind: "scale" as const,
      inMin: 0,
      inMax: 100,
      outMin: 0,
      outMax: 1,
    },
  };
  const source = resolveSlotSource(
    { kind: "state", stateId: "s", override: "o" },
    stateLook({ overrides: [repair({ transform })] }),
  );
  expect(source?.transform).toEqual(transform);
});

it("keys a source chip by its kind and override", () => {
  expect(sourceChipKey({ kind: "state", stateId: "s" })).toBe("s:override:");
  expect(sourceChipKey({ kind: "state", stateId: "s", override: "o" })).toBe(
    "s:override:o",
  );
  expect(
    sourceChipKey({ kind: "control", device: "d", control: "c" }, "s"),
  ).toBe("s:control:d:c");
  expect(sourceChipKey({ kind: "device", device: "d" })).toBe("device:d");
});

const variables: SourceLook["variables"] = [
  {
    id: "v1",
    name: "LampVar",
    kind: "state",
    type: "string",
    stateId: "0_userdata.0.lamp",
  },
  {
    id: "v2",
    name: "OtherVar",
    kind: "state",
    type: "number",
    stateId: "0_userdata.0.other",
  },
];

it("applies an override stored under a variable name", () => {
  const l = stateLook({
    id: "0_userdata.0.lamp",
    value: "12",
    overrides: [repair({ stateId: "LampVar", unit: "A", type: "number" })],
  });
  l.variables = variables;
  const source = resolveSlotSource(
    { kind: "state", stateId: "LampVar", override: "o" },
    l,
  );
  expect(source?.overrideId).toBe("o");
  expect(source?.unit).toBe("A");
  expect(source?.value).toBe(12);
});
