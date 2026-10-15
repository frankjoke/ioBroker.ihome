import { it, expect } from "vitest";
import { applyWrite } from "$lib/utils/transform";
import { writeControl, resetWriteLocks } from "$lib/utils/control-write";

function fakeClient() {
  const writes: unknown[] = [];
  return {
    writes,
    setState: (_id: string, value: unknown) => {
      writes.push(value);
      return Promise.resolve();
    },
  };
}

const control = {
  stateId: "a.0.SET",
  writable: true,
  available: true,
  transform: undefined,
};

it("writes once and refuses a second press until the first lands", () => {
  resetWriteLocks();
  const client = fakeClient();
  // two presses in the same instant (a double click, or a duplicated handler)
  expect(writeControl(client, control, true, 1000, { lockMs: 750 })).toBe(true);
  expect(writeControl(client, control, false, 1010, { lockMs: 750 })).toBe(
    false,
  );
  expect(client.writes).toEqual([true]);
  // once the lock expires the control is live again
  expect(writeControl(client, control, false, 1800, { lockMs: 750 })).toBe(
    true,
  );
  expect(client.writes).toEqual([true, false]);
});

it("never locks a slider: every step of a drag must land", () => {
  resetWriteLocks();
  const client = fakeClient();
  for (const v of [10, 20, 30, 40]) {
    expect(writeControl(client, control, v, 1000)).toBe(true);
  }
  expect(client.writes).toEqual([10, 20, 30, 40]);
});

it("refuses to write a control that cannot take it", () => {
  resetWriteLocks();
  const client = fakeClient();
  expect(
    writeControl(client, { ...control, writable: false }, 1, 1000, {
      lockMs: 750,
    }),
  ).toBe(false);
  expect(
    writeControl(client, { ...control, available: false }, 1, 1000, {
      lockMs: 750,
    }),
  ).toBe(false);
  expect(
    writeControl(client, { ...control, stateId: undefined }, 1, 1000, {
      lockMs: 750,
    }),
  ).toBe(false);
  expect(client.writes).toEqual([]);
});
