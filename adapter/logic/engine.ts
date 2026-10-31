import { evaluate } from "./expr";
import { parseDuration } from "./duration";
import { logicHasErrors, validateLogicDocument } from "./validate";
import type {
  Action,
  Forward,
  FunctionLogic,
  Input,
  LogicDef,
  LogicDocument,
  MachineLogic,
  Output,
  StateDef,
} from "./types";

export interface StateChange {
  id: string;
  val: unknown;
  ack?: boolean;
  from?: string;
  ts?: number;
}

export interface EngineDeps {
  read(id: string): unknown;
  write(id: string, value: unknown, ack: boolean): void;
  log(level: "info" | "warn", logicId: string, message: string): void;
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  resolveVariable?(
    name: string,
  ):
    | { kind: "const"; value: unknown }
    | { kind: "state"; stateId: string }
    | undefined;
}

export interface EngineOptions {
  /** Writes from this prefix are the adapter's own echo (D5). */
  ownFrom?: string;
  maxDepth?: number;
}

export interface Engine {
  subscriptions(): string[];
  start(): void;
  stop(): void;
  onStateChange(change: StateChange): void;
  memoryValue(name: string): unknown;
}

interface InputRuntime {
  name: string;
  input: Input;
  stateId?: string;
  last?: unknown;
  hasLast: boolean;
}

interface Runtime {
  def: LogicDef;
  inputs: Map<string, InputRuntime>;
  output: Output;
  lastOutput?: unknown;
  hasOutput: boolean;
  /** Machine only: the current state and its `after` timer. */
  state?: string;
  timer?: number;
  /** Timer inputs of this logic, by input name. */
  timers: Map<string, number>;
  /** True only while this logic's start evaluation runs (D19). */
  init: boolean;
}

interface EventMeta {
  /** Writer: an adapter instance, `memory:<logicId>`, `timer`, or `init`. */
  from: string;
  /** True when this very logic caused the change. */
  self: boolean;
  ack?: boolean;
  ts?: number;
}

interface Job {
  rt: Runtime;
  input: string;
  value: unknown;
  depth: number;
  meta: EventMeta;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function isNoop(value: unknown): value is { noop: true } {
  return isRecord(value) && "noop" in value;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Build an engine for one document version. The adapter creates a fresh engine
 * on every `logicList` change and stops the previous one, so nothing here has
 * to survive a reload.
 */
export function createEngine(
  doc: LogicDocument,
  deps: EngineDeps,
  options: EngineOptions = {},
): Engine {
  const ownFrom = options.ownFrom;
  const maxDepth = options.maxDepth ?? 32;
  const memory = new Map<string, unknown>();
  const issues = validateLogicDocument(doc);
  const declaredMemory = new Set<string>(
    (doc.memory ?? []).map((entry) => entry.name),
  );
  for (const def of doc.logics) {
    if (def.output?.scope === "memory") {
      declaredMemory.add(def.output.name ?? def.id);
    }
  }

  const runtimes: Runtime[] = [];
  const resolveStateId = (ref: string): string | undefined => {
    if (ref.includes(".")) return ref;
    const variable = deps.resolveVariable?.(ref);
    return variable?.kind === "state" ? variable.stateId : undefined;
  };

  for (const def of doc.logics) {
    if (def.enabled === false) continue;
    if (logicHasErrors(issues, def.id)) {
      const messages = issues
        .filter(
          (issue) => issue.logicId === def.id && issue.severity === "error",
        )
        .map((issue) => `${issue.path}: ${issue.message}`)
        .join("; ");
      deps.log("warn", def.id, `not started — ${messages}`);
      continue;
    }
    const inputs = new Map<string, InputRuntime>();
    for (const [name, input] of Object.entries(def.inputs ?? {})) {
      inputs.set(name, {
        name,
        input,
        stateId:
          input.from.type === "state"
            ? resolveStateId(input.from.ref)
            : undefined,
        hasLast: false,
      });
    }
    runtimes.push({
      def,
      inputs,
      output: def.output ?? { scope: "memory", name: def.id },
      hasOutput: false,
      timers: new Map<string, number>(),
      init: false,
    });
  }

  const queue: Job[] = [];
  /** Writes this engine made, per state id, for self-attribution. */
  const pendingWrites = new Map<
    string,
    Array<{ value: unknown; logicId: string }>
  >();
  let currentMeta: EventMeta = { from: "", self: false };
  let running = false;
  let started = false;
  let chainSeen = new Set<string>();
  let chainWarned = new Set<string>();

  const warn = (logicId: string, message: string) =>
    deps.log("warn", logicId, message);

  function resolveIn(rt: Runtime, ref: string): unknown {
    if (ref === "$init") return rt.init;
    if (ref === "$from") return currentMeta.from;
    if (ref === "$self") return currentMeta.self;
    if (ref === "$ack") return currentMeta.ack;
    if (ref === "$ts") return currentMeta.ts;
    const input = rt.inputs.get(ref);
    if (input) {
      if (input.input.from.type === "memory") {
        return memory.get(input.input.from.ref);
      }
      if (input.input.from.type === "timer") return input.last;
      return input.stateId ? deps.read(input.stateId) : undefined;
    }
    if (memory.has(ref) || declaredMemory.has(ref)) return memory.get(ref);
    if (ref.includes(".")) return deps.read(ref);
    const variable = deps.resolveVariable?.(ref);
    if (!variable) return undefined;
    return variable.kind === "const"
      ? variable.value
      : deps.read(variable.stateId);
  }

  function externalId(ref: string, rt: Runtime): string | undefined {
    const input = rt.inputs.get(ref);
    if (input) return input.stateId;
    if (memory.has(ref) || declaredMemory.has(ref)) return undefined;
    if (ref.includes(".")) return ref;
    const variable = deps.resolveVariable?.(ref);
    return variable?.kind === "state" ? variable.stateId : undefined;
  }

  function collectRefs(value: unknown, out: string[]): void {
    if (Array.isArray(value)) {
      for (const item of value) collectRefs(item, out);
    } else if (isRecord(value)) {
      for (const [key, item] of Object.entries(value)) {
        if (key === "ref" && typeof item === "string") out.push(item);
        else collectRefs(item, out);
      }
    }
  }

  function subscriptions(): string[] {
    const ids = new Set<string>();
    for (const rt of runtimes) {
      const refs: string[] = [];
      collectRefs(rt.def, refs);
      for (const ref of refs) {
        const id = externalId(ref, rt);
        if (id) ids.add(id);
      }
      for (const input of rt.inputs.values()) {
        if (input.stateId) ids.add(input.stateId);
      }
      if (rt.output.scope === "state") ids.add(rt.output.ref);
    }
    return [...ids];
  }

  function enqueue(job: Job): void {
    if (!running) {
      chainSeen = new Set<string>();
      chainWarned = new Set<string>();
    }
    queue.push(job);
    if (!running) drain();
  }

  function drain(): void {
    running = true;
    try {
      while (queue.length > 0) {
        const job = queue.shift();
        if (job) handle(job);
      }
    } finally {
      running = false;
    }
  }

  function handle(job: Job): void {
    if (job.depth > maxDepth) {
      const key = `depth:${job.rt.def.id}`;
      if (!chainWarned.has(key)) {
        chainWarned.add(key);
        warn(job.rt.def.id, `cascade deeper than ${maxDepth}, event dropped`);
      }
      return;
    }
    const key = `${job.rt.def.id}|${job.rt.state ?? ""}|${job.input}|${JSON.stringify(job.value)}`;
    if (chainSeen.has(key)) {
      const warnKey = `loop:${job.rt.def.id}`;
      if (!chainWarned.has(warnKey)) {
        chainWarned.add(warnKey);
        warn(job.rt.def.id, "possible loop, event dropped");
      }
      return;
    }
    chainSeen.add(key);
    const previousMeta = currentMeta;
    currentMeta = job.meta;
    try {
      if (job.rt.def.kind === "function") {
        runFunction(job.rt, job.depth);
      } else {
        handleMachine(job);
      }
    } finally {
      currentMeta = previousMeta;
    }
  }

  function handleMachine(job: Job): void {
    const rt = job.rt;
    const def = rt.def as MachineLogic;
    const state = rt.state ? def.states[rt.state] : undefined;
    if (!state) return;
    for (const row of state.on ?? []) {
      if (row.on !== job.input) continue;
      if (row.is && !matchesIs(row.is, job.value)) continue;
      if (row.if) {
        try {
          if (!evaluate(row.if, (ref) => resolveIn(rt, ref))) continue;
        } catch (error) {
          warn(rt.def.id, `condition failed: ${errorText(error)}`);
          continue;
        }
      }
      runActions(rt, row.do ?? [], job.depth);
      if (row.goto) transition(rt, row.goto, job.depth);
      return;
    }
  }

  function matchesIs(
    is: { op: string; value?: unknown },
    value: unknown,
  ): boolean {
    switch (is.op) {
      case "eq":
        return value === is.value;
      case "ne":
        return value !== is.value;
      case "gt":
        return Number(value) > Number(is.value);
      case "gte":
        return Number(value) >= Number(is.value);
      case "lt":
        return Number(value) < Number(is.value);
      case "lte":
        return Number(value) <= Number(is.value);
      default:
        return false;
    }
  }

  function clearTimer(rt: Runtime): void {
    if (rt.timer !== undefined) {
      deps.clearTimeout(rt.timer);
      rt.timer = undefined;
    }
  }

  function armAfter(rt: Runtime, name: string, state: StateDef): void {
    clearTimer(rt);
    if (!state.after) return;
    const ms = parseDuration(state.after.time);
    if (ms === null || ms <= 0) return;
    rt.timer = deps.setTimeout(() => {
      rt.timer = undefined;
      if (rt.state === name) transition(rt, state.after!.goto, 0);
    }, ms);
  }

  function transition(rt: Runtime, name: string, depth: number): void {
    const def = rt.def as MachineLogic;
    const next = def.states[name];
    if (!next) {
      warn(def.id, `unknown state ${name}`);
      return;
    }
    const same = rt.state === name;
    const previous = rt.state ? def.states[rt.state] : undefined;
    if (same) {
      clearTimer(rt);
    } else {
      if (previous) runActions(rt, previous.exit ?? [], depth);
      clearTimer(rt);
      rt.state = name;
      runActions(rt, next.enter ?? [], depth);
    }
    armAfter(rt, name, next);
    writeOutput(rt, name, depth);
  }

  function runActions(rt: Runtime, actions: Action[], depth: number): void {
    for (const action of actions) {
      if ("set" in action) {
        let value: unknown;
        try {
          value = evaluate(action.set.value, (ref) => resolveIn(rt, ref));
        } catch (error) {
          warn(rt.def.id, `set failed: ${errorText(error)}`);
          continue;
        }
        writeTarget(
          rt,
          action.set.target.ref,
          value,
          action.set.ack ?? false,
          action.set.forward,
          depth,
        );
      } else if ("goto" in action) {
        transition(rt, action.goto, depth);
      } else if ("log" in action) {
        deps.log(action.log.level ?? "info", rt.def.id, action.log.text);
      }
    }
  }

  function writeMemory(
    name: string,
    value: unknown,
    forward: Forward | undefined,
    depth: number,
    producer: string,
  ): void {
    if (
      (forward ?? "changed") === "changed" &&
      memory.has(name) &&
      Object.is(memory.get(name), value)
    ) {
      return;
    }
    memory.set(name, value);
    emitMemory(name, value, depth + 1, producer);
  }

  function writeTarget(
    rt: Runtime,
    ref: string,
    value: unknown,
    ack: boolean,
    forward: Forward | undefined,
    depth: number,
  ): void {
    const input = rt.inputs.get(ref);
    if (input) {
      if (input.input.from.type === "memory") {
        writeMemory(input.input.from.ref, value, forward, depth, rt.def.id);
      } else if (input.stateId) {
        writeState(rt, input.stateId, value, ack, forward);
      }
      return;
    }
    if (declaredMemory.has(ref) || memory.has(ref)) {
      writeMemory(ref, value, forward, depth, rt.def.id);
      return;
    }
    if (ref.includes(".")) {
      writeState(rt, ref, value, ack, forward);
      return;
    }
    const variable = deps.resolveVariable?.(ref);
    if (variable?.kind === "state") {
      writeState(rt, variable.stateId, value, ack, forward);
    } else {
      warn(rt.def.id, `cannot write ${ref}: not a state or memory name`);
    }
  }

  function noteWrite(id: string, value: unknown, logicId: string): void {
    const list = pendingWrites.get(id) ?? [];
    list.push({ value, logicId });
    if (list.length > 32) list.shift();
    pendingWrites.set(id, list);
  }

  function claimWrite(
    id: string,
    from: string,
    value: unknown,
  ): string | undefined {
    if (!ownFrom || !from.startsWith(ownFrom)) return undefined;
    const list = pendingWrites.get(id);
    if (!list) return undefined;
    const index = list.findIndex((entry) => Object.is(entry.value, value));
    if (index < 0) return undefined;
    return list.splice(index, 1)[0].logicId;
  }

  function writeState(
    rt: Runtime,
    id: string,
    value: unknown,
    ack: boolean,
    forward: Forward | undefined,
  ): void {
    if (
      (forward ?? "changed") === "changed" &&
      Object.is(deps.read(id), value)
    ) {
      return;
    }
    noteWrite(id, value, rt.def.id);
    deps.write(id, value, ack);
  }

  function runFunction(rt: Runtime, depth: number): void {
    const def = rt.def as FunctionLogic;
    if (isNoop(def.expr)) return;
    let value: unknown;
    try {
      value = evaluate(def.expr, (ref) => resolveIn(rt, ref));
    } catch (error) {
      warn(def.id, `expression failed: ${errorText(error)}`);
      return;
    }
    writeOutput(rt, value, depth);
  }

  function coerce(
    value: unknown,
    type: "boolean" | "number" | "string",
  ): unknown {
    if (type === "boolean") return Boolean(value);
    if (type === "number") return Number(value);
    return String(value);
  }

  function forwardAllows(
    rt: Runtime,
    value: unknown,
    forward: Forward | undefined,
  ): boolean {
    if (forward === "always") return true;
    return !rt.hasOutput || !Object.is(rt.lastOutput, value);
  }

  function outputValue(rt: Runtime, value: unknown): unknown {
    if (rt.output.scope !== "state") return value;
    if (rt.def.kind !== "machine") return coerce(value, rt.output.type);
    const name = String(value);
    if (rt.output.map && name in rt.output.map) return rt.output.map[name];
    if (rt.output.type === "boolean") return name.startsWith("On");
    if (rt.output.type === "string") return name;
    return coerce(name, rt.output.type);
  }

  function writeOutput(rt: Runtime, value: unknown, depth: number): void {
    const output = rt.output;
    if (output.scope === "memory") {
      const name = output.name ?? rt.def.id;
      rt.lastOutput = value;
      rt.hasOutput = true;
      // The stored memory value is the reference (spec §5.6), not the last
      // write of this logic: a seeded value must not emit an event.
      writeMemory(name, value, output.forward, depth, rt.def.id);
      return;
    }
    const mapped = outputValue(rt, value);
    if (!forwardAllows(rt, mapped, output.forward)) return;
    rt.lastOutput = mapped;
    rt.hasOutput = true;
    noteWrite(output.ref, mapped, rt.def.id);
    deps.write(output.ref, mapped, true);
  }

  function startMachine(rt: Runtime): void {
    const def = rt.def as MachineLogic;
    const names = Object.keys(def.states);
    if (names.length === 0) return;
    const chosen = chooseStart(rt, def, names);
    rt.init = true;
    transition(rt, chosen, 0);
    if (def.init?.run === true) {
      // The `$init` rows run after entering, with $init true.
      handleMachine({
        rt,
        input: "$init",
        value: true,
        depth: 0,
        meta: { from: "init", self: true, ts: deps.now() },
      });
    }
    rt.init = false;
  }

  function chooseStart(
    rt: Runtime,
    def: MachineLogic,
    names: string[],
  ): string {
    const init = def.init;
    if (
      init?.match === "output" &&
      rt.output.scope === "state" &&
      rt.output.map
    ) {
      const current = deps.read(rt.output.ref);
      for (const name of names) {
        if (Object.is(rt.output.map[name], current)) return name;
      }
    }
    if (init?.state !== undefined) {
      let value: unknown;
      try {
        value =
          typeof init.state === "string"
            ? init.state
            : evaluate(init.state, (ref) => resolveIn(rt, ref));
      } catch (error) {
        warn(def.id, `init state failed: ${errorText(error)}`);
        value = undefined;
      }
      if (typeof value === "string" && def.states[value]) return value;
      warn(def.id, `init state ${String(value)} not found, using the fallback`);
    }
    if (def.start && def.states[def.start]) return def.start;
    return names[0];
  }

  function armTimer(rt: Runtime, input: InputRuntime): void {
    if (input.input.from.type !== "timer") return;
    const ms = parseDuration(input.input.from.every);
    if (ms === null || ms <= 0) return;
    const handle = deps.setTimeout(() => {
      rt.timers.delete(input.name);
      if (!started) return;
      input.last = deps.now();
      input.hasLast = true;
      enqueue({
        rt,
        input: input.name,
        value: input.last,
        depth: 0,
        meta: { from: "timer", self: true, ts: deps.now() },
      });
      armTimer(rt, input);
    }, ms);
    rt.timers.set(input.name, handle);
  }

  function emitMemory(
    name: string,
    value: unknown,
    depth: number,
    producer: string,
  ): void {
    for (const rt of runtimes) {
      for (const input of rt.inputs.values()) {
        if (
          input.input.kind !== "event" ||
          input.input.from.type !== "memory" ||
          input.input.from.ref !== name
        ) {
          continue;
        }
        const self = producer === rt.def.id;
        if (!sourceAllows(input, self)) continue;
        enqueue({
          rt,
          input: input.name,
          value,
          depth,
          meta: {
            from: `memory:${producer}`,
            self,
            ack: false,
            ts: deps.now(),
          },
        });
      }
    }
  }

  function sourceAllows(input: InputRuntime, self: boolean): boolean {
    const source = input.input.source ?? "external";
    if (source === "any") return true;
    return source === "self" ? self : !self;
  }

  function ackMatches(filter: Input["ack"], ack: boolean | undefined): boolean {
    if (!filter || filter === "any") return true;
    return filter === "true" ? ack === true : ack === false;
  }

  return {
    subscriptions,
    memoryValue: (name) => memory.get(name),
    start() {
      if (started) return;
      started = true;
      for (const entry of doc.memory ?? [])
        memory.set(entry.name, entry.initial);
      // Two passes (D17): computed memory is available to machines.
      for (const rt of runtimes) {
        if (rt.def.kind !== "function") continue;
        rt.init = true;
        if (rt.def.init?.run !== false) runFunction(rt, 0);
        rt.init = false;
      }
      for (const rt of runtimes) {
        if (rt.def.kind === "machine") startMachine(rt);
      }
      for (const rt of runtimes) {
        for (const input of rt.inputs.values()) armTimer(rt, input);
      }
    },
    stop() {
      for (const rt of runtimes) {
        clearTimer(rt);
        for (const handle of rt.timers.values()) deps.clearTimeout(handle);
        rt.timers.clear();
      }
      started = false;
      queue.length = 0;
      chainSeen = new Set<string>();
      chainWarned = new Set<string>();
    },
    onStateChange(change) {
      if (!started) return;
      const writer = claimWrite(change.id, change.from ?? "", change.val);
      for (const rt of runtimes) {
        const self = writer === rt.def.id;
        for (const input of rt.inputs.values()) {
          if (input.stateId !== change.id) continue;
          if ((input.input.kind ?? "variable") !== "event") continue;
          if (!sourceAllows(input, self)) continue;
          if (input.input.mode === "any") {
            // every update counts, even the same value
          } else if (input.hasLast && Object.is(input.last, change.val)) {
            input.last = change.val;
            continue;
          }
          if (!ackMatches(input.input.ack, change.ack)) continue;
          input.last = change.val;
          input.hasLast = true;
          enqueue({
            rt,
            input: input.name,
            value: change.val,
            depth: 0,
            meta: {
              from: change.from ?? "",
              self,
              ack: change.ack,
              ts: change.ts,
            },
          });
        }
      }
    },
  };
}
