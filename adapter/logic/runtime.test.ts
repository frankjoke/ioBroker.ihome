import { expect, it } from "vitest";
import { createLogicRuntime, isNoop, type NameInfo } from "./runtime";
import type { FunctionLogic } from "./types";

const logic = (code: string): FunctionLogic => ({
  id: "calc",
  name: "Calc",
  kind: "function",
  expr: { code },
});

function runtimeFor(source: string, info: Record<string, NameInfo> = {}) {
  const writes: unknown[][] = [];
  const runtime = createLogicRuntime(logic(source), {
    describe: (name) => info[name],
    write: (...args) => writes.push(args),
    now: () => 1000,
  });
  return { runtime, writes };
}

it("runs a compiled expression with get", () => {
  const { runtime } = runtimeFor('get("a") + 1', {
    a: { value: 4, ack: true, from: "x", ts: 1, changed: true, writable: true },
  });
  expect(runtime.run('get("a") + 1', 0)).toBe(5);
});

it("state() exposes metadata and writes", () => {
  const info = {
    a: { value: 4, ack: true, from: "x", ts: 1, changed: true, writable: true },
  };
  expect(
    runtimeFor('state("a").changed', info).runtime.run('state("a").changed', 0),
  ).toBe(true);
  const { runtime, writes } = runtimeFor('state("a").set(9)', info);
  runtime.run('state("a").set(9)', 0);
  expect(writes).toEqual([["a", 9, false, 0]]);
  const globalSet = runtimeFor('set("a", 9)', info);
  globalSet.runtime.run('set("a", 9)', 0);
  expect(globalSet.writes).toEqual([["a", 9, false, 0]]);
});

it("noop() is a sentinel", () => {
  const { runtime } = runtimeFor("noop()");
  expect(isNoop(runtime.run("noop()", 0))).toBe(true);
});

it("compile errors name the path", () => {
  expect(() => runtimeFor("1 +")).toThrow(/expr: expression failed to compile/);
});

it("a loop hits the 50 ms timeout", () => {
  const { runtime } = runtimeFor("(() => { for (;;); })()");
  expect(() => runtime.run("(() => { for (;;); })()", 0)).toThrow(/timed out/i);
});

it("eval and Function are blocked", () => {
  const evalRuntime = runtimeFor('eval("1")').runtime;
  expect(() => evalRuntime.run('eval("1")', 0)).toThrow(/code generation/i);
  const functionRuntime = runtimeFor('Function("return 1")()').runtime;
  expect(() => functionRuntime.run('Function("return 1")()', 0)).toThrow(
    /code generation/i,
  );
});

it("helpers cannot be overwritten", () => {
  const { runtime } = runtimeFor('(get = 1, get("a"))', {
    a: { value: 4, ack: true, from: "x", ts: 1, changed: true, writable: true },
  });
  expect(runtime.run('(get = 1, get("a"))', 0)).toBe(4);
});

it("the context persists between runs", () => {
  const source = "globalThis.n = (globalThis.n ?? 0) + 1";
  const { runtime } = runtimeFor(source);
  expect(runtime.run(source, 0)).toBe(1);
  expect(runtime.run(source, 0)).toBe(2);
});

it("refuses to write a read-only name", () => {
  const info = {
    c: {
      value: 1,
      ack: true,
      ts: 1,
      changed: false,
      writable: false,
    },
  };
  const globalSet = runtimeFor('set("c", 2)', info);
  expect(() => globalSet.runtime.run('set("c", 2)', 0)).toThrow(/not writable/);
  expect(globalSet.writes).toEqual([]);
  const viaState = runtimeFor('state("c").set(2)', info);
  expect(() => viaState.runtime.run('state("c").set(2)', 0)).toThrow(
    /not writable/,
  );
  expect(viaState.writes).toEqual([]);
});

it("missing names read undefined and still accept a write", () => {
  const { runtime } = runtimeFor('state("x")');
  expect(runtime.run('state("x")', 0)).toMatchObject({
    value: undefined,
    ack: true,
    ts: 1000,
    changed: false,
  });
  const write = runtimeFor('set("x", 1, true)');
  write.runtime.run('set("x", 1, true)', 0);
  expect(write.writes).toEqual([["x", 1, true, 0]]);
});
