import { it, expect } from "vitest";
import { resolveTile } from "$lib/config/tile-resolve";
import { writeControl } from "$lib/utils/control-write";

it("builds a raw state's meta from its object, range included", () => {
  const res = resolveTile(
    {
      slots: [{ kind: "level", source: { kind: "state", stateId: "a.0.x" } }],
    } as any,
    "T",
    {
      states: new Map([["a.0.x", { val: 42 }]]),
      objects: new Map([
        [
          "a.0.x",
          {
            common: {
              type: "number",
              role: "level.dimmer",
              min: 0,
              max: 255,
              step: 5,
            },
          },
        ],
      ]),
    },
  );
  expect(res.device.controls[0].meta?.min).toBe(0);
  expect(res.device.controls[0].meta?.max).toBe(255);
  expect(res.device.controls[0].meta?.step).toBe(5);
});

it("writes a repaired state through its override's write transform", async () => {
  const transform = {
    read: {
      kind: "scale" as const,
      inMin: 0,
      inMax: 100,
      outMin: 0,
      outMax: 100,
    },
    write: {
      kind: "scale" as const,
      inMin: 0,
      inMax: 100,
      outMin: 0,
      outMax: 1,
      clamp: true,
    },
  };
  const res = resolveTile(
    {
      slots: [
        {
          kind: "level",
          source: { kind: "state", stateId: "a.0.x", override: "o" },
        },
      ],
    } as any,
    "T",
    {
      states: new Map([["a.0.x", { val: 50 }]]),
      objects: new Map([
        ["a.0.x", { common: { type: "number", write: true } }],
      ]),
      overrides: [
        {
          id: "o",
          stateId: "a.0.x",
          kind: "repair",
          name: "level",
          type: "number",
          write: true,
          transform,
        },
      ],
    },
  );
  const control = res.device.controls[0];
  expect(control.transform).toEqual(transform);
  const writes: [string, unknown][] = [];
  writeControl(
    {
      setState: async (id: string, value: unknown) => writes.push([id, value]),
    },
    control,
    50,
  );
  expect(writes).toEqual([["a.0.x", 0.5]]);
});
