import { it, expect } from "vitest";
import { writeControl, resetWriteLocks } from "$lib/utils/control-write";

function fakeClient() {
  const writes: unknown[] = [];
  const ids: string[] = [];
  return {
    writes,
    ids,
    setState: (id: string, value: unknown) => {
      writes.push(value);
      ids.push(id);
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

it("writes a raw-state switch through the same path", () => {
  resetWriteLocks();
  const client = fakeClient();
  expect(
    writeControl(
      client,
      { stateId: "0_userdata.0.x", writable: true, available: true },
      true,
    ),
  ).toBe(true);
  expect(client.ids).toEqual(["0_userdata.0.x"]);
  expect(client.writes).toEqual([true]);
});

it("holds a toggle until the broker confirms it, not for a fixed time", () => {
  resetWriteLocks();
  const client = fakeClient();
  const live = { ...control, available: true, liveValue: false };

  expect(writeControl(client, live, true, 1000, { lockMs: 3000 })).toBe(true);
  // still unconfirmed at 10s? no: the ceiling is the guard, the value is the truth
  live.liveValue = false;
  expect(writeControl(client, live, true, 1100, { lockMs: 3000 })).toBe(false);
  // the broker echoes it back -> the next press is allowed at once
  live.liveValue = true;
  expect(writeControl(client, live, false, 1200, { lockMs: 3000 })).toBe(true);
  // ...and a press that arrives after the ceiling is allowed even without an echo
  live.liveValue = false;
  expect(writeControl(client, live, true, 9000, { lockMs: 3000 })).toBe(true);
  expect(client.writes).toEqual([true, false, true]);
});
