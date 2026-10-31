import { expect, it } from "vitest";
import { createEngine, type Engine } from "./engine";
import { createHarness } from "./testing";
import type { FunctionLogic, LogicDocument, MachineLogic } from "./types";

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

// ------------------------------------------------------------- state machines

const machine = (): LogicDocument => ({
  version: 1,
  logics: [
    {
      id: "light",
      name: "Light",
      kind: "machine",
      inputs: {
        motion: {
          from: { type: "state", ref: "0_userdata.0.M" },
          kind: "event",
        },
        lamp: { from: { type: "state", ref: "0_userdata.0.L" } },
      },
      output: { scope: "memory" },
      start: "Idle",
      states: {
        Idle: {
          on: [{ on: "motion", is: { op: "eq", value: true }, goto: "On" }],
        },
        On: {
          enter: [
            {
              set: {
                target: { ref: "lamp" },
                value: { const: true },
              },
            },
          ],
          exit: [
            {
              set: {
                target: { ref: "lamp" },
                value: { const: false },
              },
            },
          ],
          after: { time: "2m", goto: "Idle" },
          on: [{ on: "motion", is: { op: "eq", value: true }, goto: "On" }],
        },
      },
    },
  ],
});

it("enters the start state and runs enter actions", () => {
  const h = createHarness({ "0_userdata.0.M": false, "0_userdata.0.L": false });
  const engine = createEngine(machine(), h.deps);
  h.attach(engine);
  engine.start();
  expect(engine.memoryValue("light")).toBe("Idle");
  expect(h.writes).toEqual([]); // memory output: the start write stays internal
});

it("extends the delay on re-entry without running enter again", () => {
  const h = createHarness({ "0_userdata.0.M": false, "0_userdata.0.L": false });
  const d = machine();
  (d.logics[0] as MachineLogic).inputs!.motion.mode = "any";
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.M", true);
  expect(engine.memoryValue("light")).toBe("On");
  expect(h.writes).toEqual([{ id: "0_userdata.0.L", value: true, ack: false }]);
  h.clock.advance(90_000);
  h.change("0_userdata.0.M", true);
  expect(h.writes).toHaveLength(1); // enter did not run again
  h.clock.advance(90_000);
  expect(engine.memoryValue("light")).toBe("On");
  h.clock.advance(30_000);
  expect(engine.memoryValue("light")).toBe("Idle");
});

it("switches off after the state timer", () => {
  const h = createHarness({ "0_userdata.0.M": false, "0_userdata.0.L": false });
  const engine = createEngine(machine(), h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.M", true);
  h.clock.advance(119_000);
  expect(engine.memoryValue("light")).toBe("On");
  h.clock.advance(1_000);
  expect(engine.memoryValue("light")).toBe("Idle");
  expect(h.writes.at(-1)).toEqual({
    id: "0_userdata.0.L",
    value: false,
    ack: false,
  });
});

it("maps a boolean output by the On prefix, and a map overrides it", () => {
  const run = (map?: Record<string, boolean>) => {
    const h = createHarness({ "0_userdata.0.M": false });
    const d = machine();
    const logic = d.logics[0] as MachineLogic;
    logic.output = {
      scope: "state",
      ref: "0_userdata.0.B",
      type: "boolean",
      map,
    };
    delete logic.states.On.enter; // the mapped output must be the last write
    delete logic.states.On.exit;
    const engine = createEngine(d, h.deps);
    h.attach(engine);
    engine.start();
    h.change("0_userdata.0.M", true);
    const on = h.writes.at(-1);
    h.clock.advance(120_000);
    return { on, off: h.writes.at(-1) };
  };
  expect(run()).toEqual({
    on: { id: "0_userdata.0.B", value: true, ack: true },
    off: { id: "0_userdata.0.B", value: false, ack: true },
  });
  expect(run({ On: false, Idle: true })).toEqual({
    on: { id: "0_userdata.0.B", value: false, ack: true },
    off: { id: "0_userdata.0.B", value: true, ack: true },
  });
});

it("does not repeat an unchanged set action by default", () => {
  const doc: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "twice",
        name: "Twice",
        kind: "machine",
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        start: "A",
        states: {
          A: {
            on: [{ on: "e", goto: "B" }],
            enter: [
              {
                set: {
                  target: { ref: "0_userdata.0.D" },
                  value: { const: true },
                },
              },
            ],
          },
          B: {
            enter: [
              {
                set: {
                  target: { ref: "0_userdata.0.D" },
                  value: { const: true },
                },
              },
            ],
          },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0, "0_userdata.0.D": false });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start(); // A enter writes D=true once
  expect(h.writes).toHaveLength(1);
  h.change("0_userdata.0.E", 1); // B enter sets the same value → no write
  expect(h.writes).toHaveLength(1);
});

it("fires timer inputs every interval and stops with the engine", () => {
  const timed: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "tick",
        name: "Tick",
        kind: "function",
        inputs: {
          t: { from: { type: "timer", every: "60s" }, kind: "event" },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.TICK",
          type: "number",
          forward: "always",
        },
        expr: { ref: "t" },
      },
    ],
  };
  const h = createHarness({});
  const engine = createEngine(timed, h.deps);
  h.attach(engine);
  engine.start();
  const base = h.writes.length; // the start evaluation writes once
  h.clock.advance(60_000);
  expect(h.writes).toHaveLength(base + 1);
  h.clock.advance(60_000);
  expect(h.writes).toHaveLength(base + 2);
  engine.stop();
  h.clock.advance(180_000);
  expect(h.writes).toHaveLength(base + 2);
});

it("does not emit a memory event when the value matches the seeded one", () => {
  const seeded: LogicDocument = {
    version: 1,
    memory: [{ name: "x", type: "number", initial: 5 }],
    logics: [
      {
        id: "keep",
        name: "Keep",
        kind: "function",
        inputs: {
          s: { from: { type: "state", ref: "0_userdata.0.S" }, kind: "event" },
        },
        output: { scope: "memory", name: "x" },
        expr: { const: 5 },
      },
      {
        id: "watch",
        name: "Watch",
        kind: "function",
        inputs: { x: { from: { type: "memory", ref: "x" }, kind: "event" } },
        output: {
          scope: "state",
          ref: "0_userdata.0.WATCH",
          type: "number",
          forward: "always",
        },
        expr: { ref: "x" },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.S": 0 });
  const engine = createEngine(seeded, h.deps);
  h.attach(engine);
  engine.start();
  // The watcher runs once at start (5). An event for the unchanged seeded
  // value would run it again and write the same 5 a second time.
  expect(h.writes).toEqual([{ id: "0_userdata.0.WATCH", value: 5, ack: true }]);
});

it("skips an invalid logic instead of throwing out of start", () => {
  const broken = {
    version: 1,
    logics: [
      {
        id: "broken",
        name: "Broken",
        kind: "function",
        expr: { const: 1 },
        output: { scope: "state" },
      },
    ],
  } as never;
  const h = createHarness({});
  const engine = createEngine(broken, h.deps);
  h.attach(engine);
  expect(() => engine.start()).not.toThrow();
  expect(h.logs.some((line) => line.logicId === "broken")).toBe(true);
});
