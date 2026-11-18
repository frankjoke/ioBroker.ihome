import { expect, it } from "vitest";
import { createEngine } from "./engine";
import { logicSubscriptions } from "./subscriptions";
import { createHarness } from "./testing";
import type { Expr, FunctionLogic, LogicDocument } from "./types";

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const code = (source: string): Expr => ({ code: source });

const fn = (id: string, extra: Partial<FunctionLogic> = {}): FunctionLogic => ({
  id,
  name: id.toUpperCase(),
  kind: "function",
  init: { run: false },
  output: { scope: "memory" },
  expr: code("1"),
  ...extra,
});

const input = (ref: string) => ({
  from: { type: "state" as const, ref },
  kind: "event" as const,
});

const started = (
  document: LogicDocument,
  values: Record<string, unknown> = {},
) => {
  const h = createHarness(values);
  const engine = createEngine(document, h.deps);
  h.attach(engine);
  engine.start();
  return { h, engine };
};

it("keeps an unchanged logic's this across another update", () => {
  const document = (bExpr: Expr): LogicDocument => ({
    version: 3,
    logics: [
      fn("a", {
        mode: "statements",
        inputs: { s: input("0_userdata.0.S") },
        output: { scope: "state", ref: "0_userdata.0.A", type: "number" },
        expr: code("this.x = (this.x ?? 0) + 1; return this.x;"),
      }),
      fn("b", {
        inputs: { o: input("0_userdata.0.O") },
        output: { scope: "state", ref: "0_userdata.0.B", type: "number" },
        expr: bExpr,
      }),
    ],
  });
  const { h, engine } = started(document(code('get("o")')), {
    "0_userdata.0.S": 0,
    "0_userdata.0.O": 0,
  });
  h.change("0_userdata.0.S", 1);
  expect(h.writes.at(-1)?.value).toBe(1);
  engine.update(document(code('get("o") + 1')));
  h.change("0_userdata.0.S", 2);
  expect(h.writes.at(-1)?.value).toBe(2);
});

it("restarts a changed logic cold and clears its memory output", () => {
  const document = (expr: Expr): LogicDocument => ({
    version: 3,
    logics: [
      fn("a", {
        mode: "statements",
        inputs: { s: input("0_userdata.0.S") },
        expr,
      }),
    ],
  });
  const { h, engine } = started(
    document(code("this.x = (this.x ?? 0) + 1; return 1;")),
    { "0_userdata.0.S": 0 },
  );
  h.change("0_userdata.0.S", 1);
  expect(engine.memoryValue("a")).toBe(1);
  engine.update(document(code("this.x = (this.x ?? 0) + 1; return 2;")));
  expect(engine.memoryValue("a")).toBeUndefined();
  h.change("0_userdata.0.S", 2);
  expect(engine.memoryValue("a")).toBe(2);
});

it("removes a logic's links and timers when it disappears", () => {
  const document = (enabled = true): LogicDocument => ({
    version: 3,
    logics: [
      fn("a", {
        enabled,
        inputs: { t: { from: { type: "timer", every: "5m" }, kind: "event" } },
        output: { scope: "state", ref: "0_userdata.0.A", type: "number" },
        expr: code('get("t")'),
      }),
    ],
  });
  const { h, engine } = started(document());
  expect(h.clock.pending).toBe(1);
  engine.update(document(false));
  expect(h.clock.pending).toBe(0);
  h.writes.length = 0;
  h.clock.advance(300_000);
  expect(h.writes).toEqual([]);
});

it("joins and leaves a running timer without starting a second one", () => {
  const document = (ids: string[]): LogicDocument => ({
    version: 3,
    logics: ids.map((id) =>
      fn(id, {
        inputs: { t: { from: { type: "timer", every: "10m" }, kind: "event" } },
        output: {
          scope: "state",
          ref: `0_userdata.0.${id.toUpperCase()}`,
          type: "string",
        },
        expr: code('get("$previous") === undefined ? "none" : "some"'),
      }),
    ),
  });
  const { h, engine } = started(document(["a"]));
  h.clock.advance(600_000);
  expect(h.writes.at(-1)).toEqual({
    id: "0_userdata.0.A",
    value: "none",
    ack: false,
  });
  engine.update(document(["a", "b"]));
  expect(h.clock.pending).toBe(1);
  h.writes.length = 0;
  h.clock.advance(600_000);
  expect(h.writes).toEqual([
    { id: "0_userdata.0.A", value: "some", ack: false },
    { id: "0_userdata.0.B", value: "none", ack: false },
  ]);
  engine.update(document(["b"]));
  expect(h.clock.pending).toBe(1);
  engine.update(document([]));
  expect(h.clock.pending).toBe(0);
});

it("drops an in-flight callback of a replaced logic", async () => {
  const document = (url: string): LogicDocument => ({
    version: 3,
    logics: [
      fn("a", {
        inputs: { t: { from: { type: "timer", every: "1s" }, kind: "event" } },
        output: { scope: "state", ref: "0_userdata.0.A", type: "number" },
        expr: code(`fetchJson("${url}", (data) => set("$self", data.v))`),
      }),
    ],
  });
  const { h, engine } = started(document("https://old"));
  h.clock.advance(1000);
  const request = h.nextRequest();
  expect(request).toBeDefined();
  engine.update(document("https://new"));
  request?.respond({ body: '{"v":7}' });
  await flush();
  expect(h.writes).toEqual([]);
});

it("stops a changed logic whose code no longer compiles", () => {
  const document = (aExpr: Expr): LogicDocument => ({
    version: 3,
    logics: [
      fn("a", {
        inputs: { s: input("0_userdata.0.S") },
        output: { scope: "state", ref: "0_userdata.0.A", type: "number" },
        expr: aExpr,
      }),
      fn("b", {
        inputs: { o: input("0_userdata.0.O") },
        output: { scope: "state", ref: "0_userdata.0.B", type: "number" },
        expr: code('get("o")'),
      }),
    ],
  });
  const { h, engine } = started(document(code('get("s")')), {
    "0_userdata.0.S": 0,
    "0_userdata.0.O": 0,
  });
  engine.update(document(code("this is not js")));
  h.writes.length = 0;
  h.change("0_userdata.0.S", 1);
  h.change("0_userdata.0.O", 2);
  expect(h.writes.map((write) => write.id)).toEqual(["0_userdata.0.B"]);
  expect(h.logs.some((line) => line.logicId === "a")).toBe(true);
});

it("leaves nothing behind when a logic id is renamed", () => {
  const document = (id: string): LogicDocument => ({
    version: 3,
    logics: [
      fn(id, {
        inputs: { s: input("0_userdata.0.S") },
        expr: code('get("s")'),
      }),
    ],
  });
  const { h, engine } = started(document("a"), { "0_userdata.0.S": 1 });
  h.change("0_userdata.0.S", 5);
  expect(engine.memoryValue("a")).toBe(5);
  engine.update(document("c"));
  expect(engine.memoryValue("a")).toBeUndefined();
  h.change("0_userdata.0.S", 6);
  expect(engine.memoryValue("c")).toBe(6);
  expect(engine.memoryValue("a")).toBeUndefined();
});

it("keeps, resets and removes document memory only when declared", () => {
  const document = (memory: LogicDocument["memory"]): LogicDocument => ({
    version: 3,
    memory,
    logics: [
      fn("a", {
        mode: "statements",
        inputs: { s: input("0_userdata.0.S") },
        expr: code('set("n", get("s")); return get("s");'),
      }),
      fn("b", { expr: code("1") }),
    ],
  });
  const { h, engine } = started(
    document([{ name: "n", type: "number", initial: 5 }]),
    { "0_userdata.0.S": 0 },
  );
  expect(engine.memoryValue("n")).toBe(5);
  h.change("0_userdata.0.S", 7);
  expect(engine.memoryValue("n")).toBe(7);
  engine.update(document([{ name: "n", type: "number", initial: 5 }]));
  expect(engine.memoryValue("n")).toBe(7);
  engine.update(document([{ name: "n", type: "number", initial: 9 }]));
  expect(engine.memoryValue("n")).toBe(9);
  engine.update(
    document([
      { name: "n", type: "number", initial: 9 },
      { name: "m", type: "number", initial: 2 },
    ]),
  );
  expect(engine.memoryValue("m")).toBe(2);
  engine.update(document([{ name: "n", type: "number", initial: 9 }]));
  expect(engine.memoryValue("m")).toBeUndefined();
});

it("sends $start only to the machines that started in this update", () => {
  const machine = (
    id: string,
    name: string,
  ): LogicDocument["logics"][number] => {
    const mark = `0_userdata.0.${id.toUpperCase()}MARK`;
    return {
      id,
      name,
      kind: "machine",
      init: { run: false },
      start: "Off",
      output: {
        scope: "state",
        ref: `0_userdata.0.${id.toUpperCase()}`,
        type: "string",
      },
      states: {
        Off: {
          on: [
            {
              on: "$start",
              mode: "function",
              do: code(`set("${mark}", (get("${mark}") ?? 0) + 1)`),
            },
          ],
        },
        On: {},
      },
    };
  };
  const document = (aName: string): LogicDocument => ({
    version: 3,
    logics: [machine("a", aName), machine("b", "B")],
  });
  const { h, engine } = started(document("A"));
  expect(h.writes.map((write) => write.value)).toEqual([1, 1]);
  h.writes.length = 0;
  engine.update(document("A renamed"));
  expect(h.writes).toEqual([
    { id: "0_userdata.0.AMARK", value: 2, ack: false },
  ]);
});

it("keeps the $self sync after an unrelated update", () => {
  const document = (bName: string): LogicDocument => ({
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { run: false },
        start: "Off",
        output: { scope: "state", ref: "0_userdata.0.M", type: "number" },
        states: { Off: {}, On: {} },
      },
      fn("b", { name: bName }),
    ],
  });
  const { h, engine } = started(document("B"), { "0_userdata.0.M": 0 });
  engine.update(document("B renamed"));
  h.writes.length = 0;
  h.change("0_userdata.0.M", 1);
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.M",
    value: 1,
    ack: false,
  });
});

it("does not restart a reader when its producer changes", () => {
  const document = (producerExpr: Expr): LogicDocument => ({
    version: 3,
    logics: [
      fn("p", {
        inputs: { e: input("0_userdata.0.E") },
        expr: producerExpr,
      }),
      fn("r", {
        mode: "statements",
        inputs: {
          r: {
            from: { type: "state", ref: "$logic.p" },
            kind: "variable",
          },
        },
        expr: code("this.n = (this.n ?? 0) + 1; return this.n;"),
      }),
    ],
  });
  const { h, engine } = started(document(code('get("e") * 10')), {
    "0_userdata.0.E": 0,
  });
  h.change("0_userdata.0.E", 1);
  expect(engine.memoryValue("r")).toBe(1);
  engine.update(document(code('get("e") * 10 + 1')));
  h.change("0_userdata.0.E", 2);
  expect(engine.memoryValue("r")).toBe(2);
});

it("does not replay an old output to a reader added later", () => {
  const producer = fn("p", {
    inputs: { e: input("0_userdata.0.E") },
    expr: code('get("e") * 10'),
  });
  const reader = fn("r", {
    inputs: {
      r: { from: { type: "state", ref: "$logic.p" }, kind: "variable" },
    },
    expr: code('get("r")'),
  });
  const { h, engine } = started(
    { version: 3, logics: [producer] },
    {
      "0_userdata.0.E": 1,
    },
  );
  h.change("0_userdata.0.E", 2);
  engine.update({ version: 3, logics: [producer, reader] });
  expect(engine.memoryValue("r")).toBeUndefined();
  h.change("0_userdata.0.E", 3);
  expect(engine.memoryValue("r")).toBe(30);
});

it("restarts only the logic whose variable mapping changed", () => {
  const document: LogicDocument = {
    version: 3,
    logics: [
      fn("a", {
        mode: "statements",
        inputs: { v: { from: { type: "state", ref: "blind" }, kind: "event" } },
        output: { scope: "state", ref: "0_userdata.0.A", type: "number" },
        expr: code('this.n = (this.n ?? 0) + 1; return get("v");'),
      }),
      fn("b", {
        mode: "statements",
        inputs: { o: input("0_userdata.0.O") },
        output: { scope: "state", ref: "0_userdata.0.B", type: "number" },
        expr: code("this.n = (this.n ?? 0) + 1; return this.n;"),
      }),
    ],
  };
  const h = createHarness({ "0_userdata.0.X": 1, "0_userdata.0.Y": 5 });
  let target = "0_userdata.0.X";
  h.deps.resolveVariable = (name) =>
    name === "blind" ? { kind: "state", stateId: target } : undefined;
  const engine = createEngine(document, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.X", 2);
  expect(h.writes.at(-1)?.value).toBe(2);
  target = "0_userdata.0.Y";
  engine.update(document);
  h.writes.length = 0;
  h.change("0_userdata.0.Y", 6);
  expect(h.writes).toEqual([{ id: "0_userdata.0.A", value: 6, ack: false }]);
});

it("restarts only the logic whose expanded pattern gained a state", () => {
  const document = (aRefs: string[]): LogicDocument => ({
    version: 3,
    logics: [
      fn("a", {
        mode: "statements",
        inputs: {
          p: {
            from: { type: "state", ref: aRefs[0], refs: aRefs.slice(1) },
            kind: "event",
          },
        },
        output: { scope: "state", ref: "0_userdata.0.A", type: "number" },
        expr: code("this.n = (this.n ?? 0) + 1; return this.n;"),
      }),
      fn("b", {
        mode: "statements",
        inputs: { o: input("0_userdata.0.O") },
        output: { scope: "state", ref: "0_userdata.0.B", type: "number" },
        expr: code("this.n = (this.n ?? 0) + 1; return this.n;"),
      }),
    ],
  });
  const { h, engine } = started(document(["0_userdata.0.OLD"]), {
    "0_userdata.0.OLD": 0,
    "0_userdata.0.O": 0,
  });
  h.change("0_userdata.0.OLD", 1);
  expect(h.writes.at(-1)?.value).toBe(1);
  engine.update(document(["0_userdata.0.OLD", "0_userdata.0.NEW"]));
  h.change("0_userdata.0.OLD", 2);
  expect(h.writes.at(-1)?.value).toBe(1);
});

it("subscription set matches the pure function", () => {
  const document: LogicDocument = {
    version: 3,
    memory: [{ name: "m", type: "number", initial: 0 }],
    logics: [
      fn("p", {
        inputs: { e: input("0_userdata.0.E") },
        expr: code('get("e")'),
      }),
      fn("r", {
        inputs: {
          l: { from: { type: "state", ref: "$logic.p" }, kind: "variable" },
          t: { from: { type: "timer", every: "1h" }, kind: "event" },
          m: { from: { type: "memory", ref: "m" }, kind: "event" },
        },
        output: { scope: "state", ref: "0_userdata.0.R", type: "number" },
        expr: code('get("0_userdata.0.CODE")'),
      }),
      {
        id: "m",
        name: "M",
        kind: "machine",
        start: "Idle",
        output: { scope: "memory" },
        states: {
          Idle: { on: [{ on: "$var.Alarm", goto: "Hit" }] },
          Hit: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 1 });
  const resolve = (name: string) =>
    name === "blind"
      ? { kind: "state" as const, stateId: "0_userdata.0.VAR" }
      : name === "Alarm"
        ? { kind: "state" as const, stateId: "0_userdata.0.FLAG" }
        : undefined;
  const engine = createEngine(document, {
    ...h.deps,
    resolveVariable: resolve,
  });
  expect(engine.subscriptions().sort()).toEqual(
    logicSubscriptions(document, resolve).sort(),
  );
});

it("keeps a memory reader linked when its producer changes", () => {
  const document = (pExpr: Expr, enabled = true): LogicDocument => ({
    version: 3,
    logics: [
      fn("p", {
        enabled,
        inputs: { e: input("0_userdata.0.E") },
        expr: pExpr,
      }),
      fn("r", {
        inputs: {
          m: { from: { type: "memory", ref: "p" }, kind: "event" },
        },
        expr: code('get("m") + 1'),
      }),
    ],
  });
  const { h, engine } = started(document(code('get("e") * 10')), {
    "0_userdata.0.E": 1,
  });
  h.change("0_userdata.0.E", 2);
  expect(engine.memoryValue("r")).toBe(21);
  engine.update(document(code('get("e") * 10 + 0')));
  h.change("0_userdata.0.E", 3);
  expect(engine.memoryValue("r")).toBe(31);
  engine.update(document(code('get("e") * 10 + 0'), false));
  engine.update(document(code('get("e") * 10 + 0'), true));
  h.change("0_userdata.0.E", 4);
  expect(engine.memoryValue("r")).toBe(41);
});

it("dispatches memory readers in document order", () => {
  const document = (order: string[]): LogicDocument => ({
    version: 3,
    logics: [
      fn("p", {
        inputs: { e: input("0_userdata.0.E") },
        expr: code('get("e")'),
      }),
      ...order.map((id) =>
        fn(id, {
          inputs: {
            m: { from: { type: "memory", ref: "p" }, kind: "event" },
          },
          output: {
            scope: "state",
            ref: `0_userdata.0.${id.toUpperCase()}`,
            type: "number",
          },
          expr: code('get("m")'),
        }),
      ),
    ],
  });
  const { h, engine } = started(document(["b", "c"]), {
    "0_userdata.0.E": 1,
  });
  h.change("0_userdata.0.E", 2);
  expect(h.writes.map((write) => write.id)).toEqual([
    "0_userdata.0.B",
    "0_userdata.0.C",
  ]);
  engine.update(document(["c", "b"]));
  h.writes.length = 0;
  h.change("0_userdata.0.E", 3);
  expect(h.writes.map((write) => write.id)).toEqual([
    "0_userdata.0.C",
    "0_userdata.0.B",
  ]);
});
