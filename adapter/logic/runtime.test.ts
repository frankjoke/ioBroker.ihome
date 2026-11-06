import { describe, expect, it } from "vitest";
import {
  createLogicRuntime,
  isGotoSignal,
  isNoop,
  type NameInfo,
  type RuntimeHooks,
} from "./runtime";
import type { FetchOptions } from "./tasks";
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
  const fetches: Array<{
    url: string;
    options: FetchOptions | undefined;
    run: (data: unknown, error: string | null) => void;
    depth: number;
  }> = [];
  const runtime = createLogicRuntime(logic(source), {
    describe: (name) => info[name],
    write: (...args) => writes.push(args),
    log: () => {},
    message: (...args) => messages.push(args),
    notify: () => {},
    fetchJson: (url, options, run, depth) =>
      fetches.push({ url, options, run, depth }),
    now: () => 1000,
  });
  return { runtime, writes, messages, fetches };
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
  notifications: unknown[][] = [],
  fetches: unknown[][] = [],
): RuntimeHooks {
  return {
    describe: (name) => names[name],
    write: (...args) => writes.push(args),
    log: (...args) => logs.push(args),
    message: (...args) => messages.push(args),
    notify: (...args) => notifications.push(args),
    fetchJson: (...args) => fetches.push(args),
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

it("notify sends title, body and level", () => {
  const notifications: unknown[][] = [];
  const def = machine('notify("Alarm {{a}}", "Pump low", "Warning")');
  const rt = createLogicRuntime(
    def,
    blockHooks([], [], { a: info(4) }, [], notifications),
  );
  rt.runStatements(def.states.A.on![0].do!, 0);
  expect(notifications).toEqual([["warn", "Alarm 4", "Pump low"]]);
});

it("notify defaults to info and an empty body", () => {
  const notifications: unknown[][] = [];
  const def = machine('notify("Hello")');
  const rt = createLogicRuntime(def, blockHooks([], [], {}, [], notifications));
  rt.runStatements(def.states.A.on![0].do!, 0);
  expect(notifications).toEqual([["info", "Hello", ""]]);
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

describe("fetchJson", () => {
  it("returns noop and schedules at depth + 1", () => {
    const { runtime, fetches } = runtimeFor(
      'fetchJson("https://api.test/x", () => {})',
    );
    expect(
      isNoop(
        runtime.runExpr(
          { code: 'fetchJson("https://api.test/x", () => {})' },
          4,
        ),
      ),
    ).toBe(true);
    expect(fetches).toHaveLength(1);
    expect(fetches[0].url).toBe("https://api.test/x");
    expect(fetches[0].depth).toBe(5);
    expect(fetches[0].options).toBeUndefined();
  });

  it("passes options through", () => {
    const code =
      'fetchJson("https://x", () => {}, { method: "post", headers: { "X-Key": "k", bad: 1 }, body: "{}" })';
    const { runtime, fetches } = runtimeFor(code);
    runtime.runExpr({ code }, 0);
    expect(fetches[0].options).toEqual({
      method: "post",
      headers: { "X-Key": "k" },
      body: "{}",
    });
  });

  it("rejects a non-http url and a missing callback synchronously", () => {
    const badUrl = 'fetchJson("ftp://x", () => {})';
    const badUrlRuntime = runtimeFor(badUrl).runtime;
    expect(() => badUrlRuntime.runExpr({ code: badUrl }, 0)).toThrow(
      /fetchJson needs an http\(s\) url/,
    );

    const noCallback = 'fetchJson("https://x")';
    const noCallbackRuntime = runtimeFor(noCallback).runtime;
    expect(() => noCallbackRuntime.runExpr({ code: noCallback }, 0)).toThrow(
      /fetchJson needs a callback/,
    );
  });

  it("rejects an async callback synchronously", () => {
    const source = 'fetchJson("https://x", async () => {})';
    const { runtime, fetches } = runtimeFor(source);
    expect(() => runtime.runExpr({ code: source }, 0)).toThrow(
      /fetchJson needs a synchronous callback/,
    );
    expect(fetches).toHaveLength(0);
  });

  it("rejects a callback that returns a promise", () => {
    const source =
      'fetchJson("https://x", () => Promise.reject(new Error("late")))';
    const { runtime, fetches } = runtimeFor(source);
    runtime.runExpr({ code: source }, 0);
    expect(() => fetches[0].run(null, null)).toThrow(
      /fetchJson needs a synchronous callback/,
    );
  });

  it("runs the callback later with data and the callback depth", () => {
    const source =
      'fetchJson("https://x", (data, error) => set("0_userdata.0.OUT", error ?? data.v))';
    const { runtime, fetches, writes } = runtimeFor(source);
    runtime.runExpr({ code: source }, 4);
    fetches[0].run({ v: 7 }, null);
    expect(writes).toEqual([["0_userdata.0.OUT", 7, false, undefined, 5]]);
  });

  it("runs the callback on failure with the error string", () => {
    const source =
      'fetchJson("https://x", (data, error) => set("out", String(error)))';
    const { runtime, fetches, writes } = runtimeFor(source);
    runtime.runExpr({ code: source }, 0);
    fetches[0].run(undefined, "boom");
    expect(writes).toEqual([["out", "boom", false, undefined, 1]]);
  });

  it("keeps the action block's this in the callback", () => {
    const writes: unknown[][] = [];
    const fetches: unknown[][] = [];
    const def = machine(
      'this.tag = "on"\nfetchJson("https://x", function (data) { set("out", this.tag + data) })',
    );
    const rt = createLogicRuntime(
      def,
      blockHooks(writes, [], {}, [], [], fetches),
    );
    rt.runStatements(def.states.A.on![0].do!, 0);
    const run = fetches[0][2] as (data: unknown, error: string | null) => void;
    run("!", null);
    expect(writes).toEqual([["out", "on!", false, undefined, 1]]);
  });

  it("keeps the scheduling state's object after another state ran", () => {
    const writes: unknown[][] = [];
    const fetches: unknown[][] = [];
    const def: MachineLogic = {
      ...machine(
        'this.tag = "A"\nfetchJson("https://x", () => set("out", this.tag))',
      ),
      states: {
        A: {
          on: [
            {
              on: "e",
              mode: "function",
              do: {
                code: 'this.tag = "A"\nfetchJson("https://x", () => set("out", this.tag))',
              },
            },
          ],
        },
        B: {
          on: [
            {
              on: "e",
              mode: "function",
              do: { code: 'this.tag = "B"' },
            },
          ],
        },
      },
    };
    const rt = createLogicRuntime(
      def,
      blockHooks(writes, [], {}, [], [], fetches),
    );
    rt.runStatements(def.states.A.on![0].do!, 0);
    rt.runStatements(def.states.B.on![0].do!, 0);
    const run = fetches[0][2] as (data: unknown, error: string | null) => void;
    run(null, null);
    expect(writes).toEqual([["out", "A", false, undefined, 1]]);
  });

  it("blocks goto inside a callback", () => {
    const fetches: unknown[][] = [];
    const def = machine('fetchJson("https://x", () => goto("B"))');
    const rt = createLogicRuntime(def, blockHooks([], [], {}, [], [], fetches));
    rt.runStatements(def.states.A.on![0].do!, 0);
    const run = fetches[0][2] as (data: unknown, error: string | null) => void;
    expect(() => run(null, null)).toThrow(
      "goto is not available in a fetch callback",
    );
  });

  it("still allows goto() and goto(NOACTION) inside a callback", () => {
    for (const call of ["goto()", "goto(NOACTION)"]) {
      const fetches: unknown[][] = [];
      const writes: unknown[][] = [];
      const def = machine(
        `fetchJson("https://x", () => { ${call}; set("out", 1) })`,
      );
      const rt = createLogicRuntime(
        def,
        blockHooks(writes, [], {}, [], [], fetches),
      );
      rt.runStatements(def.states.A.on![0].do!, 0);
      const run = fetches[0][2] as (
        data: unknown,
        error: string | null,
      ) => void;
      run(null, null);
      expect(writes).toEqual([["out", 1, false, undefined, 1]]);
    }
  });

  it("can schedule another fetch from a callback", () => {
    const fetches: unknown[][] = [];
    const def = machine(
      'fetchJson("https://a", () => fetchJson("https://b", () => {}))',
    );
    const rt = createLogicRuntime(def, blockHooks([], [], {}, [], [], fetches));
    rt.runStatements(def.states.A.on![0].do!, 0);
    const run = fetches[0][2] as (data: unknown, error: string | null) => void;
    run(null, null);
    expect(fetches.map((entry) => entry[0])).toEqual([
      "https://a",
      "https://b",
    ]);
    expect(fetches[1][3]).toBe(2); // callback depth + 1
  });

  it("hits the 50 ms timeout inside a callback", () => {
    const fetches: unknown[][] = [];
    const def = machine('fetchJson("https://x", () => { for (;;) {} })');
    const rt = createLogicRuntime(def, blockHooks([], [], {}, [], [], fetches));
    rt.runStatements(def.states.A.on![0].do!, 0);
    const run = fetches[0][2] as (data: unknown, error: string | null) => void;
    expect(() => run(null, null)).toThrow(/timed out/i);
  });

  it("get and state work inside a callback with the callback depth", () => {
    const names = {
      a: {
        value: 4,
        ack: true,
        from: "x",
        ts: 1,
        changed: true,
        writable: true,
      },
    };
    const fetches: unknown[][] = [];
    const writes: unknown[][] = [];
    const def = machine(
      'fetchJson("https://x", () => set("out", get("a") + (state("a").changed ? 1 : 0)))',
    );
    const rt = createLogicRuntime(
      def,
      blockHooks(writes, [], names, [], [], fetches),
    );
    rt.runStatements(def.states.A.on![0].do!, 0);
    const run = fetches[0][2] as (data: unknown, error: string | null) => void;
    run(null, null);
    expect(writes).toEqual([["out", 5, false, undefined, 1]]);
  });

  it('set("$self") bypasses the read-only pseudo input', () => {
    const names = {
      $self: {
        value: false,
        ack: true,
        ts: 1,
        changed: false,
        writable: false,
      },
    };
    const { runtime, writes } = runtimeFor('set("$self", 1)', names);
    runtime.runExpr({ code: 'set("$self", 1)' }, 0);
    expect(writes).toEqual([["$self", 1, false, undefined, 0]]);
  });
});
