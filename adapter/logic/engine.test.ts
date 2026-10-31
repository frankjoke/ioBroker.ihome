import { expect, it } from "vitest";
import { createEngine, type Engine } from "./engine";
import { createHarness } from "./testing";
import type { FunctionLogic, LogicDocument } from "./types";

const doc = (extra: Partial<FunctionLogic> = {}): LogicDocument => ({
  version: 1,
  logics: [
    {
      id: "calc",
      name: "Calc",
      kind: "function",
      inputs: {
        temp: {
          from: { type: "state", ref: "0_userdata.0.T" },
          kind: "event",
        },
      },
      output: { scope: "state", ref: "0_userdata.0.OUT", type: "number" },
      expr: { op: "mul", left: { ref: "temp" }, right: { const: 2 } },
      ...extra,
    },
  ],
});

function engineWith(document: LogicDocument) {
  const h = createHarness({ "0_userdata.0.T": 3 });
  const engine: Engine = createEngine(document, h.deps, {
    ownFrom: "system.adapter.ihome.0",
  });
  h.attach(engine);
  return { h, engine };
}

it("runs on change only by default and writes only on change", () => {
  const { h, engine } = engineWith(doc());
  engine.start();
  const base = h.writes.length; // the start evaluation wrote once
  h.change("0_userdata.0.T", 4);
  expect(h.writes.slice(base)).toEqual([
    { id: "0_userdata.0.OUT", value: 8, ack: true },
  ]);
  h.change("0_userdata.0.T", 4);
  expect(h.writes).toHaveLength(base + 1);
});

it("honours mode any and forward always", () => {
  const d = doc({
    output: {
      scope: "state",
      ref: "0_userdata.0.OUT",
      type: "number",
      forward: "always",
    },
  });
  if (d.logics[0].kind === "function") d.logics[0].inputs!.temp.mode = "any";
  const { h, engine } = engineWith(d);
  engine.start();
  const base = h.writes.length;
  h.change("0_userdata.0.T", 4);
  h.change("0_userdata.0.T", 4);
  expect(h.writes).toHaveLength(base + 2);
});

it("honours the ack filter", () => {
  const d = doc();
  if (d.logics[0].kind === "function") d.logics[0].inputs!.temp.ack = "false";
  const { h, engine } = engineWith(d);
  engine.start();
  const base = h.writes.length;
  h.change("0_userdata.0.T", 2, { ack: true });
  expect(h.writes).toHaveLength(base);
  h.change("0_userdata.0.T", 5, { ack: false });
  expect(h.writes).toHaveLength(base + 1);
});

it("ignores its own writes", () => {
  const { h, engine } = engineWith(doc());
  engine.start();
  const base = h.writes.length;
  h.change("0_userdata.0.T", 2, { from: "system.adapter.ihome.0" });
  expect(h.writes).toHaveLength(base);
});

it("noop writes nothing", () => {
  const { h, engine } = engineWith(doc({ expr: { noop: true } }));
  engine.start();
  h.change("0_userdata.0.T", 6);
  expect(h.writes).toHaveLength(0);
});

it("writes a function result once at start", () => {
  const { h, engine } = engineWith(doc());
  engine.start();
  expect(h.writes).toEqual([{ id: "0_userdata.0.OUT", value: 6, ack: true }]);
});

const memoryDoc = (forward: "changed" | "always"): LogicDocument => ({
  version: 1,
  logics: [
    {
      id: "a",
      name: "A",
      kind: "function",
      inputs: {
        x: {
          from: { type: "state", ref: "0_userdata.0.X" },
          kind: "event",
          mode: "any",
        },
      },
      output: { scope: "memory", name: "x", forward },
      expr: { op: "add", left: { ref: "x" }, right: { const: 1 } },
    },
    {
      id: "b",
      name: "B",
      kind: "function",
      inputs: {
        mx: { from: { type: "memory", ref: "x" }, kind: "event" },
      },
      output: {
        scope: "state",
        ref: "0_userdata.0.OUT_B",
        type: "number",
        forward: "always",
      },
      expr: { op: "add", left: { ref: "mx" }, right: { const: 10 } },
    },
  ],
});

it("forwards memory events only when the value changes", () => {
  const h = createHarness({ "0_userdata.0.X": 4 });
  const engine = createEngine(memoryDoc("changed"), h.deps);
  h.attach(engine);
  engine.start();
  const base = h.writes.length;
  h.change("0_userdata.0.X", 5);
  expect(h.writes).toHaveLength(base + 1);
  h.change("0_userdata.0.X", 5); // same value, a's output unchanged
  expect(h.writes).toHaveLength(base + 1);
});

it("repeats a memory event when forward is always", () => {
  const h = createHarness({ "0_userdata.0.X": 4 });
  const engine = createEngine(memoryDoc("always"), h.deps);
  h.attach(engine);
  engine.start();
  const base = h.writes.length;
  h.change("0_userdata.0.X", 5);
  h.change("0_userdata.0.X", 5);
  expect(h.writes).toHaveLength(base + 2);
});

it("stops a memory loop with one warning", () => {
  const looping: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "seed",
        name: "Seed",
        kind: "function",
        inputs: {
          s: {
            from: { type: "state", ref: "0_userdata.0.SEED" },
            kind: "event",
          },
        },
        output: { scope: "memory", name: "x", forward: "always" },
        expr: { const: 1 },
      },
      {
        id: "echo",
        name: "Echo",
        kind: "function",
        inputs: { x: { from: { type: "memory", ref: "x" }, kind: "event" } },
        output: { scope: "memory", name: "x", forward: "always" },
        expr: { const: 1 },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.SEED": 0 });
  const engine = createEngine(looping, h.deps);
  h.attach(engine);
  engine.start();
  h.logs.length = 0; // measure one cascade, not the start evaluations
  h.change("0_userdata.0.SEED", 1);
  expect(engine.memoryValue("x")).toBe(1);
  expect(h.logs.filter((line) => line.message.includes("loop")).length).toBe(1);
});
