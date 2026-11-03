import { evaluate } from "./expr";
import { parseDuration } from "./duration";
import { nextCron } from "./timer-ops";
import { isRecord, logicHasErrors, validateLogicDocument } from "./validate";
import type {
  Action,
  AstroEvent,
  Duration,
  Forward,
  FunctionLogic,
  Input,
  LogicDef,
  LogicDocument,
  MachineLogic,
  OnRow,
  Output,
  StateDef,
  TimerSpec,
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
  /** The next astro time after `from`, in ms; undefined when no location. */
  nextAstro?(
    event: AstroEvent,
    offset: number,
    from: number,
  ): number | undefined;
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
  /** A state input may name several states: any of them is the same event. */
  stateIds: string[];
  /** Per source, so a second button with the same value still fires. */
  lastById: Map<string, unknown>;
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
  /** The `$start` timestamp while that event is being handled (D28). */
  starting?: number;
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
  /** The source's value before this update; rows compare edges against it. */
  previous?: unknown;
  hasPrevious: boolean;
  depth: number;
  /** A repeating timer of an event input: no external writer. */
  fromTimer?: boolean;
  meta: EventMeta;
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
      const stateIds =
        input.from.type === "state"
          ? [input.from.ref, ...(input.from.refs ?? [])]
              .map((ref) => resolveStateId(ref))
              .filter((id): id is string => !!id)
          : [];
      inputs.set(name, {
        name,
        input,
        stateIds,
        lastById: new Map<string, unknown>(),
        hasLast: false,
      });
    }
    // `$var.<name>` rows use a global state variable as an event source (D30);
    // resolving it to its state makes the normal input path deliver it.
    if (def.kind === "machine") {
      const unknown = new Set<string>();
      for (const state of Object.values(def.states ?? {})) {
        for (const row of state.on ?? []) {
          if (!row.on.startsWith("$var.") || inputs.has(row.on)) continue;
          const name = row.on.slice("$var.".length);
          const variable = deps.resolveVariable?.(name);
          if (!variable || variable.kind !== "state") {
            if (!unknown.has(name)) {
              unknown.add(name);
              deps.log("warn", def.id, `variable “${name}” is not a state`);
            }
            continue;
          }
          inputs.set(row.on, {
            name: row.on,
            input: { from: { type: "state", ref: name }, kind: "event" },
            stateIds: [variable.stateId],
            lastById: new Map<string, unknown>(),
            hasLast: false,
          });
        }
      }
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
  const warned = new Set<string>();
  function warnOnce(logicId: string, message: string): void {
    const key = `${logicId}|${message}`;
    if (warned.has(key)) return;
    warned.add(key);
    warn(logicId, message);
  }

  /** A machine logs as `<logic id>.<state>`, so a line says where it happened. */
  function logId(rt: Runtime): string {
    return rt.def.kind === "machine" && rt.state
      ? `${rt.def.id}.${rt.state}`
      : rt.def.id;
  }

  /** State changes are only logged for a logic with `log: true`. */
  function stateLog(rt: Runtime, message: string): void {
    if (rt.def.log === true) deps.log("info", logId(rt), message);
  }

  /** The writer behind a job's event; init/start/timer are not a person. */
  function eventWriter(job: Job): string {
    const from = job.meta.from;
    return from && from !== "init" && from !== "start" && from !== "timer"
      ? from
      : "";
  }

  /** `event “input” from writer` — what a transition and its write say. */
  function eventCause(job: Job): string {
    const writer = eventWriter(job);
    return `event “${job.input}”${writer ? ` from ${writer}` : ""}`;
  }

  function resolveIn(rt: Runtime, ref: string): unknown {
    if (ref === "$init") return rt.init;
    if (ref === "$start") return rt.starting;
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
      if (input.hasLast) return input.last;
      return input.stateIds[0] ? deps.read(input.stateIds[0]) : undefined;
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
    if (input) return undefined; // its sources are added explicitly below
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
        for (const id of input.stateIds) ids.add(id);
      }
      const target = outputTargetId(rt);
      if (target) ids.add(target);
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
        warn(logId(job.rt), `cascade deeper than ${maxDepth}, event dropped`);
      }
      return;
    }
    const key = `${job.rt.def.id}|${job.rt.state ?? ""}|${job.input}|${JSON.stringify(job.value)}`;
    if (chainSeen.has(key)) {
      const warnKey = `loop:${job.rt.def.id}`;
      if (!chainWarned.has(warnKey)) {
        chainWarned.add(warnKey);
        warn(logId(job.rt), "possible loop, event dropped");
      }
      return;
    }
    chainSeen.add(key);
    const previousMeta = currentMeta;
    const previousStarting = job.rt.starting;
    if (job.input === "$start") {
      job.rt.starting = typeof job.value === "number" ? job.value : deps.now();
    }
    currentMeta = job.meta;
    try {
      if (job.rt.def.kind === "function") {
        const input = job.rt.inputs.get(job.input)?.input;
        const origin =
          !job.fromTimer &&
          (input?.from.type === "state" || input?.from.type === "memory");
        if (origin) {
          const source = input?.source ?? "external";
          if (
            source === "self"
              ? !job.meta.self
              : job.meta.self && source === "external"
          ) {
            return;
          }
          if (!ackMatches(input?.ack, job.meta.ack)) return;
        }
        const isMemory = input?.from.type === "memory";
        const unchanged = job.hasPrevious && Object.is(job.previous, job.value);
        if (input?.mode === "any" || isMemory || !unchanged) {
          runFunction(job.rt, job.depth, eventCause(job));
        }
      } else {
        handleMachine(job);
      }
    } finally {
      currentMeta = previousMeta;
      job.rt.starting = previousStarting;
    }
  }

  function handleMachine(job: Job): void {
    const rt = job.rt;
    const def = rt.def as MachineLogic;
    const state = rt.state ? def.states[rt.state] : undefined;
    if (!state) return;
    const input = rt.inputs.get(job.input);
    // The state's own rows first; `$all` is appended after them (D31).
    const own = runRows(rt, state.on ?? [], job, input);
    if (own.stopped) return;
    const all = runRows(rt, def.all?.on ?? [], job, input);
    // No row took the event: an output change still moves the machine.
    if (!own.matched && !all.matched && job.input === "$self") {
      syncToOutput(rt, job.value, job.depth, job.meta.from);
    }
  }

  /** Runs one row list; `stopped` means a terminal match ended the event. */
  function runRows(
    rt: Runtime,
    rows: OnRow[],
    job: Job,
    input: InputRuntime | undefined,
  ): { matched: boolean; stopped: boolean } {
    let matched = false;
    for (const row of rows) {
      const always = row.on === "$always";
      if (!always && row.on !== job.input) continue;
      // `$always` rides every job; edge/ack/source describe one concrete source.
      if (!always && !rowApplies(row, job, input)) continue;
      if (row.is && !matchesIs(row.is, job.value)) continue;
      if (row.if) {
        try {
          if (!evaluate(row.if, (ref) => resolveIn(rt, ref))) continue;
        } catch (error) {
          warn(logId(rt), `condition failed: ${errorText(error)}`);
          continue;
        }
      }
      // A hook, not a handler: it must not swallow the `$self` output sync.
      if (!always) matched = true;
      const jumped = runActions(rt, row.do ?? [], job.depth);
      if (row.goto) {
        transition(rt, row.goto, job.depth, eventCause(job));
        return { matched, stopped: true };
      }
      // A `continue` row leaves the state untouched and lets the rows below
      // react to the same event; a goto (row or action) always ends it.
      if (jumped || row.continue !== true) return { matched, stopped: true };
    }
    return { matched, stopped: false };
  }

  /**
   * An external write to the output (another adapter, a user, a script) moves the
   * machine to the state that stands for that value — first match in declaration
   * order. Several states may share a value (two "on" states with different
   * timeouts); an explicit `$self` row then picks the one meant. A write that
   * already matches the current state changes nothing (D22).
   */
  function syncToOutput(
    rt: Runtime,
    value: unknown,
    depth: number,
    from: string,
  ): void {
    const def = rt.def as MachineLogic;
    const current = rt.state;
    if (current && Object.is(outputValue(rt, current), value)) return;
    for (const name of Object.keys(def.states)) {
      if (Object.is(outputValue(rt, name), value)) {
        transition(
          rt,
          name,
          depth,
          from ? `output changed by ${from}` : "output changed elsewhere",
        );
        return;
      }
    }
  }

  /** A glob (`*`, `?`) as a regular-expression source; everything else literal. */
  function globSource(pattern: string): string {
    return pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*")
      .replace(/\?/g, ".");
  }

  /**
   * A row condition against the event value. Numbers compare numerically; a
   * string value compares as a glob pattern (`*` and `?`), so "On*", "*light"
   * and "*motion*" are one line each (D23).
   */
  function matchesIs(
    is: { op: string; value?: unknown },
    value: unknown,
  ): boolean {
    const pattern = typeof is.value === "string" ? is.value : undefined;
    const text = String(value ?? "");
    const test = (source: string) => new RegExp(source).test(text);
    switch (is.op) {
      case "eq":
        return pattern !== undefined
          ? test(`^${globSource(pattern)}$`)
          : Object.is(value, is.value);
      case "ne":
        return pattern !== undefined
          ? !test(`^${globSource(pattern)}$`)
          : !Object.is(value, is.value);
      case "gt":
        return Number(value) > Number(is.value);
      case "gte":
        return Number(value) >= Number(is.value);
      case "lt":
        return Number(value) < Number(is.value);
      case "lte":
        return Number(value) <= Number(is.value);
      case "startsWith":
        return test(`^${globSource(String(is.value ?? ""))}`);
      case "endsWith":
        return test(`${globSource(String(is.value ?? ""))}$`);
      case "includes":
        return test(globSource(String(is.value ?? "")));
      case "notIncludes":
        return !test(globSource(String(is.value ?? "")));
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

  /**
   * State-owned timers follow the state's life: armed on enter, destroyed on
   * exit and on stop. Delays (later) use the same rule; nothing may outlive
   * the state that created it.
   */
  function armAfter(rt: Runtime, name: string, state: StateDef): void {
    clearTimer(rt);
    if (!state.after) return;
    const ms = parseDuration(state.after.time);
    if (ms === null || ms <= 0) return;
    rt.timer = deps.setTimeout(() => {
      rt.timer = undefined;
      if (rt.state === name) {
        transition(rt, state.after!.goto, 0, `timeout “${state.after!.time}”`);
      }
    }, ms);
  }

  function transition(
    rt: Runtime,
    name: string,
    depth: number,
    reason = "",
  ): void {
    const def = rt.def as MachineLogic;
    const next = def.states[name];
    if (!next) {
      warn(logId(rt), `unknown state ${name}`);
      return;
    }
    const same = rt.state === name;
    const previous = rt.state ? def.states[rt.state] : undefined;
    const oldName = rt.state;
    const because = reason ? ` because of ${reason}` : "";
    if (same) {
      stateLog(rt, `Logic “${def.name}” stays in “${name}”${because}`);
      clearTimer(rt);
    } else {
      if (previous) {
        stateLog(
          rt,
          oldName
            ? `Logic “${def.name}” moves from “${oldName}” to “${name}”${because}`
            : `Logic “${def.name}” starts in “${name}”${because}`,
        );
        runActions(rt, previous.exit ?? [], depth);
      } else {
        stateLog(rt, `Logic “${def.name}” starts in “${name}”${because}`);
      }
      clearTimer(rt);
      rt.state = name;
      runActions(rt, next.enter ?? [], depth);
    }
    armAfter(rt, name, next);
    writeOutput(rt, name, depth, reason);
  }

  /** Runs an action list; true when it contained a `goto` (the state changed
   *  or was re-entered), which ends the current event. */
  function runActions(rt: Runtime, actions: Action[], depth: number): boolean {
    let jumped = false;
    for (const action of actions) {
      if ("set" in action) {
        let value: unknown;
        try {
          value = evaluate(action.set.value, (ref) => resolveIn(rt, ref));
        } catch (error) {
          warn(logId(rt), `set failed: ${errorText(error)}`);
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
        transition(rt, action.goto, depth, "action goto");
        jumped = true;
      } else if ("log" in action) {
        deps.log(
          action.log.level ?? "info",
          logId(rt),
          fillLog(rt, action.log.text),
        );
      }
    }
    return jumped;
  }

  /** `{{ref}}` in a log text is that ref's value, as the row sees it (D24). */
  function fillLog(rt: Runtime, text: string): string {
    return text.replace(/\{\{([^{}]+)\}\}/g, (_, name: string) => {
      const ref = name.trim();
      try {
        const value = resolveIn(rt, ref);
        return value === undefined ? "—" : String(value);
      } catch {
        return `{{${ref}}}`;
      }
    });
  }

  /** Stores a memory value and emits its event; true when it actually wrote
   *  (a `changed` write of the same value does not). */
  function writeMemory(
    name: string,
    value: unknown,
    forward: Forward | undefined,
    depth: number,
    producer: string,
  ): boolean {
    if (
      (forward ?? "changed") === "changed" &&
      memory.has(name) &&
      Object.is(memory.get(name), value)
    ) {
      return false;
    }
    const previous = memory.get(name);
    const hasPrevious = memory.has(name);
    memory.set(name, value);
    emitMemory(name, value, depth + 1, producer, previous, hasPrevious);
    return true;
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
      } else {
        for (const id of input.stateIds) {
          writeState(rt, id, value, ack, forward);
        }
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
      warnOnce(logId(rt), `cannot write ${ref}: not a state or memory name`);
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

  function runFunction(rt: Runtime, depth: number, cause = ""): void {
    const def = rt.def as FunctionLogic;
    if (isNoop(def.expr)) return;
    let value: unknown;
    try {
      value = evaluate(def.expr, (ref) => resolveIn(rt, ref));
    } catch (error) {
      warn(def.id, `expression failed: ${errorText(error)}`);
      return;
    }
    writeOutput(rt, value, depth, cause);
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

  /** The state an external output writes to; a ref may be a variable name. A
   *  "logic" output is the adapter-created state at <namespace>.Logic.<id>. */
  function outputTargetId(rt: Runtime): string | undefined {
    const output = rt.output;
    if (output.scope === "logic") {
      return ownFrom ? `${ownFrom}.Logic.${rt.def.id}` : undefined;
    }
    if (output.scope !== "state") return undefined;
    return resolveStateId(output.ref) ?? output.ref;
  }

  function outputValue(rt: Runtime, value: unknown): unknown {
    const output = rt.output;
    if (output.scope === "memory") return value;
    if (rt.def.kind !== "machine") return coerce(value, output.type);
    const name = String(value);
    if (output.map && name in output.map) return output.map[name];
    if (output.type === "boolean")
      return matchesPattern(name, output.on ?? "On*");
    if (output.type === "string") return name;
    // A number output is the state's index in declaration order.
    const index = Object.keys(rt.def.states).indexOf(name);
    return index < 0 ? 0 : index;
  }

  function matchesPattern(name: string, pattern: string): boolean {
    return new RegExp(`^${globSource(pattern)}$`).test(name);
  }

  function writeOutput(
    rt: Runtime,
    value: unknown,
    depth: number,
    cause = "",
  ): void {
    const because = cause ? ` because of ${cause}` : "";
    const output = rt.output;
    if (output.scope === "memory") {
      const name = output.name ?? rt.def.id;
      const previous = memory.get(name);
      const hasPrevious = memory.has(name);
      rt.lastOutput = value;
      rt.hasOutput = true;
      // The stored memory value is the reference (spec §5.6), not the last
      // write of this logic: a seeded value must not emit an event.
      const wrote = writeMemory(name, value, output.forward, depth, rt.def.id);
      if (wrote) {
        emitLogicOutput(rt, value, depth + 1, previous, hasPrevious);
      }
      return;
    }
    const mapped = outputValue(rt, value);
    const target = outputTargetId(rt);
    if (!target) return;
    if (!forwardAllows(rt, mapped, output.forward)) {
      stateLog(
        rt,
        `skips writing “${target}” — value “${String(mapped)}” is unchanged${because}`,
      );
      return;
    }
    const previous = rt.lastOutput;
    const hasPrevious = rt.hasOutput;
    rt.lastOutput = mapped;
    rt.hasOutput = true;
    noteWrite(target, mapped, rt.def.id);
    stateLog(rt, `writes “${String(mapped)}” to “${target}”${because}`);
    // A command, not a confirmation: devices act on ack=false only.
    deps.write(target, mapped, false);
    emitLogicOutput(rt, mapped, depth + 1, previous, hasPrevious);
  }

  function startMachine(rt: Runtime): void {
    const def = rt.def as MachineLogic;
    const names = Object.keys(def.states);
    if (names.length === 0) return;
    const chosen = chooseStart(rt, def, names);
    rt.init = true;
    // Silent adoption (D27): set the state and nothing else — no exit/enter, no
    // `after` timer, no output command. Only an explicit `$init` goto acts.
    rt.state = chosen;
    const output = rt.output;
    if (output.scope === "memory") {
      // The machine's own state readout, stored without emitting an event.
      memory.set(output.name ?? def.id, chosen);
    } else {
      const target = outputTargetId(rt);
      // Remember what the output holds, so the first transition writes only a
      // real change (`forward: "changed"`), not the value it already sees.
      if (target) {
        rt.lastOutput = deps.read(target);
        rt.hasOutput = true;
      }
    }
    stateLog(rt, `Logic “${def.name}” starts in “${chosen}” because of start`);
    if (def.init?.run === true) {
      // The `$init` rows run after adopting, with $init true.
      handleMachine({
        rt,
        input: "$init",
        value: true,
        previous: false,
        hasPrevious: true,
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
    // A defined mapping (an explicit `map`, or a boolean's implicit `On*`) makes
    // matching the current output the default; a number/string output without a
    // map has no mapping to trust, so it falls through to init.state/start.
    const mappable =
      rt.output.scope !== "memory" &&
      (!!rt.output.map || rt.output.type === "boolean");
    if (
      rt.output.scope !== "memory" &&
      (init?.match === "output" || mappable)
    ) {
      const current = deps.read(outputTargetId(rt) ?? "");
      for (const name of names) {
        if (Object.is(outputValue(rt, name), current)) return name;
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
    if (input.input.from.type === "timer") {
      armOneTimer(rt, input, input.input.from.every, input.name);
    }
    (input.input.timers ?? []).forEach((timer, index) => {
      const key = `${input.name}#${index}`;
      if (typeof timer === "string") {
        armOneTimer(rt, input, timer, key);
      } else if (timer.kind === "astro") {
        armAstroTimer(rt, input, timer, key);
      } else {
        armCronTimer(rt, input, timer, key);
      }
    });
  }

  function fireInputTimer(rt: Runtime, input: InputRuntime): void {
    const previous = input.last;
    input.last = deps.now();
    input.hasLast = true;
    enqueue({
      rt,
      input: input.name,
      value: input.last,
      previous,
      hasPrevious: previous !== undefined,
      depth: 0,
      fromTimer: true,
      meta: { from: "timer", self: true, ts: deps.now() },
    });
  }

  function armOneTimer(
    rt: Runtime,
    input: InputRuntime,
    every: Duration,
    key: string,
  ): void {
    const ms = parseDuration(every);
    if (ms === null || ms <= 0) return;
    const handle = deps.setTimeout(() => {
      rt.timers.delete(key);
      if (!started) return;
      fireInputTimer(rt, input);
      armOneTimer(rt, input, every, key);
    }, ms);
    rt.timers.set(key, handle);
  }

  function armAstroTimer(
    rt: Runtime,
    input: InputRuntime,
    timer: Extract<TimerSpec, { kind: "astro" }>,
    key: string,
  ): void {
    const from = deps.now();
    const next = deps.nextAstro?.(timer.event, timer.offset ?? 0, from);
    if (next === undefined) {
      warnOnce(
        rt.def.id,
        "astro timers need the system latitude/longitude — skipped",
      );
      return;
    }
    const handle = deps.setTimeout(
      () => {
        rt.timers.delete(key);
        if (!started) return;
        fireInputTimer(rt, input);
        armAstroTimer(rt, input, timer, key);
      },
      Math.max(0, next - from),
    );
    rt.timers.set(key, handle);
  }

  function armCronTimer(
    rt: Runtime,
    input: InputRuntime,
    timer: Extract<TimerSpec, { kind: "cron" }>,
    key: string,
  ): void {
    const from = deps.now();
    const next = nextCron(timer, from);
    if (next === undefined) return;
    const handle = deps.setTimeout(
      () => {
        rt.timers.delete(key);
        if (!started) return;
        fireInputTimer(rt, input);
        armCronTimer(rt, input, timer, key);
      },
      Math.max(0, next - from),
    );
    rt.timers.set(key, handle);
  }

  function emitMemory(
    name: string,
    value: unknown,
    depth: number,
    producer: string,
    previous: unknown,
    hasPrevious: boolean,
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
        enqueue({
          rt,
          input: input.name,
          value,
          previous,
          hasPrevious,
          depth,
          meta: {
            from: `memory:${producer}`,
            self: producer === rt.def.id,
            ack: false,
            ts: deps.now(),
          },
        });
      }
    }
  }

  /**
   * A logic's output is also an event source (D29): every machine whose current
   * state has a `$logic.<id>` row is enqueued with the written value. The
   * emitting logic decides with `forward` whether an equal value re-fires.
   */
  function emitLogicOutput(
    producer: Runtime,
    value: unknown,
    depth: number,
    previous: unknown,
    hasPrevious: boolean,
  ): void {
    const input = `$logic.${producer.def.id}`;
    const meta = {
      from: `logic:${producer.def.id}`,
      self: false,
      ack: false,
      ts: deps.now(),
    };
    for (const rt of runtimes) {
      const self = rt === producer;
      // A row naming the logic directly, in the state it is in.
      if (rt.def.kind === "machine" && rt.state) {
        const rows = (rt.def as MachineLogic).states[rt.state]?.on ?? [];
        if (rows.some((row) => row.on === input)) {
          enqueue({
            rt,
            input,
            value,
            previous,
            hasPrevious,
            depth,
            meta: { ...meta, self },
          });
        }
      }
      // A local event input may name the logic output among its states.
      for (const source of rt.inputs.values()) {
        if (source.input.kind !== "event") continue;
        if (source.input.from.type !== "state") continue;
        const refs = [source.input.from.ref, ...(source.input.from.refs ?? [])];
        if (!refs.includes(input)) continue;
        source.last = value;
        source.hasLast = true;
        enqueue({
          rt,
          input: source.name,
          value,
          previous,
          hasPrevious,
          depth,
          meta: { ...meta, self },
        });
      }
    }
  }

  function rowApplies(
    row: OnRow,
    job: Job,
    input: InputRuntime | undefined,
  ): boolean {
    const legacy = input?.input;
    const edge = row.edge ?? (legacy?.mode === "any" ? "any" : "change");
    if (
      edge === "change" &&
      job.hasPrevious &&
      Object.is(job.previous, job.value)
    ) {
      return false;
    }
    // Without a previous value the first event counts as an edge from falsy.
    if (edge === "rising" && !(!job.previous && job.value)) return false;
    if (edge === "falling" && !(job.previous && !job.value)) return false;
    if (!ackMatches(row.ack ?? legacy?.ack, job.meta.ack)) return false;
    const origin =
      !job.fromTimer &&
      (input?.input.from.type === "state" ||
        input?.input.from.type === "memory");
    if (!origin) return true; // timers and $init have no external writer
    const source = row.source ?? legacy?.source ?? "external";
    if (source === "any") return true;
    return source === "self" ? job.meta.self : !job.meta.self;
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
      // The shared start instant: timers and `$start` measure from it (D28).
      const startedAt = deps.now();
      for (const rt of runtimes) {
        for (const input of rt.inputs.values()) armTimer(rt, input);
      }
      // `$start` (D28): after every logic is up, each machine sees one event in
      // the state it adopted, carrying the start timestamp.
      for (const rt of runtimes) {
        if (rt.def.kind !== "machine") continue;
        enqueue({
          rt,
          input: "$start",
          value: startedAt,
          previous: 0,
          hasPrevious: false,
          depth: 0,
          meta: { from: "start", self: true, ts: startedAt },
        });
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
          if (!input.stateIds.includes(change.id)) continue;
          if ((input.input.kind ?? "variable") !== "event") continue;
          const previous = input.lastById.get(change.id);
          const hasPrevious = input.lastById.has(change.id);
          input.lastById.set(change.id, change.val);
          input.last = change.val;
          input.hasLast = true;
          enqueue({
            rt,
            input: input.name,
            value: change.val,
            previous,
            hasPrevious,
            depth: 0,
            meta: {
              from: change.from ?? "",
              self,
              ack: change.ack,
              ts: change.ts,
            },
          });
        }
        // Someone else wrote this logic's own output: the machine follows it, so
        // a wall switch or another adapter moves the state at once (D22).
        if (
          rt.def.kind === "machine" &&
          !self &&
          outputTargetId(rt) === change.id
        ) {
          enqueue({
            rt,
            input: "$self",
            value: change.val,
            hasPrevious: false,
            depth: 0,
            meta: {
              from: change.from ?? "",
              self: false,
              ack: change.ack,
              ts: change.ts,
            },
          });
        }
      }
    },
  };
}
