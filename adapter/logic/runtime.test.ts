import { expect, it } from "vitest";
import {
  createLogicRuntime,
  isGotoSignal,
  isNoop,
  type NameInfo,
  type RuntimeHooks,
} from "./runtime";
import type { Expr, FunctionLogic, MachineLogic } from "./types";

const logic = (code: string): FunctionLogic => ({
  id: "calc",
  name: "Calc",
  kind: "function",
  expr: { code },
});

function runtimeFor(source: string, info: Record<string, NameInfo> = {}) {
  const writes: unknown[][] = [];
  const messages: unknown[][] = [];
  const runtime = createLogicRuntime(logic(source), {
    describe: (name) => info[name],
    write: (...args) => writes.push(args),
    log: () => {},
    message: (...args) => messages.push(args),
    now: () => 1000,
  });
  return { runtime, writes, messages };
}

const machine = (source: string): MachineLogic => ({
  id: "m",
  name: "M",
  kind: "machine",
  states: {
    A: { on: [{ on: "e", mode: "function", do: { code: source } }] },
    B: {},
  },
});

const info = (value: unknown): NameInfo => ({
  value,
  ack: true,
  ts: 1,
  changed: false,
  writable: true,
});

function blockHooks(
  writes: unknown[][],
  logs: unknown[][] = [],
  names: Record<string, NameInfo> = {},
  messages: unknown[][] = [],
): RuntimeHooks {
  return {
    describe: (name) => names[name],
    write: (...args) => writes.push(args),
    log: (...args) => logs.push(args),
    message: (...args) => messages.push(args),
    now: () => 1000,
  };
}

it("runs a compiled expression with get", () => {
  const { runtime } = runtimeFor('get("a") + 1', {
    a: { value: 4, ack: true, from: "x", ts: 1, changed: true, writable: true },
  });
  expect(runtime.runExpr({ code: 'get("a") + 1' }, 0)).toBe(5);
});

it("state() exposes metadata and writes", () => {
  const info = {
    a: { value: 4, ack: true, from: "x", ts: 1, changed: true, writable: true },
  };
  expect(
    runtimeFor('state("a").changed', info).runtime.runExpr(
      { code: 'state("a").changed' },
      0,
    ),
  ).toBe(true);
  const { runtime, writes } = runtimeFor('state("a").set(9)', info);
  runtime.runExpr({ code: 'state("a").set(9)' }, 0);
  expect(writes).toEqual([["a", 9, false, undefined, 0]]);
  const globalSet = runtimeFor('set("a", 9)', info);
  globalSet.runtime.runExpr({ code: 'set("a", 9)' }, 0);
  expect(globalSet.writes).toEqual([["a", 9, false, undefined, 0]]);
});

it("noop() is a sentinel", () => {
  const { runtime } = runtimeFor("noop()");
  expect(isNoop(runtime.runExpr({ code: "noop()" }, 0))).toBe(true);
});

it("compile errors name the path", () => {
  expect(() => runtimeFor("1 +")).toThrow(/expr: expression failed to compile/);
});

it("a loop hits the 50 ms timeout", () => {
  const { runtime } = runtimeFor("(() => { for (;;); })()");
  expect(() => runtime.runExpr({ code: "(() => { for (;;); })()" }, 0)).toThrow(
    /timed out/i,
  );
});

it("eval and Function are blocked", () => {
  const evalRuntime = runtimeFor('eval("1")').runtime;
  expect(() => evalRuntime.runExpr({ code: 'eval("1")' }, 0)).toThrow(
    /code generation/i,
  );
  const functionRuntime = runtimeFor('Function("return 1")()').runtime;
  expect(() =>
    functionRuntime.runExpr({ code: 'Function("return 1")()' }, 0),
  ).toThrow(/code generation/i);
});

it("helpers cannot be overwritten", () => {
  const { runtime } = runtimeFor('(get = 1, get("a"))', {
    a: { value: 4, ack: true, from: "x", ts: 1, changed: true, writable: true },
  });
  expect(runtime.runExpr({ code: '(get = 1, get("a"))' }, 0)).toBe(4);
});

it("does not expose console", () => {
  const { runtime } = runtimeFor("typeof console");
  expect(runtime.runExpr({ code: "typeof console" }, 0)).toBe("undefined");
});

it("the context persists between runs", () => {
  const source = "globalThis.n = (globalThis.n ?? 0) + 1";
  const { runtime } = runtimeFor(source);
  expect(runtime.runExpr({ code: source }, 0)).toBe(1);
  expect(runtime.runExpr({ code: source }, 0)).toBe(2);
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
  expect(() => globalSet.runtime.runExpr({ code: 'set("c", 2)' }, 0)).toThrow(
    /not writable/,
  );
  expect(globalSet.writes).toEqual([]);
  const viaState = runtimeFor('state("c").set(2)', info);
  expect(() =>
    viaState.runtime.runExpr({ code: 'state("c").set(2)' }, 0),
  ).toThrow(/not writable/);
  expect(viaState.writes).toEqual([]);
});

it("missing names read undefined and still accept a write", () => {
  const { runtime } = runtimeFor('state("x")');
  expect(runtime.runExpr({ code: 'state("x")' }, 0)).toMatchObject({
    value: undefined,
    ack: true,
    ts: 1000,
    changed: false,
  });
  const write = runtimeFor('set("x", 1, true)');
  write.runtime.runExpr({ code: 'set("x", 1, true)' }, 0);
  expect(write.writes).toEqual([["x", 1, true, undefined, 0]]);
});

it("keeps this across calls of the same block", () => {
  const writes: unknown[][] = [];
  const def = machine('this.n = (this.n ?? 0) + 1\nset("out", this.n)');
  const rt = createLogicRuntime(def, blockHooks(writes));
  const block = def.states.A.on![0].do!;
  rt.runStatements(block, 0);
  rt.runStatements(block, 0);
  expect(writes.map((w) => w[1])).toEqual([1, 2]);
});

it("keeps this per state", () => {
  const writes: unknown[][] = [];
  const code = 'this.n = (this.n ?? 0) + 1\nset("out", this.n)';
  const def: MachineLogic = {
    ...machine(code),
    all: { on: [{ on: "e", mode: "function", do: { code } }] },
  };
  const rt = createLogicRuntime(def, blockHooks(writes));
  const inState = def.states.A.on![0].do!;
  const inAll = def.all!.on![0].do!;
  rt.runStatements(inState, 0);
  rt.runStatements(inAll, 0);
  rt.runStatements(inState, 0);
  rt.runStatements(inAll, 0);
  rt.runStatements(inAll, 0);
  expect(writes.map((w) => w[1])).toEqual([1, 1, 2, 2, 3]);
});

it("shares this between enter, exit and rows of one state", () => {
  const writes: unknown[][] = [];
  const def: MachineLogic = {
    id: "m",
    name: "M",
    kind: "machine",
    states: {
      A: {
        enter: { code: "this.n = 1" },
        exit: { code: 'set("out", this.n)' },
        on: [{ on: "e", mode: "function", do: { code: "this.n += 1" } }],
      },
    },
  };
  const rt = createLogicRuntime(def, blockHooks(writes));
  rt.runStatements(def.states.A.enter!, 0);
  rt.runStatements(def.states.A.on![0].do!, 0);
  rt.runStatements(def.states.A.exit!, 0);
  expect(writes.map((w) => w[1])).toEqual([2]);
});

it("goto(state) throws a GotoSignal", () => {
  const def = machine('goto("B")');
  const rt = createLogicRuntime(def, blockHooks([]));
  let thrown: unknown;
  try {
    rt.runStatements(def.states.A.on![0].do!, 0);
  } catch (error) {
    thrown = error;
  }
  expect(isGotoSignal(thrown)).toBe(true);
  expect(thrown).toMatchObject({ state: "B" });
});

it("goto() and goto(NOACTION) stay; a following set still runs", () => {
  for (const code of ["goto()", "goto(NOACTION)"]) {
    const writes: unknown[][] = [];
    const def = machine(`${code}\nset("out", 1)`);
    const rt = createLogicRuntime(def, blockHooks(writes));
    rt.runStatements(def.states.A.on![0].do!, 0);
    expect(writes).toEqual([["out", 1, false, undefined, 0]]);
  }
});

it('goto(undefined) and goto("") are mistakes', () => {
  for (const code of ["goto(undefined)", 'goto("")']) {
    const def = machine(code);
    const rt = createLogicRuntime(def, blockHooks([]));
    expect(() => rt.runStatements(def.states.A.on![0].do!, 0)).toThrow(
      /goto needs a state name/,
    );
  }
});

it("set takes ack and forward options", () => {
  const writes: unknown[][] = [];
  const def = machine(
    'set("out", 1, { ack: true, forward: "always" })\nstate("o2").set(2, true)',
  );
  const rt = createLogicRuntime(def, blockHooks(writes));
  rt.runStatements(def.states.A.on![0].do!, 0);
  expect(writes).toEqual([
    ["out", 1, true, "always", 0],
    ["o2", 2, true, undefined, 0],
  ]);
});

it("log interpolates {{ref}} and takes a level", () => {
  const logs: unknown[][] = [];
  const def = machine('log("hi {{a}} {{ nope }}", "warn")');
  const rt = createLogicRuntime(def, blockHooks([], logs, { a: info(4) }));
  rt.runStatements(def.states.A.on![0].do!, 0);
  expect(logs).toEqual([["warn", "hi 4 —"]]);
});

it("message interpolates, takes a level and a timeout", () => {
  const messages: unknown[][] = [];
  const def = machine('message("hi {{a}}", "Warning", 5)');
  const rt = createLogicRuntime(
    def,
    blockHooks([], [], { a: info(4) }, messages),
  );
  rt.runStatements(def.states.A.on![0].do!, 0);
  expect(messages).toEqual([["warn", "hi 4", 5]]);
});

it("message defaults to info and keeps 0 as sticky", () => {
  const messages: unknown[][] = [];
  const def = machine('message("one")\nmessage("two", "error", 0)');
  const rt = createLogicRuntime(def, blockHooks([], [], {}, messages));
  rt.runStatements(def.states.A.on![0].do!, 0);
  expect(messages).toEqual([
    ["info", "one", undefined],
    ["error", "two", 0],
  ]);
});

it("return ends the block", () => {
  const writes: unknown[][] = [];
  const def = machine('return 1\nset("out", 2)');
  const rt = createLogicRuntime(def, blockHooks(writes));
  rt.runStatements(def.states.A.on![0].do!, 0);
  expect(writes).toEqual([]);
});

it("a block can declare a const on every run", () => {
  const def = machine("const x = 1");
  const rt = createLogicRuntime(def, blockHooks([]));
  const block = def.states.A.on![0].do!;
  rt.runStatements(block, 0);
  expect(() => rt.runStatements(block, 0)).not.toThrow();
});

it("a statement loop hits the 50 ms timeout", () => {
  const def = machine("for (;;) {}");
  const rt = createLogicRuntime(def, blockHooks([]));
  expect(() => rt.runStatements(def.states.A.on![0].do!, 0)).toThrow(
    /timed out/i,
  );
});

it("a statement syntax error names the path", () => {
  expect(() => createLogicRuntime(machine("if ("), blockHooks([]))).toThrow(
    /states\.A\.on\.0\.do: action code failed to compile/,
  );
});

it("a caught goto signal does not throw out of the block", () => {
  const rt = createLogicRuntime(machine(""), blockHooks([]));
  expect(() =>
    rt.runStatements({ code: 'try { goto("B") } catch (e) {}' } as Expr, 0),
  ).not.toThrow();
});
