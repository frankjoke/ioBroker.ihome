import { expect, it } from "vitest";
import { buildDeviceLogic } from "./device-templates";
import { createEngine, type Engine } from "./engine";
import { createHarness } from "./testing";
import { parseLogicDocument } from "./validate";
import type {
  Expr,
  FunctionLogic,
  LogicDocument,
  MachineLogic,
  OnRow,
  Output,
} from "./types";

const code = (source: string): Expr => ({ code: source });

const flush = (): Promise<void> =>
  new Promise((resolve) => setImmediate(resolve));

const doc = (extra: Partial<FunctionLogic> = {}): LogicDocument => ({
  version: 3,
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
      expr: code('get("temp") * 2'),
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

it("subscribes and reads refs in a bare object expression", () => {
  const { h, engine } = engineWith(
    doc({
      expr: code('{"value": get("0_userdata.0.SENSOR")}.value'),
    }),
  );
  expect(engine.subscriptions()).toContain("0_userdata.0.SENSOR");
  h.change("0_userdata.0.SENSOR", 42);
  engine.start();
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: 42,
    ack: false,
  });
});

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
    version: 3,
    logics: [
      {
        id: "lift",
        name: "Lift",
        kind: "machine",
        init: { state: "Off" },
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "logic", type: "boolean" },
        states: { Off: { on: [{ on: "e", goto: "On" }] }, On: {} },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0 });
  const engine = createEngine(machine, h.deps, {
    ownFrom: "system.adapter.ihome.0",
  });
  h.attach(engine);
  engine.start();
  // Silent adoption writes nothing; the mapping shows on the transition.
  expect(h.writes).toEqual([]);
  h.change("0_userdata.0.E", 1);
  const on = h.writes.find((w) => w.id === "system.adapter.ihome.0.Logic.lift");
  expect(on?.value).toBe(true);
});

const follower = (extra: Partial<MachineLogic> = {}): LogicDocument => ({
  version: 3,
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
        "moves from “Off” to “On” because of output changed by hue.0",
      ),
    ),
  ).toBe(true);
  expect(
    h.logs.some((line) =>
      line.message.includes(
        "writes “true” to “0_userdata.0.OUT” because of output changed by hue.0",
      ),
    ),
  ).toBe(true);
});

it("names the event writer on a row transition and its write", () => {
  const h = createHarness({
    "0_userdata.0.OUT": false,
    "0_userdata.0.E": false,
  });
  const engine = createEngine(
    follower({
      inputs: {
        e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
      },
      states: {
        Off: { on: [{ on: "e", goto: "On" }] },
        On: {},
      },
    }),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  h.logs.length = 0;

  h.change("0_userdata.0.E", true, { from: "hue.0" });
  expect(
    h.logs.some((line) =>
      line.message.includes(
        "moves from “Off” to “On” because of event “e” from hue.0",
      ),
    ),
  ).toBe(true);
  expect(
    h.logs.some((line) =>
      line.message.includes(
        "writes “true” to “0_userdata.0.OUT” because of event “e” from hue.0",
      ),
    ),
  ).toBe(true);
});

it("names the event writer when a function writes its output", () => {
  const { h, engine } = engineWith(doc({ log: true }));
  engine.start();
  h.logs.length = 0;

  h.change("0_userdata.0.T", 4, { from: "hue.0" });
  expect(
    h.logs.some((line) =>
      line.message.includes(
        "writes “8” to “0_userdata.0.OUT” because of event “temp” from hue.0",
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
    h.logs.some((line) => line.message.includes("output changed by hue.0")),
  ).toBe(false);
});

const textMachine = (is: { op: string; value?: unknown }): LogicDocument => ({
  version: 3,
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
      version: 3,
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
                  mode: "function",
                  do: {
                    code: 'log("saw {{v}} from {{$from}} (self {{$self}})")',
                  },
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
    version: 3,
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
        expr: code("1"),
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
    version: 3,
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
        expr: code("1"),
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
        expr: code("1"),
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
    version: 3,
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
        init: { run: true },
        states: {
          A: {
            on: [
              {
                on: "$init",
                mode: "function",
                do: { code: 'set("0_userdata.0.W", true)' },
              },
              { on: "v", if: code('get("$self")'), goto: "B" },
            ],
          },
          B: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.W": false });
  const engine = createEngine(self, h.deps, { ownFrom: "ihome.0" });
  h.attach(engine);
  engine.start(); // the $init row writes W=true
  h.change("0_userdata.0.W", false, { from: "hh.0" }); // external: ignored
  expect(engine.memoryValue("self")).toBe("A");
  h.change("0_userdata.0.W", true, { from: "ihome.0" }); // own write
  expect(engine.memoryValue("self")).toBe("B");
});

it("exposes $from and $self to rows", () => {
  const doc: LogicDocument = {
    version: 3,
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
                if: code('get("$from") === "hue.0"'),
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
  const { h, engine } = engineWith(doc({ expr: code("noop()") }));
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
  version: 3,
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
      expr: code('get("x") + 1'),
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
      expr: code('get("mx") + 10'),
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
    version: 3,
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
        expr: code("1"),
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
        expr: code("1"),
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
  version: 3,
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
          enter: { code: 'set("lamp", true)' },
          exit: { code: 'set("lamp", false)' },
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
    version: 3,
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
            enter: { code: 'set("0_userdata.0.D", true)' },
          },
          B: {
            on: [{ on: "e", goto: "A" }],
            enter: { code: 'set("0_userdata.0.D", true)' },
          },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0, "0_userdata.0.D": false });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start(); // silent: A's enter does not run
  expect(h.writes).toHaveLength(0);
  h.change("0_userdata.0.E", 1); // B enter writes D=true once
  expect(h.writes).toHaveLength(1);
  h.change("0_userdata.0.E", 2); // A enter sets the same value → no write
  expect(h.writes).toHaveLength(1);
});

it("fires timer inputs every interval and stops with the engine", () => {
  const timed: LogicDocument = {
    version: 3,
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
        expr: code('get("t")'),
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
    version: 3,
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
        expr: code("5"),
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
        expr: code('get("x")'),
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
    version: 3,
    logics: [
      {
        id: "broken",
        name: "Broken",
        kind: "function",
        expr: code("1"),
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
    version: 3,
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
      { state: { code: 'get("power") ? "On" : "Idle"' } },
    ),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  expect(engine.memoryValue("start")).toBe("On");
});

it("matches the state to the current output value, first declaration wins", () => {
  const doc = startup(
    {
      scope: "state",
      ref: "0_userdata.0.B",
      type: "boolean",
      map: { Idle: false, On: true },
    },
    { match: "output" },
  );
  (doc.logics[0] as MachineLogic).log = true;

  const h = createHarness({ "0_userdata.0.B": true });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  // Adopting is silent: no write, only the state choice.
  expect(h.writes).toEqual([]);
  expect(h.logs.some((l) => l.message.includes("starts in “On”"))).toBe(true);

  const h2 = createHarness({ "0_userdata.0.B": false });
  const engine2 = createEngine(doc, h2.deps);
  h2.attach(engine2);
  engine2.start();
  expect(h2.writes).toEqual([]);
  expect(h2.logs.some((l) => l.message.includes("starts in “Idle”"))).toBe(
    true,
  );
});

it("adopts a boolean output by its On prefix without writing or entering", () => {
  const doc = startup(
    { scope: "state", ref: "0_userdata.0.B", type: "boolean" },
    undefined,
  );
  const logic = doc.logics[0] as MachineLogic;
  logic.log = true;
  logic.states.On.enter = { code: 'set("0_userdata.0.FLAG", true)' };
  logic.states.On.after = { time: "1m", goto: "Idle" };
  const h = createHarness({
    "0_userdata.0.B": true,
    "0_userdata.0.FLAG": false,
  });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.writes).toEqual([]); // no output write and no enter action
  expect(h.clock.pending).toBe(0); // and no `after` timer
  expect(h.logs.some((l) => l.message.includes("starts in “On”"))).toBe(true);
});

it("falls back when the output value matches no state", () => {
  const doc = startup(
    {
      scope: "state",
      ref: "0_userdata.0.B",
      type: "number",
      map: { Idle: 0, On: 1 },
    },
    { match: "output", state: "On" },
  );
  (doc.logics[0] as MachineLogic).log = true;
  const h = createHarness({ "0_userdata.0.B": 99 });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.writes).toEqual([]);
  expect(h.logs.some((l) => l.message.includes("starts in “On”"))).toBe(true);
});

it("exposes $init only during the start evaluation", () => {
  const h = createHarness({
    "0_userdata.0.P": false,
    "0_userdata.0.FLAG": false,
  });
  const doc = startup({ scope: "memory" }, { run: true });
  const logic = doc.logics[0] as MachineLogic;
  logic.states.Idle.enter = {
    code: 'set("0_userdata.0.FLAG", get("$init"), { forward: "always" })',
  };
  logic.states.Idle.on = [{ on: "$init", goto: "On" }];
  logic.states.On.on = [{ on: "power", goto: "Idle" }];
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  // Adopting Idle is silent (its enter action must not run); the $init row's
  // goto to On is the start action.
  expect(h.writes).toEqual([]);
  h.change("0_userdata.0.P", true);
  expect(h.writes.at(-1)).toEqual({
    id: "0_userdata.0.FLAG",
    value: false,
    ack: false,
  });
});

it("runs a function once at start unless init.run is false", () => {
  const fn = (run?: boolean): LogicDocument => ({
    version: 3,
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
        expr: code('get("$init")'),
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
    version: 3,
    logics: [
      {
        id: "machine-first",
        name: "Machine first",
        kind: "machine",
        inputs: {
          m: { from: { type: "memory", ref: "computed" }, kind: "variable" },
        },
        output: { scope: "memory" },
        init: { state: { code: 'get("m")' } },
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
        expr: code('"On"'),
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
    version: 3,
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
        start: "Idle",
        states: {
          Idle: { on: [{ on: "p", goto: "Dim" }] },
          Dim: {},
          On: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.P": false });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  // A number output has no implicit mapping, so start is silent and unwritten.
  expect(h.writes).toEqual([]);
  h.change("0_userdata.0.P", true);
  expect(h.writes.at(-1)).toEqual({
    id: "0_userdata.0.LEVEL",
    value: 1,
    ack: false,
  });
});

it("one input can listen to several states as the same event", () => {
  const doc: LogicDocument = {
    version: 3,
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
        expr: code('get("b")'),
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
    version: 3,
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
    version: 3,
    logics: [
      {
        id: "outvar",
        name: "Out var",
        kind: "function",
        inputs: {
          p: { from: { type: "state", ref: "0_userdata.0.P" }, kind: "event" },
        },
        output: { scope: "state", ref: "TestState_Switch", type: "number" },
        expr: code("1"),
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
  version: 3,
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
              mode: "function",
              do: { code: 'set("low", true)' },
              continue: true,
            },
            {
              on: "value",
              is: { op: "gt", value: 20 },
              mode: "function",
              do: { code: 'set("high", true)' },
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
  (d.logics[0] as MachineLogic).states.Idle.on![0].do = {
    code: 'set("low", true)\ngoto("Done")',
  };
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

it("fires $start after every logic started, in the adopted state", () => {
  const doc: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "prep",
        name: "Prep",
        kind: "function",
        inputs: {},
        output: { scope: "memory", name: "ready" },
        expr: code("true"),
      },
      {
        id: "late",
        name: "Late",
        kind: "machine",
        inputs: {
          ready: { from: { type: "memory", ref: "ready" }, kind: "variable" },
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.OUT",
          type: "boolean",
        },
        init: { state: "Idle" },
        states: {
          Idle: {
            // Only fires when the function above already computed its memory.
            on: [{ on: "$start", if: code('get("ready")'), goto: "On" }],
          },
          On: { on: [{ on: "e", goto: "Idle" }] },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.OUT": false, "0_userdata.0.E": 0 });
  const engine = createEngine(doc, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.writes).toEqual([
    { id: "0_userdata.0.OUT", value: true, ack: false },
  ]);
  // A later event leaves On; $start does not fire again.
  h.writes.length = 0;
  h.change("0_userdata.0.E", 1);
  expect(h.writes).toEqual([
    { id: "0_userdata.0.OUT", value: false, ack: false },
  ]);
});

it("emits a logic output as a $logic event source", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "source",
        name: "Source",
        kind: "machine",
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        start: "Idle",
        states: { Idle: { on: [{ on: "e", goto: "On" }] }, On: {} },
      },
      {
        id: "sink",
        name: "Sink",
        kind: "machine",
        output: { scope: "memory" },
        start: "Idle",
        states: {
          Idle: { on: [{ on: "$logic.source", goto: "Hit" }] },
          Hit: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  expect(engine.memoryValue("sink")).toBe("Idle");
  h.change("0_userdata.0.E", 1);
  expect(engine.memoryValue("source")).toBe("On");
  expect(engine.memoryValue("sink")).toBe("Hit");
});

it("uses a global state variable directly as an event source", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "watch",
        name: "Watch",
        kind: "machine",
        output: { scope: "memory" },
        start: "Idle",
        states: {
          Idle: {
            on: [
              { on: "$var.Alarm", is: { op: "eq", value: true }, goto: "On" },
            ],
          },
          On: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.FLAG": false });
  h.deps.resolveVariable = (name) =>
    name === "Alarm"
      ? { kind: "state", stateId: "0_userdata.0.FLAG" }
      : undefined;
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  expect(engine.subscriptions()).toContain("0_userdata.0.FLAG");
  expect(engine.memoryValue("watch")).toBe("Idle");
  h.change("0_userdata.0.FLAG", true);
  expect(engine.memoryValue("watch")).toBe("On");
});

it("appends the $all rows after the state's rows", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "all",
        name: "All",
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
                is: { op: "eq", value: 1 },
                mode: "function",
                do: { code: 'set("0_userdata.0.OWN", true)' },
              },
            ],
          },
        },
        all: {
          on: [
            {
              on: "e",
              mode: "function",
              do: { code: 'set("0_userdata.0.ALL", true)' },
            },
          ],
        },
      },
    ],
  };
  const h = createHarness({
    "0_userdata.0.E": 0,
    "0_userdata.0.OWN": false,
    "0_userdata.0.ALL": false,
  });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();

  // The state row wins: $all does not run.
  h.writes.length = 0;
  h.change("0_userdata.0.E", 1);
  expect(h.writes.map((w) => w.id)).toEqual(["0_userdata.0.OWN"]);

  // No state row applies: $all handles the same event.
  h.writes.length = 0;
  h.change("0_userdata.0.E", 2);
  expect(h.writes.map((w) => w.id)).toEqual(["0_userdata.0.ALL"]);
});

it("lets a continue row fall through into $all", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "flow",
        name: "Flow",
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
                continue: true,
                mode: "function",
                do: { code: 'set("0_userdata.0.OWN", true)' },
              },
            ],
          },
        },
        all: {
          on: [
            {
              on: "e",
              mode: "function",
              do: { code: 'set("0_userdata.0.ALL", true)' },
            },
          ],
        },
      },
    ],
  };
  const h = createHarness({
    "0_userdata.0.E": 0,
    "0_userdata.0.OWN": false,
    "0_userdata.0.ALL": false,
  });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.writes.length = 0;
  h.change("0_userdata.0.E", 1);
  expect(h.writes.map((w) => w.id)).toEqual([
    "0_userdata.0.OWN",
    "0_userdata.0.ALL",
  ]);
});

const alwaysMachine = (
  on: OnRow[],
  extra: Partial<MachineLogic> = {},
): LogicDocument => ({
  version: 3,
  logics: [
    {
      id: "always",
      name: "Always",
      kind: "machine",
      inputs: {
        e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
      },
      output: { scope: "memory" },
      start: "A",
      states: { A: { on } },
      ...extra,
    },
  ],
});

const setTrue = (ref: string): Expr => code(`set("${ref}", true)`);

it("an $always row fires on a named input event", () => {
  const h = createHarness({
    "0_userdata.0.E": 0,
    "0_userdata.0.FLAG": false,
  });
  const engine = createEngine(
    alwaysMachine([
      { on: "$always", mode: "function", do: setTrue("0_userdata.0.FLAG") },
    ]),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  // The $start job already ran the row; clear the flag it wrote.
  h.change("0_userdata.0.FLAG", false);
  h.writes.length = 0;

  h.change("0_userdata.0.E", 1);
  expect(h.writes).toEqual([
    { id: "0_userdata.0.FLAG", value: true, ack: false },
  ]);
});

it("an $always row fires on $init", () => {
  const h = createHarness({
    "0_userdata.0.E": 0,
    "0_userdata.0.FLAG": false,
  });
  const engine = createEngine(
    alwaysMachine(
      [
        {
          on: "$always",
          if: code('get("$init")'),
          mode: "function",
          do: setTrue("0_userdata.0.FLAG"),
        },
      ],
      { init: { state: "A", run: true } },
    ),
    h.deps,
  );
  h.attach(engine);

  engine.start();
  expect(h.writes).toEqual([
    { id: "0_userdata.0.FLAG", value: true, ack: false },
  ]);
});

it("an $always row fires on $start", () => {
  const h = createHarness({ "0_userdata.0.FLAG": false });
  const engine = createEngine(
    alwaysMachine([
      { on: "$always", mode: "function", do: setTrue("0_userdata.0.FLAG") },
    ]),
    h.deps,
  );
  h.attach(engine);

  engine.start();
  expect(h.writes).toEqual([
    { id: "0_userdata.0.FLAG", value: true, ack: false },
  ]);
});

it("a continue $always row falls through to the rows below", () => {
  const h = createHarness({
    "0_userdata.0.E": 0,
    "0_userdata.0.LOW": false,
    "0_userdata.0.HIGH": false,
  });
  const engine = createEngine(
    alwaysMachine([
      {
        on: "$always",
        continue: true,
        mode: "function",
        do: setTrue("0_userdata.0.LOW"),
      },
      { on: "e", mode: "function", do: setTrue("0_userdata.0.HIGH") },
    ]),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.LOW", false);
  h.writes.length = 0;

  h.change("0_userdata.0.E", 1);
  expect(h.writes.map((w) => w.id)).toEqual([
    "0_userdata.0.LOW",
    "0_userdata.0.HIGH",
  ]);
});

it("without continue an $always row ends the event", () => {
  const h = createHarness({
    "0_userdata.0.E": 0,
    "0_userdata.0.LOW": false,
    "0_userdata.0.HIGH": false,
  });
  const engine = createEngine(
    alwaysMachine([
      { on: "$always", mode: "function", do: setTrue("0_userdata.0.LOW") },
      { on: "e", mode: "function", do: setTrue("0_userdata.0.HIGH") },
    ]),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.LOW", false);
  h.writes.length = 0;

  h.change("0_userdata.0.E", 1);
  expect(h.writes.map((w) => w.id)).toEqual(["0_userdata.0.LOW"]);
});

it("an $always row does not swallow the $self output sync", () => {
  const h = createHarness({
    "0_userdata.0.OUT": false,
    "0_userdata.0.FLAG": false,
  });
  const engine = createEngine(
    follower({
      states: {
        Off: {
          on: [
            {
              on: "$always",
              continue: true,
              mode: "function",
              do: setTrue("0_userdata.0.FLAG"),
            },
          ],
        },
        On: {},
      },
    }),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.FLAG", false);
  h.logs.length = 0;
  h.writes.length = 0;

  h.change("0_userdata.0.OUT", true, { from: "hue.0" });
  expect(
    h.logs.some((line) =>
      line.message.includes(
        "moves from “Off” to “On” because of output changed by hue.0",
      ),
    ),
  ).toBe(true);
  expect(h.writes).toEqual([
    { id: "0_userdata.0.FLAG", value: true, ack: false },
    { id: "0_userdata.0.OUT", value: true, ack: false },
  ]);
});

it("$start carries the start timestamp and exposes it as a ref", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "stamp",
        name: "Stamp",
        kind: "machine",
        output: { scope: "memory" },
        start: "Idle",
        states: {
          Idle: {
            on: [
              {
                on: "$start",
                mode: "function",
                do: { code: 'set("0_userdata.0.SEEN", get("$start"))' },
              },
            ],
          },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.SEEN": 0 });
  h.clock.now = 123456;
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  expect(h.writes).toEqual([
    { id: "0_userdata.0.SEEN", value: 123456, ack: false },
  ]);
});

it("a local event can combine a state and a logic output", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "source",
        name: "Source",
        kind: "machine",
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        start: "Idle",
        states: { Idle: { on: [{ on: "e", goto: "On" }] }, On: {} },
      },
      {
        id: "sink",
        name: "Sink",
        kind: "machine",
        inputs: {
          combo: {
            from: {
              type: "state",
              ref: "0_userdata.0.B",
              refs: ["$logic.source"],
            },
            kind: "event",
          },
        },
        output: { scope: "memory" },
        start: "Idle",
        states: {
          Idle: { on: [{ on: "combo", goto: "Hit" }] },
          Hit: { on: [{ on: "combo", goto: "Idle" }] },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.B": false, "0_userdata.0.E": 0 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  expect(engine.memoryValue("sink")).toBe("Idle");

  h.change("0_userdata.0.B", true); // the state source
  expect(engine.memoryValue("sink")).toBe("Hit");

  h.change("0_userdata.0.E", 1); // the source logic writes -> combo again
  expect(engine.memoryValue("sink")).toBe("Idle");
});

it("an event can combine states and a repeating timer", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "combo",
        name: "Combo",
        kind: "machine",
        inputs: {
          combo: {
            from: { type: "state", ref: "0_userdata.0.E", refs: [] },
            kind: "event",
            timers: ["1m"],
          },
        },
        output: { scope: "memory" },
        start: "Idle",
        states: {
          Idle: {
            on: [
              {
                on: "combo",
                mode: "function",
                do: {
                  code: 'set("0_userdata.0.HIT", get("combo"), { forward: "always" })',
                },
              },
            ],
          },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0, "0_userdata.0.HIT": 0 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();

  h.change("0_userdata.0.E", 1); // the state source
  expect(h.writes.at(-1)?.value).toBe(1);

  h.clock.advance(60_000); // the repeating timer
  expect(h.writes.at(-1)?.value).toBe(60_000);
});

it("fires an astro timer at the computed time", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "astro",
        name: "Astro",
        kind: "machine",
        inputs: {
          tick: {
            from: { type: "state", ref: "", refs: [] },
            kind: "event",
            timers: [{ kind: "astro", event: "sunrise", offset: 10 }],
          },
        },
        output: { scope: "memory" },
        start: "Idle",
        states: {
          Idle: {
            on: [
              {
                on: "tick",
                mode: "function",
                do: {
                  code: 'set("0_userdata.0.HIT", get("tick"), { forward: "always" })',
                },
              },
            ],
          },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.HIT": 0 });
  h.clock.now = 1_000;
  h.deps.nextAstro = (_event, _offset, from) => from + 60_000;
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.clock.advance(59_999);
  expect(h.writes).toHaveLength(0);
  h.clock.advance(1);
  expect(h.writes.at(-1)?.value).toBe(61_000);
});

it("fires a cron timer at the next matching minute", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "cron",
        name: "Cron",
        kind: "machine",
        inputs: {
          tick: {
            from: { type: "state", ref: "", refs: [] },
            kind: "event",
            timers: [{ kind: "cron", at: "08:00", days: "*" }],
          },
        },
        output: { scope: "memory" },
        start: "Idle",
        states: {
          Idle: {
            on: [
              {
                on: "tick",
                mode: "function",
                do: {
                  code: 'set("0_userdata.0.HIT", get("tick"), { forward: "always" })',
                },
              },
            ],
          },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.HIT": 0 });
  const at = new Date(2026, 10, 3, 7, 30, 0).getTime();
  h.clock.now = at;
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.clock.advance(30 * 60_000 - 1);
  expect(h.writes).toHaveLength(0);
  h.clock.advance(1);
  expect(h.writes.at(-1)?.value).toBe(new Date(2026, 10, 3, 8, 0, 0).getTime());
});

it("reports a machine's state at start and on every transition", () => {
  const machine: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "lift",
        name: "Lift",
        kind: "machine",
        init: { state: "Off" },
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        states: { Off: { on: [{ on: "e", goto: "On" }] }, On: {} },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0 });
  const readings: Array<{ id: string; reading: unknown }> = [];
  h.deps.report = (id, reading) => readings.push({ id, reading });
  const engine = createEngine(machine, h.deps);
  h.attach(engine);

  engine.start();
  expect(readings).toEqual([{ id: "lift", reading: { state: "Off", ts: 0 } }]);
  h.change("0_userdata.0.E", 1);
  expect(readings.at(-1)).toEqual({
    id: "lift",
    reading: { state: "On", ts: 0 },
  });
});

it("reports a function's value on every write, memory included", () => {
  const h = createHarness({ "0_userdata.0.T": 3 });
  const readings: Array<{ id: string; reading: unknown }> = [];
  h.deps.report = (id, reading) => readings.push({ id, reading });
  const engine = createEngine(
    doc({ output: { scope: "memory", name: "calcOut" } }),
    h.deps,
  );
  h.attach(engine);

  engine.start();
  expect(readings).toEqual([{ id: "calc", reading: { value: 6, ts: 0 } }]);
  h.change("0_userdata.0.T", 4);
  expect(readings.at(-1)).toEqual({
    id: "calc",
    reading: { value: 8, ts: 0 },
  });
});

it("subscribes to a literal get() ref outside the inputs", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        log: true,
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        states: {
          A: {
            on: [
              {
                on: "e",
                if: code('get("0_userdata.0.EXT") === 5'),
                goto: "B",
              },
            ],
          },
          B: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0, "0_userdata.0.EXT": 5 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  expect(engine.subscriptions()).toContain("0_userdata.0.EXT");
  h.change("0_userdata.0.E", 1);
  expect(h.logs.some((line) => line.message.includes("moves"))).toBe(true);
});

it("rejects a promise result without writing", () => {
  const { h, engine } = engineWith(doc({ expr: code("Promise.resolve(1)") }));
  engine.start();
  expect(h.writes.some((write) => write.id === "0_userdata.0.OUT")).toBe(false);
  expect(
    h.logs.some((line) => line.message.includes("async is not supported")),
  ).toBe(true);
});

it("a timing-out expression does not stop the neighbour", () => {
  const d = doc();
  d.logics.unshift({
    id: "slow",
    name: "Slow",
    kind: "function",
    inputs: {
      t: { from: { type: "state", ref: "0_userdata.0.T" }, kind: "event" },
    },
    output: { scope: "memory" },
    expr: code("(() => { for (;;); })()"),
  });
  const { h, engine } = engineWith(d);
  engine.start(); // the slow logic runs first and already times out here
  h.change("0_userdata.0.T", 4);
  expect(h.logs.some((line) => line.message.includes("timed out"))).toBe(true);
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: 8,
    ack: false,
  });
});

it("starts a valid logic while an invalid one is skipped", () => {
  const d = doc();
  d.logics.push({
    id: "bad",
    name: "Bad",
    kind: "function",
    output: { scope: "memory" },
    expr: code("1 +"),
  });
  const { h, engine } = engineWith(d);
  engine.start();
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: 6,
    ack: false,
  });
  expect(
    h.logs.some(
      (line) =>
        line.logicId === "bad" &&
        line.message.includes("not started") &&
        line.message.includes("expression failed to compile"),
    ),
  ).toBe(true);
});

it("runs a migrated v1 document end to end", () => {
  const v1 = {
    version: 1,
    logics: [
      {
        id: "divzero",
        name: "DivZero",
        kind: "function",
        output: { scope: "memory", name: "divzero" },
        expr: { op: "div", left: { const: 1 }, right: { const: 0 } },
      },
      {
        id: "orval",
        name: "OrVal",
        kind: "function",
        output: { scope: "memory", name: "orval" },
        expr: {
          op: "or",
          of: [{ const: 0 }, { const: "x" }],
        },
      },
      {
        id: "andval",
        name: "AndVal",
        kind: "function",
        output: { scope: "memory", name: "andval" },
        expr: {
          op: "and",
          of: [{ const: 0 }, { const: "x" }],
        },
      },
      {
        id: "lenval",
        name: "LenVal",
        kind: "function",
        output: { scope: "state", ref: "0_userdata.0.LEN", type: "string" },
        expr: { op: "len", of: { const: 5 } },
      },
      {
        id: "cmpval",
        name: "CmpVal",
        kind: "function",
        inputs: {
          s: {
            from: { type: "state", ref: "0_userdata.0.S" },
            kind: "variable",
          },
        },
        output: { scope: "memory", name: "cmp" },
        expr: { op: "gt", left: { ref: "s" }, right: { const: 9 } },
      },
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: {
          state: {
            op: "if",
            cond: { ref: "on" },
            then: { const: "On" },
            else: { const: "Off" },
          },
        },
        inputs: {
          on: {
            from: { type: "state", ref: "0_userdata.0.ON" },
            kind: "variable",
          },
          e: {
            from: { type: "state", ref: "0_userdata.0.E" },
            kind: "event",
          },
        },
        output: { scope: "memory" },
        states: {
          On: {
            on: [
              {
                on: "e",
                if: { op: "gt", left: { ref: "e" }, right: { const: 1 } },
                do: [
                  {
                    set: {
                      target: { ref: "0_userdata.0.MOUT" },
                      value: {
                        op: "add",
                        left: { ref: "e" },
                        right: { const: 1 },
                      },
                    },
                  },
                ],
              },
            ],
          },
          Off: {},
        },
      },
    ],
  };

  const migrated = parseLogicDocument(v1);
  expect(migrated).not.toBeNull();
  expect(migrated!.version).toBe(3);
  const h = createHarness({
    "0_userdata.0.LEN": "unset",
    "0_userdata.0.S": "10",
    "0_userdata.0.ON": true,
    "0_userdata.0.E": 0,
  });
  const engine = createEngine(migrated!, h.deps);
  h.attach(engine);
  engine.start();

  // §5.3: JavaScript value semantics after migration.
  expect(engine.memoryValue("divzero")).toBe(Infinity);
  expect(engine.memoryValue("orval")).toBe("x");
  expect(engine.memoryValue("andval")).toBe(0);
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.LEN",
    value: "undefined",
    ack: false,
  });
  expect(engine.memoryValue("cmp")).toBe(true);

  // init.state chose On, so the row runs; its `if` gates and `set.value` adds.
  h.change("0_userdata.0.E", 3);
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.MOUT",
    value: 4,
    ack: false,
  });
});

it("consumes a rejected promise result without crashing", async () => {
  const { h, engine } = engineWith(
    doc({ expr: code('Promise.reject(new Error("boom"))') }),
  );
  engine.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(h.writes.some((write) => write.id === "0_userdata.0.OUT")).toBe(false);
  expect(
    h.logs.some((line) => line.message.includes("async is not supported")),
  ).toBe(true);
});

it("state() exposes readState metadata for a dotted state", () => {
  const h = createHarness({ "0_userdata.0.T": 1 });
  h.deps.readState = (id) =>
    id === "0_userdata.0.X"
      ? { id, val: 4, ack: true, from: "hue.0", ts: 123, changed: true }
      : undefined;
  const engine = createEngine(
    doc({
      expr: code(
        'JSON.stringify([state("0_userdata.0.X").value, state("0_userdata.0.X").ack, state("0_userdata.0.X").from, state("0_userdata.0.X").ts, state("0_userdata.0.X").changed])',
      ),
      output: { scope: "memory", name: "meta" },
    }),
    h.deps,
  );
  h.attach(engine);
  engine.start();
  expect(engine.memoryValue("meta")).toBe('[4,true,"hue.0",123,true]');
});

it("set() in an expression writes through the normal target path", () => {
  const stateHarness = createHarness({ "0_userdata.0.T": 1 });
  const stateEngine = createEngine(
    doc({
      expr: code('set("0_userdata.0.OUT", 9)'),
      output: { scope: "memory", name: "calcOut" },
    }),
    stateHarness.deps,
  );
  stateHarness.attach(stateEngine);
  stateEngine.start();
  expect(stateHarness.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: 9,
    ack: false,
  });

  const memoryDocument: LogicDocument = {
    version: 3,
    memory: [{ name: "m", type: "number", initial: 1 }],
    logics: [
      {
        id: "calc",
        name: "Calc",
        kind: "function",
        output: { scope: "memory", name: "calcOut" },
        expr: code('set("m", 7)'),
      },
    ],
  };
  const memoryHarness = createHarness({});
  const memoryEngine = createEngine(memoryDocument, memoryHarness.deps);
  memoryHarness.attach(memoryEngine);
  memoryEngine.start();
  expect(memoryEngine.memoryValue("m")).toBe(7);

  const constantHarness = createHarness({ "0_userdata.0.T": 1 });
  constantHarness.deps.resolveVariable = (name) =>
    name === "C" ? { kind: "const", value: 5 } : undefined;
  const constantEngine = createEngine(
    doc({
      expr: code('set("C", 1)'),
      output: { scope: "memory", name: "calcOut" },
    }),
    constantHarness.deps,
  );
  constantHarness.attach(constantEngine);
  constantEngine.start();
  expect(constantHarness.writes).toEqual([]);
  expect(
    constantHarness.logs.some((line) => line.message.includes("not writable")),
  ).toBe(true);
});

it("state().changed is value-based, not ack-based", () => {
  const d = doc({ expr: code('state("temp").changed ? 1 : 0') });
  (d.logics[0].inputs!.temp as { mode?: string }).mode = "any";
  const { h, engine } = engineWith(d);
  engine.start(); // writes 0
  h.change("0_userdata.0.T", 4); // value changed -> 1
  h.change("0_userdata.0.T", 4, { ack: true }); // ack only -> 0
  const values = h.writes
    .filter((write) => write.id === "0_userdata.0.OUT")
    .map((write) => write.value);
  expect(values).toEqual([0, 1, 0]);
});

it("state() reports changed true on a timer tick", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "timer",
        name: "Timer",
        kind: "machine",
        inputs: { t: { from: { type: "timer", every: "1s" }, kind: "event" } },
        output: { scope: "memory" },
        states: {
          A: {
            on: [
              {
                on: "t",
                if: code('state("t").changed'),
                mode: "function",
                do: { code: 'set("0_userdata.0.OUT", true)' },
              },
            ],
          },
        },
      },
    ],
  };
  const h = createHarness({});
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.clock.advance(1000);
  expect(h.writes.some((write) => write.id === "0_userdata.0.OUT")).toBe(true);
});

it("a timer input reports changed false before the first tick", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "timer",
        name: "Timer",
        kind: "function",
        inputs: { t: { from: { type: "timer", every: "1s" }, kind: "event" } },
        output: { scope: "state", ref: "0_userdata.0.OUT", type: "number" },
        expr: code('state("t").changed ? 1 : 0'),
      },
    ],
  };
  const h = createHarness({});
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  const values = () =>
    h.writes
      .filter((write) => write.id === "0_userdata.0.OUT")
      .map((w) => w.value);
  expect(values()).toEqual([0]);
  h.clock.advance(1000);
  expect(values()).toEqual([0, 1]);
});

it("state() reports the metadata of the state that last changed", () => {
  const d = doc({
    inputs: {
      input: {
        from: {
          type: "state",
          ref: "0_userdata.0.A",
          refs: ["0_userdata.0.B"],
        },
        kind: "event",
      },
    },
    output: { scope: "memory", name: "meta" },
    expr: code('JSON.stringify([state("input").from, state("input").ack])'),
  });
  const h = createHarness({ "0_userdata.0.A": 1, "0_userdata.0.B": 1 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.B", 2, { from: "hue.0", ack: true });
  expect(engine.memoryValue("meta")).toBe('["hue.0",true]');
});

it("shares this between rows of one state and not across states", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "A" },
        inputs: {
          add: {
            from: { type: "state", ref: "0_userdata.0.ADD" },
            kind: "event",
          },
          report: {
            from: { type: "state", ref: "0_userdata.0.REPORT" },
            kind: "event",
          },
        },
        output: { scope: "memory" },
        states: {
          A: {
            on: [
              {
                on: "add",
                mode: "function",
                do: { code: 'this.sum = (this.sum ?? 0) + get("add")' },
              },
              {
                on: "report",
                mode: "function",
                do: { code: 'set("0_userdata.0.OUT", this.sum)\ngoto("B")' },
              },
            ],
          },
          B: {
            on: [
              {
                on: "report",
                mode: "function",
                do: { code: 'set("0_userdata.0.OTHER", this.sum ?? "none")' },
              },
            ],
          },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.ADD": 0, "0_userdata.0.REPORT": 0 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.ADD", 2);
  h.change("0_userdata.0.REPORT", 1);
  expect(h.writes.find((w) => w.id === "0_userdata.0.OUT")?.value).toBe(2);
  h.change("0_userdata.0.REPORT", 2);
  expect(h.writes.find((w) => w.id === "0_userdata.0.OTHER")?.value).toBe(
    "none",
  );
});

it("goto() does not restart after; goto(same) does", () => {
  const machine = (action: string): LogicDocument => ({
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "A" },
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        states: {
          A: {
            after: { time: "1m", goto: "B" },
            on: [{ on: "e", mode: "function", do: { code: action } }],
          },
          B: {},
        },
      },
    ],
  });

  // goto("A") arms/restarts the after timer.
  const same = createHarness({ "0_userdata.0.E": 0 });
  const sameEngine = createEngine(machine('goto("A")'), same.deps);
  same.attach(sameEngine);
  sameEngine.start();
  same.change("0_userdata.0.E", 1);
  same.clock.advance(30_000);
  same.change("0_userdata.0.E", 2);
  same.clock.advance(30_000);
  expect(sameEngine.memoryValue("m")).toBe("A");
  same.clock.advance(30_000);
  expect(sameEngine.memoryValue("m")).toBe("B");

  // goto() does not restart the timer armed by the same-state goto.
  const stay = createHarness({ "0_userdata.0.E": 0 });
  const stayEngine = createEngine(
    machine('if (get("e") === 1) goto("A"); else goto()'),
    stay.deps,
  );
  stay.attach(stayEngine);
  stayEngine.start();
  stay.change("0_userdata.0.E", 1); // arms 1m
  stay.clock.advance(30_000);
  stay.change("0_userdata.0.E", 2); // goto() — must not restart
  stay.clock.advance(30_000);
  expect(stayEngine.memoryValue("m")).toBe("B");
});

it("runs the row log before the block", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "A" },
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        states: {
          A: {
            on: [
              {
                on: "e",
                log: { text: "x={{0_userdata.0.X}}", level: "info" },
                mode: "function",
                do: { code: 'set("0_userdata.0.X", 9)' },
              },
            ],
          },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0, "0_userdata.0.X": 1 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.logs.length = 0;
  h.change("0_userdata.0.E", 1);
  expect(h.logs[0]?.message).toBe("x=1");
  expect(h.writes.find((w) => w.id === "0_userdata.0.X")?.value).toBe(9);
});

it("runs only the active mode", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "A" },
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        states: {
          A: {
            on: [
              {
                on: "e",
                mode: "goto",
                goto: "B",
                do: { code: 'set("0_userdata.0.DRAFT", 1)' },
              },
            ],
          },
          B: {
            on: [
              {
                on: "e",
                mode: "function",
                goto: "C",
                do: { code: 'set("0_userdata.0.ACTIVE", 1)' },
              },
            ],
          },
          C: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.E", 1);
  expect(h.writes.some((w) => w.id === "0_userdata.0.DRAFT")).toBe(false);
  h.change("0_userdata.0.E", 2);
  expect(h.writes.some((w) => w.id === "0_userdata.0.ACTIVE")).toBe(true);
  expect(engine.memoryValue("m")).toBe("B");
});

it("a caught goto signal does not transition", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "A" },
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        states: {
          A: {
            on: [
              {
                on: "e",
                mode: "function",
                do: { code: 'try { goto("B") } catch (e) {}' },
              },
            ],
          },
          B: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.E", 1);
  expect(engine.memoryValue("m")).toBe("A");
});

it("a block error aborts the rest of the block and the event continues", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "A" },
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        states: {
          A: {
            on: [
              {
                on: "e",
                continue: true,
                mode: "function",
                do: {
                  code: 'set("0_userdata.0.A1", 1)\nnull.x\nset("0_userdata.0.A2", 1)',
                },
              },
              {
                on: "e",
                mode: "function",
                do: { code: 'set("0_userdata.0.NEXT", 1)' },
              },
            ],
          },
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.E", 1);
  const ids = h.writes.map((w) => w.id);
  expect(ids).toContain("0_userdata.0.A1");
  expect(ids).not.toContain("0_userdata.0.A2");
  expect(ids).toContain("0_userdata.0.NEXT");
  expect(h.logs.some((l) => l.message.startsWith("action failed:"))).toBe(true);
});

it("a goto in an enter block finalizes only the target state", () => {
  const d: LogicDocument = {
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "A" },
        inputs: {
          e: { from: { type: "state", ref: "0_userdata.0.E" }, kind: "event" },
        },
        output: { scope: "memory" },
        states: {
          A: { on: [{ on: "e", mode: "goto", goto: "B" }] },
          B: {
            after: { time: "1m", goto: "A" },
            enter: { code: 'goto("C")' },
          },
          C: {},
        },
      },
    ],
  };
  const h = createHarness({ "0_userdata.0.E": 0 });
  const engine = createEngine(d, h.deps);
  h.attach(engine);
  engine.start();
  h.change("0_userdata.0.E", 1);
  expect(engine.memoryValue("m")).toBe("C");
  expect(h.clock.pending).toBe(0);
});

it.each(["enter", "exit"] as const)(
  "an unknown %s goto still finalizes the destination",
  (block) => {
    const reports: unknown[] = [];
    const d: LogicDocument = {
      version: 3,
      logics: [
        {
          id: "m",
          name: "M",
          kind: "machine",
          init: { state: "A" },
          inputs: {
            e: {
              from: { type: "state", ref: "0_userdata.0.E" },
              kind: "event",
            },
          },
          output: { scope: "memory" },
          states: {
            A: {
              on: [{ on: "e", goto: "B" }],
              ...(block === "exit"
                ? { exit: code('goto("Missing" + "")') }
                : {}),
            },
            B: {
              after: { time: "1m", goto: "A" },
              ...(block === "enter"
                ? { enter: code('goto("Missing" + "")') }
                : {}),
            },
          },
        },
      ],
    };
    const h = createHarness({ "0_userdata.0.E": 0 });
    h.deps.report = (_id, value) => reports.push(value);
    const engine = createEngine(d, h.deps);
    h.attach(engine);
    engine.start();
    h.change("0_userdata.0.E", 1);
    expect(engine.memoryValue("m")).toBe("B");
    expect(h.clock.pending).toBe(1);
    expect(reports.at(-1)).toMatchObject({ state: "B" });
    expect(
      h.logs.some((line) => line.message === "unknown state Missing"),
    ).toBe(true);
  },
);

const pollDoc = (expr: string): LogicDocument => ({
  version: 3,
  logics: [
    {
      id: "poll",
      name: "Poll",
      kind: "function",
      init: { run: false },
      inputs: {
        t: { from: { type: "timer", every: "15s" }, kind: "event" },
      },
      output: {
        scope: "state",
        ref: "0_userdata.0.OUT",
        type: "number",
        forward: "always",
      },
      expr: code(expr),
    },
  ],
});

it("polls on a timer and writes a state from the callback", async () => {
  const { h, engine } = engineWith(
    pollDoc(
      'fetchJson("https://api.test/price", (data, error) => { if (error) { log(error, "warn"); return; } set("0_userdata.0.PRICE", data.price); })',
    ),
  );
  engine.start();
  h.clock.advance(15_000);

  const request = h.nextRequest();
  expect(request?.url).toBe("https://api.test/price");
  expect(request?.init.headers.accept).toBe("application/json");
  request?.respond({ body: '{"price":42}' });
  await flush();

  expect(h.writes).toContainEqual({
    id: "0_userdata.0.PRICE",
    value: 42,
    ack: false,
  });
  // fetchJson returns noop, so the function output is not written.
  expect(h.writes.some((write) => write.id === "0_userdata.0.OUT")).toBe(false);
});

it("runs an event-triggered one-shot fetch", async () => {
  const { h, engine } = engineWith({
    version: 3,
    logics: [
      {
        id: "once",
        name: "Once",
        kind: "function",
        init: { run: false },
        inputs: {
          go: {
            from: { type: "state", ref: "0_userdata.0.GO" },
            kind: "event",
          },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.OUT",
          type: "number",
        },
        expr: code(
          'fetchJson("https://api.test/status", (data) => set("0_userdata.0.STATUS", data.status))',
        ),
      },
    ],
  });
  engine.start();
  h.change("0_userdata.0.GO", 1);

  h.nextRequest()?.respond({ body: '{"status":"ok"}' });
  await flush();

  expect(h.writes).toContainEqual({
    id: "0_userdata.0.STATUS",
    value: "ok",
    ack: false,
  });
});

it('writes the function output with set("$self")', async () => {
  const { h, engine } = engineWith(
    pollDoc('fetchJson("https://x", (data) => set("$self", data.v))'),
  );
  engine.start();
  h.clock.advance(15_000);

  h.nextRequest()?.respond({ body: '{"v":9}' });
  await flush();

  expect(h.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: 9,
    ack: false,
  });
  expect(
    h.reports.some(
      (report) => report.logicId === "poll" && report.reading.value === 9,
    ),
  ).toBe(true);
});

it('machine set("$self") writes the raw output without a transition', async () => {
  const { h, engine } = engineWith({
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "Off" },
        inputs: {
          go: {
            from: { type: "state", ref: "0_userdata.0.GO" },
            kind: "event",
          },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.OUT",
          type: "boolean",
        },
        states: {
          Off: {
            on: [
              {
                on: "go",
                mode: "function",
                do: {
                  code: 'fetchJson("https://x", (data) => set("$self", data.on))',
                },
              },
            ],
          },
          On: {},
        },
      },
    ],
  });
  engine.start();
  h.logs.length = 0;
  h.change("0_userdata.0.GO", 1);

  h.nextRequest()?.respond({ body: '{"on":true}' });
  await flush();

  expect(h.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: true,
    ack: false,
  });
  expect(h.reports.filter((report) => report.reading.state)).toEqual([
    { logicId: "m", reading: { state: "Off", ts: 0 } },
  ]);
});

it("a memory write from a callback triggers another logic", async () => {
  const { h, engine } = engineWith({
    version: 3,
    memory: [{ name: "shared", type: "number", initial: 0 }],
    logics: [
      {
        id: "a",
        name: "A",
        kind: "function",
        init: { run: false },
        inputs: {
          t: { from: { type: "timer", every: "15s" }, kind: "event" },
        },
        expr: code('fetchJson("https://x", (data) => set("shared", data.v))'),
      },
      {
        id: "b",
        name: "B",
        kind: "function",
        init: { run: false },
        inputs: {
          m: { from: { type: "memory", ref: "shared" }, kind: "event" },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.B",
          type: "number",
        },
        expr: code('get("m") * 10'),
      },
    ],
  });
  engine.start();
  h.clock.advance(15_000);

  h.nextRequest()?.respond({ body: '{"v":7}' });
  await flush();

  expect(h.writes).toContainEqual({
    id: "0_userdata.0.B",
    value: 70,
    ack: false,
  });
});

it("stop aborts the request and no callback writes afterwards", async () => {
  const { h, engine } = engineWith(
    pollDoc(
      'fetchJson("https://x", (data) => set("0_userdata.0.PRICE", data.v))',
    ),
  );
  engine.start();
  h.clock.advance(15_000);

  const request = h.nextRequest();
  engine.stop();
  expect(request?.init.signal.aborted).toBe(true);
  request?.respond({ body: '{"v":1}' });
  await flush();

  expect(h.writes).toEqual([]);
});

it("logs a callback failure and keeps the queue moving", async () => {
  const { h, engine } = engineWith(
    pollDoc('fetchJson("https://x", () => { throw new Error("bad") })'),
  );
  engine.start();
  h.clock.advance(15_000);

  h.nextRequest()?.respond({ body: "{}" });
  await flush();
  expect(h.logs.some((line) => line.message === "task failed: bad")).toBe(true);

  h.clock.advance(15_000);
  expect(h.nextRequest()?.url).toBe("https://x");
});

it("logs an HTTP failure to the callback and the adapter", async () => {
  const { h, engine } = engineWith(
    pollDoc(
      'fetchJson("https://x", (data, error) => set("0_userdata.0.ERR", error))',
    ),
  );
  engine.start();
  h.clock.advance(15_000);

  h.nextRequest()?.respond({
    status: 500,
    statusText: "Server Error",
    body: "ignored",
  });
  await flush();

  expect(h.writes).toContainEqual({
    id: "0_userdata.0.ERR",
    value: "HTTP 500 Server Error",
    ack: false,
  });
  expect(
    h.logs.some((line) =>
      line.message.includes("task failed: https://x — HTTP 500 Server Error"),
    ),
  ).toBe(true);
});

it("drops a callback beyond maxDepth and continues the queue", async () => {
  const h = createHarness({});
  const engine = createEngine(
    pollDoc('fetchJson("https://x", () => set("0_userdata.0.OUT2", 1))'),
    h.deps,
    { maxDepth: 0 },
  );
  h.attach(engine);
  engine.start();
  h.clock.advance(15_000);

  h.nextRequest()?.respond({ body: "{}" });
  await flush();
  expect(
    h.logs.some((line) => line.message.includes("cascade deeper than 0")),
  ).toBe(true);
  expect(h.writes).toEqual([]);

  h.clock.advance(15_000);
  expect(h.nextRequest()?.url).toBe("https://x");
});

it("a callback after a state change keeps the captured this", async () => {
  const { h, engine } = engineWith({
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "On" },
        inputs: {
          go: {
            from: { type: "state", ref: "0_userdata.0.GO" },
            kind: "event",
          },
          off: {
            from: { type: "state", ref: "0_userdata.0.OFF" },
            kind: "event",
          },
        },
        states: {
          On: {
            on: [
              {
                on: "go",
                mode: "function",
                do: {
                  code: [
                    'this.tag = "on"',
                    'fetchJson("https://x", () => set("0_userdata.0.SEEN", this.tag))',
                  ].join("\n"),
                },
              },
              { on: "off", goto: "Off" },
            ],
          },
          Off: {},
        },
      },
    ],
  });
  engine.start();
  h.change("0_userdata.0.GO", 1);
  h.change("0_userdata.0.OFF", true); // leave On before the request settles

  h.nextRequest()?.respond({ body: "{}" });
  await flush();

  expect(h.writes).toContainEqual({
    id: "0_userdata.0.SEEN",
    value: "on",
    ack: false,
  });
});

it("writes an object output as JSON text", () => {
  const { h, engine } = engineWith(
    doc({
      output: { scope: "state", ref: "0_userdata.0.OUT", type: "object" },
      expr: code("({ a: 1, b: [2] })"),
    }),
  );
  engine.start();
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: '{"a":1,"b":[2]}',
    ack: false,
  });
});

it("stores an already serialized object output unchanged", () => {
  const { h, engine } = engineWith(
    doc({
      output: { scope: "state", ref: "0_userdata.0.OUT", type: "object" },
      expr: code('"{\\"a\\":1}"'),
    }),
  );
  engine.start();
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: '{"a":1}',
    ack: false,
  });
});

it("writes undefined as null JSON text", () => {
  const { h, engine } = engineWith(
    doc({
      output: { scope: "state", ref: "0_userdata.0.OUT", type: "object" },
      expr: code("undefined"),
    }),
  );
  engine.start();
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: "null",
    ack: false,
  });
});

it('machine set("$self") writes an object output as JSON text', () => {
  const { h, engine } = engineWith({
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "Off" },
        inputs: {
          go: {
            from: { type: "state", ref: "0_userdata.0.GO" },
            kind: "event",
          },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.OUT",
          type: "object",
        },
        states: {
          Off: {
            on: [
              {
                on: "go",
                mode: "function",
                do: { code: 'set("$self", { on: true })' },
              },
            ],
          },
        },
      },
    ],
  });
  engine.start();
  h.change("0_userdata.0.GO", 1);
  expect(h.writes).toContainEqual({
    id: "0_userdata.0.OUT",
    value: '{"on":true}',
    ack: false,
  });
});

it("a machine transition does not write an object output", () => {
  const { h, engine } = engineWith({
    version: 3,
    logics: [
      {
        id: "m",
        name: "M",
        kind: "machine",
        init: { state: "On" },
        inputs: {
          go: {
            from: { type: "state", ref: "0_userdata.0.GO" },
            kind: "event",
          },
        },
        output: {
          scope: "state",
          ref: "0_userdata.0.OUT",
          type: "object",
        },
        states: {
          On: { on: [{ on: "go", goto: "Off" }] },
          Off: {},
        },
      },
    ],
  });
  engine.start();
  h.change("0_userdata.0.GO", 1);
  expect(h.writes.filter((write) => write.id === "0_userdata.0.OUT")).toEqual(
    [],
  );
});

it("maps a real MQTT JSON state with dotted keys into generated states", () => {
  const source = `({
    readFrom: "state",
    params: [{ name: "source", label: "Source state", type: "state" }],
    itemList: [
      { name: "energy", type: "number", source: ["1.8.0"], readOnly: true,
        conversion: (result, raw) => Number(raw) },
      { name: "power", type: "number", source: ["1.7.0"], readOnly: true,
        conversion: (result, raw) => Number(raw) },
    ],
  })`;
  const template = new Function("return (" + source + ")")();
  const logic = buildDeviceLogic(
    template,
    source,
    { source: "mqtt.0.SHRDZM.3C6105FB24B9.3C6105FB24B9.sensor" },
    "ihome.0.Variables.Meter",
    "meter",
    "Meter",
  );
  const h = createHarness({});
  const engine = createEngine({ version: 3, logics: [logic] }, h.deps);
  h.attach(engine);
  engine.start();

  h.change(
    "mqtt.0.SHRDZM.3C6105FB24B9.3C6105FB24B9.sensor",
    JSON.stringify({
      timestamp: "2026-11-06T20:44:30",
      "1.8.0": "21557698",
      "1.7.0": "388",
    }),
  );

  expect(h.writes).toContainEqual({
    id: "ihome.0.Variables.Meter.energy",
    value: 21557698,
    ack: true,
  });
  expect(h.writes).toContainEqual({
    id: "ihome.0.Variables.Meter.power",
    value: 388,
    ack: true,
  });
});
