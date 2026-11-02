import { expect, it } from "vitest";
import { createEngine, type Engine } from "./engine";
import { createHarness } from "./testing";
import type {
  FunctionLogic,
  LogicDocument,
  MachineLogic,
  Output,
} from "./types";

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
    { id: "0_userdata.0.OUT", value: 8, ack: false },
  ]);
  h.change("0_userdata.0.T", 4);
  expect(h.writes).toHaveLength(base + 1);
});

it("writes a logic output to the adapter-created state", () => {
  const d = doc({ output: { scope: "logic", type: "number" } });
  const { h, engine } = engineWith(d);
  engine.start();
  const write = h.writes.find(
    (w) => w.id === "system.adapter.ihome.0.Logic.calc",
  );
  expect(write?.value).toBe(6);
  expect(write?.ack).toBe(false);
});

it("maps a machine's state names to a boolean logic output", () => {
  const machine: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "lift",
        name: "Lift",
        kind: "machine",
        init: { state: "Off" },
        output: { scope: "logic", type: "boolean" },
        states: { Off: {}, On: {} },
      },
    ],
  };
  const h = createHarness({});
  const engine = createEngine(machine, h.deps, {
    ownFrom: "system.adapter.ihome.0",
  });
  h.attach(engine);
  engine.start();
  const off = h.writes.find(
    (w) => w.id === "system.adapter.ihome.0.Logic.lift",
  );
  expect(off?.value).toBe(false);
});

const follower = (extra: Partial<MachineLogic> = {}): LogicDocument => ({
  version: 1,
  logics: [
    {
      id: "follow",
      name: "Follow",
      kind: "machine",
      log: true,
      init: { state: "Off" },
      output: { scope: "state", ref: "0_userdata.0.OUT", type: "boolean" },
      states: { Off: {}, On: {} },
      ...extra,
    },
  ],
});

it("follows an external write to its own output", () => {
  const h = createHarness({ "0_userdata.0.OUT": false });
  const engine = createEngine(follower(), h.deps);
  h.attach(engine);
  engine.start();
  h.logs.length = 0;
  h.change("0_userdata.0.OUT", true, { from: "hue.0" });
  expect(
    h.logs.some((line) =>
      line.message.includes(
        "moves from “Off” to “On” because of output changed elsewhere",
      ),
    ),
  ).toBe(true);
});

it("an explicit $self row picks between states with the same value", () => {
  const h = createHarness({ "0_userdata.0.OUT": false });
  const engine = createEngine(
    follower({
      states: {
        Off: {
          on: [
            {
              on: "$self",
              is: { op: "eq", value: true },
              goto: "OnMotion",
            },
          ],
        },
        On: {},
        OnMotion: {},
      },
    }),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  h.logs.length = 0;
  h.change("0_userdata.0.OUT", true, { from: "hue.0" });
  expect(h.logs.some((line) => line.message.includes("to “OnMotion”"))).toBe(
    true,
  );
});

it("stays put when the external write already matches its state", () => {
  const h = createHarness({ "0_userdata.0.OUT": false });
  const engine = createEngine(follower(), h.deps);
  h.attach(engine);
  engine.start();
  h.logs.length = 0;
  h.change("0_userdata.0.OUT", false, { from: "hue.0" });
  expect(
    h.logs.some((line) => line.message.includes("output changed elsewhere")),
  ).toBe(false);
});

const textMachine = (is: { op: string; value?: unknown }): LogicDocument => ({
  version: 1,
  logics: [
    {
      id: "text",
      name: "Text",
      kind: "machine",
      init: { state: "Idle" },
      inputs: {
        v: { from: { type: "state", ref: "0_userdata.0.S" }, kind: "event" },
      },
      states: {
        Idle: { on: [{ on: "v", is: is as never, goto: "On" }] },
        On: {},
      },
    },
  ],
});

it("compares string conditions as glob patterns", () => {
  const h = createHarness({ "0_userdata.0.S": "" });
  const engine = createEngine(
    textMachine({ op: "includes", value: "*Motion*" }),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.S", "KitchenLightOn");
  expect(engine.memoryValue("text")).toBe("Idle");
  h.change("0_userdata.0.S", "KitchenMotionOn");
  expect(engine.memoryValue("text")).toBe("On");
});

it("fills {{ref}} in a log message", () => {
  const h = createHarness({ "0_userdata.0.S": "" });
  const engine = createEngine(
    {
      version: 1,
      logics: [
        {
          id: "logger",
          name: "Logger",
          kind: "machine",
          init: { state: "A" },
          inputs: {
            v: {
              from: { type: "state", ref: "0_userdata.0.S" },
              kind: "event",
            },
          },
          states: {
            A: {
              on: [
                {
                  on: "v",
                  do: [
                    {
                      log: {
                        text: "saw {{v}} from {{$from}} (self {{$self}})",
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    },
    h.deps,
  );
  h.attach(engine);
  engine.start();
  h.logs.length = 0;
  h.change("0_userdata.0.S", "On", { from: "hue.0" });
  expect(h.logs.map((line) => line.message)).toEqual([
    "saw On from hue.0 (self false)",
  ]);
  // A machine logs as `<logic id>.<state>` (D25).
  expect(h.logs[0].logicId).toBe("logger.A");
});

it("compares a numeric string numerically", () => {
  const h = createHarness({ "0_userdata.0.S": "" });
  const engine = createEngine(textMachine({ op: "gt", value: "10" }), h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.S", "hot");
  expect(engine.memoryValue("text")).toBe("Idle");
  h.change("0_userdata.0.S", "9");
  expect(engine.memoryValue("text")).toBe("Idle");
  h.change("0_userdata.0.S", "12.5");
  expect(engine.memoryValue("text")).toBe("On");
});

it("treats a string condition's = as a glob", () => {
  const h = createHarness({ "0_userdata.0.S": "" });
  const engine = createEngine(textMachine({ op: "eq", value: "On*" }), h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.S", "Off");
  expect(engine.memoryValue("text")).toBe("Idle");
  h.change("0_userdata.0.S", "OnMotion");
  expect(engine.memoryValue("text")).toBe("On");
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

it("ignores its own output echo by default", () => {
  const echo: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "echo",
        name: "Echo",
        kind: "function",
        inputs: {
          v: { from: { type: "state", ref: "0_userdata.0.V" }, kind: "event" },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.V",
          type: "number",
          forward: "always",
        },
        expr: { const: 1 },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.V": 0 });
  const engine = createEngine(echo, h.deps, { ownFrom: "ihome.0" });
  h.attach(engine);
  engine.start();
  const base = h.writes.length;
  h.change("0_userdata.0.V", 1, { from: "ihome.0" }); // the echo of start's write
  expect(h.writes).toHaveLength(base);
  h.change("0_userdata.0.V", 2, { from: "hue.0" }); // a real external change
  expect(h.writes).toHaveLength(base + 1);
});

it("lets another logic's write be an external event", () => {
  const doc: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "writer",
        name: "Writer",
        kind: "function",
        inputs: {
          x: { from: { type: "state", ref: "0_userdata.0.X" }, kind: "event" },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.OUT",
          type: "number",
          forward: "always",
        },
        expr: { const: 1 },
      },
      {
        id: "reader",
        name: "Reader",
        kind: "function",
        inputs: {
          o: {
            from: { type: "state", ref: "0_userdata.0.OUT" },
            kind: "event",
          },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.DONE",
          type: "number",
          forward: "always",
        },
        expr: { const: 1 },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.X": 0, "0_userdata.0.OUT": 0 });
  const engine = createEngine(doc, h.deps, { ownFrom: "ihome.0" });
  h.attach(engine);
  engine.start();
  h.writes.length = 0;
  h.change("0_userdata.0.OUT", 1, { from: "ihome.0" }); // the writer's output
  expect(h.writes.filter((w) => w.id === "0_userdata.0.DONE")).toHaveLength(1);
});

it("source self sees only this logic's writes", () => {
  const self: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "self",
        name: "Self",
        kind: "machine",
        inputs: {
          v: {
            from: { type: "state", ref: "0_userdata.0.W" },
            kind: "event",
            source: "self",
          },
        },
        output: { scope: "memory" },
        start: "A",
        states: {
          A: {
            enter: [
              {
                set: {
                  target: { ref: "0_userdata.0.W" },
                  value: { const: true },
                },
              },
            ],
            on: [{ on: "v", if: { ref: "$self" }, goto: "B" }],
          },
          B: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.W": false });
  const engine = createEngine(self, h.deps, { ownFrom: "ihome.0" });
  h.attach(engine);
  engine.start(); // A's enter writes W=true
  h.change("0_userdata.0.W", false, { from: "hh.0" }); // external: ignored
  expect(engine.memoryValue("self")).toBe("A");
  h.change("0_userdata.0.W", true, { from: "ihome.0" }); // own write
  expect(engine.memoryValue("self")).toBe("B");
});

it("exposes $from and $self to rows", () => {
  const doc: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "meta",
        name: "Meta",
        kind: "machine",
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        start: "A",
        states: {
          A: {
            on: [
              {
                on: "e",
                if: {
                  op: "eq",
                  left: { ref: "$from" },
                  right: { const: "hue.0" },
                },
                goto: "B",
              },
            ],
          },
          B: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0 });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.E", 1, { from: "hue.0" });
  expect(engine.memoryValue("meta")).toBe("B");
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
  expect(h.writes).toEqual([{ id: "0_userdata.0.OUT", value: 6, ack: false }]);
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
        inputs: {
          x: {
            from: { type: "memory", ref: "x" },
            kind: "event",
            source: "any",
          },
        },
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
    on: { id: "0_userdata.0.B", value: true, ack: false },
    off: { id: "0_userdata.0.B", value: false, ack: false },
  });
  expect(run({ On: false, Idle: true })).toEqual({
    on: { id: "0_userdata.0.B", value: false, ack: false },
    off: { id: "0_userdata.0.B", value: true, ack: false },
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
  expect(h.writes).toEqual([
    { id: "0_userdata.0.WATCH", value: 5, ack: false },
  ]);
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

// ------------------------------------------------------------ startup policy

function startup(output: Output, init?: MachineLogic["init"]): LogicDocument {
  return {
    version: 1,
    logics: [
      {
        id: "start",
        name: "Start",
        kind: "machine",
        inputs: {
          power: {
            from: { type: "state", ref: "0_userdata.0.P" },
            kind: "event",
          },
        },
        output,
        init,
        start: "Idle",
        states: {
          Idle: {
            on: [{ on: "power", is: { op: "eq", value: true }, goto: "On" }],
          },
          On: {},
        },
      },
    ],
  };
}

it("starts in the constant init state", () => {
  const h = createHarness({ "0_userdata.0.P": false });
  const engine = createEngine(
    startup({ scope: "memory" }, { state: "On" }),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  expect(engine.memoryValue("start")).toBe("On");
});

it("starts in the state an init expression answers", () => {
  const h = createHarness({ "0_userdata.0.P": true });
  const engine = createEngine(
    startup(
      { scope: "memory" },
      {
        state: {
          op: "if",
          cond: { ref: "power" },
          then: { const: "On" },
          else: { const: "Idle" },
        },
      },
    ),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  expect(engine.memoryValue("start")).toBe("On");
});

it("matches the state to the current output value, first declaration wins", () => {
  const h = createHarness({ "0_userdata.0.B": true });
  const doc = startup(
    {
      scope: "state",
      ref: "0_userdata.0.B",
      type: "boolean",
      map: { Idle: false, On: true },
    },
    { match: "output" },
  );
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.writes).toEqual([{ id: "0_userdata.0.B", value: true, ack: false }]);

  const h2 = createHarness({ "0_userdata.0.B": false });
  const engine2 = createEngine(doc, h2.deps);
  h2.attach(engine2);
  engine2.start();
  expect(h2.writes).toEqual([
    { id: "0_userdata.0.B", value: false, ack: false },
  ]); // the start write resyncs the state
});

it("falls back when the output value matches no state", () => {
  const h = createHarness({ "0_userdata.0.B": 99 });
  const doc = startup(
    {
      scope: "state",
      ref: "0_userdata.0.B",
      type: "number",
      map: { Idle: 0, On: 1 },
    },
    { match: "output", state: "On" },
  );
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.writes).toEqual([{ id: "0_userdata.0.B", value: 1, ack: false }]);
});

it("exposes $init only during the start evaluation", () => {
  const h = createHarness({
    "0_userdata.0.P": false,
    "0_userdata.0.FLAG": false,
  });
  const doc = startup({ scope: "memory" }, { run: true });
  const logic = doc.logics[0] as MachineLogic;
  logic.states.Idle.enter = [
    {
      set: {
        target: { ref: "0_userdata.0.FLAG" },
        value: { ref: "$init" },
        forward: "always",
      },
    },
  ];
  logic.states.Idle.on = [{ on: "$init", goto: "On" }];
  logic.states.On.on = [{ on: "power", goto: "Idle" }];
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.writes).toEqual([
    { id: "0_userdata.0.FLAG", value: true, ack: false },
  ]);
  h.change("0_userdata.0.P", true);
  expect(h.writes.at(-1)).toEqual({
    id: "0_userdata.0.FLAG",
    value: false,
    ack: false,
  });
});

it("runs a function once at start unless init.run is false", () => {
  const fn = (run?: boolean): LogicDocument => ({
    version: 1,
    logics: [
      {
        id: "calc",
        name: "Calc",
        kind: "function",
        inputs: {
          p: { from: { type: "state", ref: "0_userdata.0.P" }, kind: "event" },
        },
        output: { scope: "state", ref: "0_userdata.0.OUT", type: "number" },
        init: run === undefined ? undefined : { run },
        expr: { ref: "$init" },
      },
    ],
  });
  const h = createHarness({ "0_userdata.0.P": false });
  const engine = createEngine(fn(), h.deps);
  h.attach(engine);
  engine.start();
  expect(h.writes).toEqual([{ id: "0_userdata.0.OUT", value: 1, ack: false }]);

  const h2 = createHarness({ "0_userdata.0.P": false });
  const engine2 = createEngine(fn(false), h2.deps);
  h2.attach(engine2);
  engine2.start();
  expect(h2.writes).toEqual([]);
});

it("starts machines after functions, so computed memory is visible", () => {
  const doc: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "machine-first",
        name: "Machine first",
        kind: "machine",
        inputs: {
          m: { from: { type: "memory", ref: "computed" }, kind: "variable" },
        },
        output: { scope: "memory" },
        init: { state: { ref: "m" } },
        states: { Idle: {}, On: {} },
      },
      {
        id: "function-second",
        name: "Function second",
        kind: "function",
        inputs: {
          p: { from: { type: "state", ref: "0_userdata.0.P" }, kind: "event" },
        },
        output: { scope: "memory", name: "computed" },
        expr: { const: "On" },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.P": true });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  expect(engine.memoryValue("machine-first")).toBe("On");
});

it("creates the state timer on enter and destroys it on exit", () => {
  const h = createHarness({ "0_userdata.0.M": false, "0_userdata.0.L": false });
  const d = machine();
  const logic = d.logics[0] as MachineLogic;
  logic.states.On.on = [
    { on: "motion", is: { op: "eq", value: true }, goto: "On" },
    { on: "motion", is: { op: "eq", value: false }, goto: "Idle" },
  ];
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.clock.pending).toBe(0); // Idle has no after timer
  h.change("0_userdata.0.M", true);
  expect(h.clock.pending).toBe(1); // On armed its after timer
  h.change("0_userdata.0.M", false);
  expect(engine.memoryValue("light")).toBe("Idle");
  expect(h.clock.pending).toBe(0); // leaving On destroyed it
  h.clock.advance(300_000);
  expect(engine.memoryValue("light")).toBe("Idle"); // nothing fired late
});

it("stop destroys a pending state timer", () => {
  const h = createHarness({ "0_userdata.0.M": false, "0_userdata.0.L": false });
  const engine = createEngine(machine(), h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.M", true);
  expect(h.clock.pending).toBe(1);
  engine.stop();
  expect(h.clock.pending).toBe(0);
  h.clock.advance(300_000);
  expect(engine.memoryValue("light")).toBe("On"); // stopped machine does not transition
});

it("writes the state index for a number output", () => {
  const doc: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "dim",
        name: "Dim",
        kind: "machine",
        inputs: {
          p: { from: { type: "state", ref: "0_userdata.0.P" }, kind: "event" },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.LEVEL",
          type: "number",
          forward: "always",
        },
        start: "Dim",
        states: { Idle: {}, Dim: {}, On: {} },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.P": false });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.writes.at(-1)).toEqual({
    id: "0_userdata.0.LEVEL",
    value: 1,
    ack: false,
  });
});

it("one input can listen to several states as the same event", () => {
  const doc: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "buttons",
        name: "Buttons",
        kind: "function",
        inputs: {
          b: {
            from: {
              type: "state",
              ref: "0_userdata.0.B1",
              refs: ["0_userdata.0.B2"],
            },
            kind: "event",
          },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.OUT",
          type: "number",
          forward: "always",
        },
        expr: { ref: "b" },
      },
    ],
  };
  const h = createHarness({
    "0_userdata.0.B1": false,
    "0_userdata.0.B2": false,
  });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  expect(engine.subscriptions().sort()).toEqual([
    "0_userdata.0.B1",
    "0_userdata.0.B2",
    "0_userdata.0.OUT",
  ]);
  engine.start();
  h.writes.length = 0;
  h.change("0_userdata.0.B2", true);
  expect(h.writes.at(-1)?.value).toBe(1);
  h.change("0_userdata.0.B1", true); // the other button, same value
  expect(h.writes.at(-1)?.value).toBe(1);
  expect(h.writes).toHaveLength(2);
});

it("applies the row edge instead of an input filter", () => {
  const doc: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "edge",
        name: "Edge",
        kind: "machine",
        inputs: {
          b: { from: { type: "state", ref: "0_userdata.0.B" }, kind: "event" },
        },
        output: { scope: "memory" },
        start: "A",
        states: {
          A: { on: [{ on: "b", edge: "rising", goto: "B" }] },
          B: { on: [{ on: "b", edge: "falling", goto: "A" }] },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.B": false });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.B", true);
  expect(engine.memoryValue("edge")).toBe("B");
  h.change("0_userdata.0.B", true); // not falling
  expect(engine.memoryValue("edge")).toBe("B");
  h.change("0_userdata.0.B", false);
  expect(engine.memoryValue("edge")).toBe("A");
});

it("logs state changes only when the logic enables it", () => {
  const loud = machine();
  (loud.logics[0] as MachineLogic).log = true;
  const h = createHarness({ "0_userdata.0.M": false, "0_userdata.0.L": false });
  const engine = createEngine(loud, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.logs.some((line) => line.message.includes("starts in “Idle”"))).toBe(
    true,
  );
  h.change("0_userdata.0.M", true);
  expect(
    h.logs.some((line) =>
      line.message.includes(
        "moves from “Idle” to “On” because of event “motion”",
      ),
    ),
  ).toBe(true);

  const quiet = machine();
  const h2 = createHarness({
    "0_userdata.0.M": false,
    "0_userdata.0.L": false,
  });
  const engine2 = createEngine(quiet, h2.deps);
  h2.attach(engine2);
  engine2.start();
  h2.change("0_userdata.0.M", true);
  expect(h2.logs).toEqual([]);
});

it("resolves a global variable name used as the output ref", () => {
  const doc: LogicDocument = {
    version: 1,
    logics: [
      {
        id: "outvar",
        name: "Out var",
        kind: "function",
        inputs: {
          p: { from: { type: "state", ref: "0_userdata.0.P" }, kind: "event" },
        },
        output: { scope: "state", ref: "TestState_Switch", type: "number" },
        expr: { const: 1 },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.P": false });
  const engine = createEngine(doc, {
    ...h.deps,
    resolveVariable: (name: string) =>
      name === "TestState_Switch"
        ? {
            kind: "state" as const,
            stateId: "ihome.0.Variables.TestState_Switch",
          }
        : undefined,
  });
  h.attach(engine);
  engine.start();
  expect(engine.subscriptions()).toContain(
    "ihome.0.Variables.TestState_Switch",
  );
  expect(h.writes[0]).toEqual({
    id: "ihome.0.Variables.TestState_Switch",
    value: 1,
    ack: false,
  });
});

const chain = (over: Partial<MachineLogic> = {}): LogicDocument => ({
  version: 1,
  logics: [
    {
      id: "chain",
      name: "Chain",
      kind: "machine",
      inputs: {
        value: {
          from: { type: "state", ref: "0_userdata.0.V" },
          kind: "event",
        },
        low: { from: { type: "state", ref: "0_userdata.0.LOW" } },
        high: { from: { type: "state", ref: "0_userdata.0.HIGH" } },
      },
      output: { scope: "memory" },
      start: "Idle",
      states: {
        Idle: {
          on: [
            {
              on: "value",
              is: { op: "gt", value: 10 },
              do: [{ set: { target: { ref: "low" }, value: { const: true } } }],
              continue: true,
            },
            {
              on: "value",
              is: { op: "gt", value: 20 },
              do: [
                { set: { target: { ref: "high" }, value: { const: true } } },
              ],
            },
          ],
        },
      },
      ...over,
    },
  ],
});

it("a continue row lets later rows react to the same event", () => {
  const h = createHarness({
    "0_userdata.0.V": 0,
    "0_userdata.0.LOW": false,
    "0_userdata.0.HIGH": false,
  });
  const engine = createEngine(chain(), h.deps);
  h.attach(engine);
  engine.start();
  h.writes.length = 0;

  h.change("0_userdata.0.V", 25);
  expect(h.writes).toEqual([
    { id: "0_userdata.0.LOW", value: true, ack: false },
    { id: "0_userdata.0.HIGH", value: true, ack: false },
  ]);

  // Only the first threshold is crossed: the second row does not run.
  h.writes.length = 0;
  h.change("0_userdata.0.V", 15);
  expect(h.writes.some((w) => w.id === "0_userdata.0.HIGH")).toBe(false);
});

it("without continue the first matching row ends the event", () => {
  const d = chain();
  delete (d.logics[0] as MachineLogic).states.Idle.on![0].continue;
  const h = createHarness({
    "0_userdata.0.V": 0,
    "0_userdata.0.LOW": false,
    "0_userdata.0.HIGH": false,
  });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.writes.length = 0;
  h.change("0_userdata.0.V", 25);
  expect(h.writes).toEqual([
    { id: "0_userdata.0.LOW", value: true, ack: false },
  ]);
});

it("a goto ends the event even on a continue row", () => {
  const d = chain();
  (d.logics[0] as MachineLogic).states.Idle.on![0].goto = "Done";
  (d.logics[0] as MachineLogic).states.Done = {};
  const h = createHarness({
    "0_userdata.0.V": 0,
    "0_userdata.0.LOW": false,
    "0_userdata.0.HIGH": false,
  });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.writes.length = 0;
  h.change("0_userdata.0.V", 25);
  expect(h.writes).toEqual([
    { id: "0_userdata.0.LOW", value: true, ack: false },
  ]);
  expect(engine.memoryValue("chain")).toBe("Done");
});
