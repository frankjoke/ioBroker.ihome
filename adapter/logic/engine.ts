import { extractRefs } from "./expr-code";
import { parseDuration } from "./duration";
import {
  createLogicRuntime,
  forEachExpression,
  interpolate,
  isGotoSignal,
  isNoop,
  type LogicRuntime,
  type NameInfo,
} from "./runtime";
import { timerSource } from "./timer-ops";
import { collectRefs, type ResolveVariable } from "./subscriptions";
import {
  createLogicIndex,
  createMemoryMap,
  createStateMap,
  createTimerMap,
  type Binding,
  type TimerBinding,
} from "./registries";
import { createTaskQueue, type FetchLike, type TaskQueue } from "./tasks";
import { createPluginQueue, type PluginQueue } from "./plugin-queue";
import type { PluginReply } from "../plugin-ops";
import { isRecord, logicHasErrors, validateLogicDocument } from "./validate";
import type {
  AstroEvent,
  Expr,
  Forward,
  FunctionLogic,
  Input,
  LogicDef,
  LogicDocument,
  MachineLogic,
  OnRow,
  Output,
  OutputType,
  StateDef,
} from "./types";

export interface StateChange {
  id: string;
  val: unknown;
  ack?: boolean;
  from?: string;
  ts?: number;
  changed?: boolean;
}

/** The live readout of one logic, for the logic list. */
export interface LogicReading {
  /** A machine's current state name. */
  state?: string;
  /** A function's last written value. */
  value?: unknown;
  ts: number;
}

export interface EngineDeps {
  read(id: string): unknown;
  /** The cached state with its metadata; falls back to `read` when absent. */
  readState?(id: string): StateChange | undefined;
  write(id: string, value: unknown, ack: boolean, ts?: number): void;
  log(level: "info" | "warn", logicId: string, message: string): void;
  message(
    level: "info" | "warn" | "error",
    logicId: string,
    message: string,
    timeout?: number,
  ): void;
  notify(
    level: "info" | "warn" | "error",
    logicId: string,
    title: string,
    body: string,
  ): void;
  now(): number;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
  /** Test seam; production uses the Node global. */
  fetch?: FetchLike;
  /** Call an adapter plugin; omitted in tests that do not use plugins. */
  callPlugin?(id: string, payload: unknown): Promise<PluginReply>;
  /** Publish a logic's live readout for the logic list. */
  report?(logicId: string, reading: LogicReading): void;
  resolveVariable?: ResolveVariable;
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

export interface LogicTestResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export interface Engine {
  subscriptions(): string[];
  start(): void;
  /** Apply a new document; only added, changed and removed logics restart. */
  update(doc: LogicDocument): EngineUpdate;
  stop(): void;
  onStateChange(change: StateChange): void;
  memoryValue(name: string): unknown;
  test(logicId: string): LogicTestResult;
}

export interface EngineUpdate {
  added: string[];
  changed: string[];
  removed: string[];
}

interface InputRuntime {
  name: string;
  input: Input;
  /** A state input may name several states: any of them is the same event. */
  stateIds: string[];
  last?: unknown;
  hasLast: boolean;
  /** Value-based `changed` of the last update of this input. */
  lastChanged?: boolean;
  lastTs?: number;
  /** The state the last event came from, when it was one of `stateIds`. */
  lastStateId?: string;
  /** Writer and ack of the last event, which may be a timer or `$logic`. */
  lastFrom?: string;
  lastAck?: boolean;
}

interface Runtime {
  id: string;
  /** Position in the document; dispatch order follows it. */
  seq: number;
  /** What was linked when the runtime was built, for update comparisons. */
  fingerprint: string;
  def: LogicDef;
  inputs: Map<string, InputRuntime>;
  output: Output;
  lastOutput?: unknown;
  hasOutput: boolean;
  /** Machine only: the current state and its `after` timer. */
  state?: string;
  timer?: number;
  /** True only while this logic's start evaluation runs (D19). */
  init: boolean;
  /** The `$start` timestamp while that event is being handled (D28). */
  starting?: number;
  /** Serialized fetch tasks of this logic. */
  tasks?: TaskQueue;
  /** Serialized plugin calls of this logic. */
  pluginTasks?: PluginQueue;
  /** Assigned once the hooks that close over this runtime exist. */
  vm?: LogicRuntime;
}

interface EventMeta {
  /** Writer: an adapter instance, `memory:<logicId>`, `timer`, or `init`. */
  from: string;
  /** True when this very logic caused the change. */
  self: boolean;
  ack?: boolean;
  ts?: number;
}

interface TaskJob {
  run(data: unknown, error: string | null): void;
  data: unknown;
  error: string | null;
  /** Which per-logic queue releases its active slot after the callback. */
  done?: () => void;
}

interface Job {
  rt: Runtime;
  input: string;
  /** What raised the run: a state id, memory name, `$logic.<id>`, timer spec
   *  or a built-in trigger. Read by `$source`. */
  source?: string;
  value: unknown;
  /** The source's value before this update; rows compare edges against it. */
  previous?: unknown;
  hasPrevious: boolean;
  depth: number;
  /** A repeating timer of an event input: no external writer. */
  fromTimer?: boolean;
  meta: EventMeta;
  /** A settled fetch waiting to run its callback. */
  task?: TaskJob;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  // A vm-realm error is not an instance of the host Error.
  if (isRecord(error) && typeof error.message === "string")
    return error.message;
  return String(error);
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
  const memories = createMemoryMap<Runtime>();
  const states = createStateMap<Runtime>();
  const logicIndex = createLogicIndex<Runtime>();
  const issues = validateLogicDocument(doc);
  let declaredMemory = declaredMemoryOf(doc);
  let currentDoc = doc;

  const resolveStateId = (ref: string): string | undefined => {
    if (ref.startsWith("$logic.")) return undefined;
    if (ref.includes(".")) return ref;
    const variable = deps.resolveVariable?.(ref);
    return variable?.kind === "state" ? variable.stateId : undefined;
  };

  /** The state an output writes to, without a runtime (for fingerprints). */
  function defOutputTarget(def: LogicDef): string | undefined {
    const output = def.output;
    if (!output) return undefined;
    if (output.scope === "logic") {
      return ownFrom ? `${ownFrom}.Logic.${def.id}` : undefined;
    }
    if (output.scope !== "state") return undefined;
    return resolveStateId(output.ref) ?? output.ref;
  }

  function fingerprintOf(
    def: LogicDef,
    stateIds: string[],
    declared: Set<string>,
  ): string {
    const refs: string[] = [];
    collectRefs(def, refs);
    forEachExpression(def, (expr) => refs.push(...extractRefs(expr.code)));
    const memoryNames = [...new Set(refs)]
      .filter((ref) => declared.has(ref))
      .sort();
    return JSON.stringify({
      def,
      stateIds,
      outputTarget: defOutputTarget(def),
      memoryNames,
    });
  }

  /** The input states a definition resolves to right now (variables included). */
  function resolvedStateIds(def: LogicDef): string[] {
    const ids: string[] = [];
    const add = (ref: string): void => {
      const id = resolveStateId(ref);
      if (id) ids.push(id);
    };
    for (const input of Object.values(def.inputs ?? {})) {
      if (input.from.type !== "state") continue;
      add(input.from.ref);
      for (const ref of input.from.refs ?? []) add(ref);
    }
    if (def.kind === "machine") {
      for (const state of Object.values(def.states ?? {})) {
        for (const row of state.on ?? []) {
          if (row.on.startsWith("$var.")) add(row.on.slice("$var.".length));
        }
      }
    }
    return ids;
  }

  function declaredMemoryOf(document: LogicDocument): Set<string> {
    const names = new Set<string>(
      (document.memory ?? []).map((entry) => entry.name),
    );
    for (const entry of document.logics) {
      if (entry.output?.scope === "memory") {
        names.add(entry.output.name ?? entry.id);
      }
    }
    return names;
  }

  function logValidationErrors(
    id: string,
    issues: ReturnType<typeof validateLogicDocument>,
  ): void {
    const messages = issues
      .filter((issue) => issue.logicId === id && issue.severity === "error")
      .map((issue) => `${issue.path}: ${issue.message}`)
      .join("; ");
    deps.log("warn", id, `not started — ${messages}`);
  }

  function buildRuntime(
    def: LogicDef,
    seq: number,
    issues: ReturnType<typeof validateLogicDocument>,
    declared: Set<string>,
  ): Runtime | undefined {
    if (def.enabled === false) return undefined;
    if (logicHasErrors(issues, def.id)) {
      logValidationErrors(def.id, issues);
      return undefined;
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
            hasLast: false,
          });
        }
      }
    }
    const rt: Runtime = {
      id: def.id,
      seq,
      def,
      fingerprint: fingerprintOf(
        def,
        [...inputs.values()].flatMap((input) => input.stateIds),
        declared,
      ),
      inputs,
      output: def.output ?? { scope: "memory", name: def.id },
      hasOutput: false,
      init: false,
    };
    rt.tasks = createTaskQueue(
      (task, data, error) => {
        if (error) {
          deps.log("warn", logId(rt), `task failed: ${task.url} — ${error}`);
        }
        enqueue({
          rt,
          input: "$task",
          source: "$task",
          value: undefined,
          hasPrevious: false,
          depth: task.depth,
          meta: { from: "task", self: true, ts: deps.now() },
          task: {
            run: task.run,
            data,
            error,
            done: () => rt.tasks?.done(),
          },
        });
      },
      (message) => deps.log("warn", logId(rt), message),
      deps.fetch ?? (globalThis.fetch as FetchLike | undefined),
    );
    rt.pluginTasks = createPluginQueue(
      deps.callPlugin ??
        (() =>
          Promise.resolve({
            ok: false,
            error: "plugin calls are not available",
          } as PluginReply)),
      (task, data, error) => {
        if (error) {
          deps.log(
            "warn",
            logId(rt),
            `plugin call failed: ${task.id} — ${error}`,
          );
        }
        enqueue({
          rt,
          input: "$task",
          source: "$task",
          value: undefined,
          hasPrevious: false,
          depth: task.depth,
          meta: { from: "task", self: true, ts: deps.now() },
          task: {
            run: task.run,
            data,
            error,
            done: () => rt.pluginTasks?.done(),
          },
        });
      },
      (message) => deps.log("warn", logId(rt), message),
    );
    try {
      rt.vm = createLogicRuntime(def, {
        describe: (name) => describeName(rt, name),
        write: (name, value, ack, forward, depth, ts) =>
          writeTarget(rt, name, value, ack, forward, depth, ts),
        log: (level, message) => deps.log(level, logId(rt), message),
        message: (level, message, timeout) =>
          deps.message(level, logId(rt), message, timeout),
        notify: (level, title, body) =>
          deps.notify(level, logId(rt), title, body),
        fetchJson: (url, options, run, depth) =>
          rt.tasks?.enqueue({ url, options, depth, run }),
        callPlugin: (id, payload, run, depth) =>
          rt.pluginTasks?.enqueue({ id, payload, depth, run }),
        now: () => deps.now(),
        nextAstro: (event, offset, from) =>
          deps.nextAstro?.(event, offset, from),
      });
    } catch (error) {
      deps.log("warn", def.id, errorText(error));
      return undefined;
    }
    return rt;
  }

  let runtimes: Runtime[] = [];
  for (const [seq, def] of doc.logics.entries()) {
    const rt = buildRuntime(def, seq, issues, declaredMemory);
    if (rt) runtimes.push(rt);
  }

  /** Register a runtime's input and output links in the shared maps. */
  function linkRuntime(rt: Runtime): void {
    for (const input of rt.inputs.values()) {
      const from = input.input.from;
      if (from.type === "state") {
        for (const id of input.stateIds) {
          states.link(
            id,
            { owner: rt, input: input.name },
            deps.readState?.(id),
            deps.read(id),
          );
        }
        for (const ref of [from.ref, ...(from.refs ?? [])]) {
          if (ref.startsWith("$logic.")) {
            logicIndex.link(ref, { owner: rt, input: input.name });
          }
        }
      } else if (from.type === "memory") {
        memories.link(from.ref, { owner: rt, input: input.name });
      }
    }
    if (rt.def.kind !== "machine") return;
    const rows = [
      ...Object.values(rt.def.states ?? {}).flatMap((state) => state.on ?? []),
      ...(rt.def.all?.on ?? []),
    ];
    for (const row of rows) {
      if (row.on.startsWith("$logic.")) logicIndex.linkRow(row.on, rt);
    }
    const target = outputTargetId(rt);
    if (target) {
      states.self(target, rt, deps.readState?.(target), deps.read(target));
    }
  }

  function unlinkRuntime(rt: Runtime): void {
    states.unlink(rt);
    memories.unlink(rt);
    logicIndex.unlink(rt);
    timers.remove(rt);
  }

  const queue: Job[] = [];
  /** Writes this engine made, per state id, for self-attribution. */
  const pendingWrites = new Map<
    string,
    Array<{ value: unknown; logicId: string }>
  >();
  let currentMeta: EventMeta = { from: "", self: false };
  /** The job whose code is running, for `$value` and `$previous`. */
  let currentJob: Job | undefined;
  let running = false;
  let started = false;
  let chainSeen = new Set<string>();
  let chainWarned = new Set<string>();

  const timers = createTimerMap<Runtime>({
    now: () => deps.now(),
    setTimeout: deps.setTimeout,
    clearTimeout: deps.clearTimeout,
    nextAstro: deps.nextAstro,
    warn: (logicId, message) => deps.log("warn", logicId, message),
    isStarted: () => started,
    fire: (binding) => fireTimer(binding),
  });

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

  function memoryInfo(name: string): NameInfo {
    const entry = memories.get(name);
    return {
      value: entry?.value,
      ack: true,
      from: entry?.from,
      ts: entry?.ts ?? deps.now(),
      changed: entry?.changed ?? false,
      writable: true,
    };
  }

  function externalInfo(id: string): NameInfo {
    const cached = deps.readState?.(id);
    return {
      value: cached ? cached.val : deps.read(id),
      ack: cached?.ack ?? true,
      from: cached?.from,
      ts: cached?.ts ?? deps.now(),
      changed: cached?.changed ?? false,
      writable: true,
    };
  }

  function inputInfo(input: InputRuntime): NameInfo {
    if (input.input.from.type === "memory") {
      return memoryInfo(input.input.from.ref);
    }
    if (input.input.from.type === "timer") {
      return {
        value: input.last,
        ack: input.lastAck ?? true,
        from: input.lastFrom,
        ts: input.lastTs ?? deps.now(),
        changed: input.lastChanged ?? false,
        writable: false,
      };
    }
    const id =
      input.lastStateId && input.stateIds.includes(input.lastStateId)
        ? input.lastStateId
        : input.stateIds[0];
    const cached = id ? deps.readState?.(id) : undefined;
    return {
      value: input.hasLast ? input.last : id ? deps.read(id) : undefined,
      ack: input.lastAck ?? cached?.ack ?? true,
      from: input.lastFrom ?? cached?.from,
      ts: input.lastTs ?? cached?.ts ?? deps.now(),
      changed: input.lastChanged ?? cached?.changed ?? false,
      writable: true,
    };
  }

  function pseudoInfo(rt: Runtime, ref: string): NameInfo {
    const value =
      ref === "$init"
        ? rt.init
        : ref === "$start"
          ? rt.starting
          : ref === "$from"
            ? currentMeta.from
            : ref === "$self"
              ? currentMeta.self
              : ref === "$ack"
                ? currentMeta.ack
                : ref === "$value"
                  ? currentJob?.value
                  : ref === "$previous"
                    ? currentJob?.hasPrevious
                      ? currentJob.previous
                      : undefined
                    : ref === "$source"
                      ? (currentJob?.source ?? (rt.init ? "$init" : undefined))
                      : ref === "$input"
                        ? currentJob?.input
                        : currentMeta.ts;
    return {
      value,
      ack: currentMeta.ack ?? true,
      from: currentMeta.from,
      ts: currentMeta.ts ?? deps.now(),
      changed: false,
      writable: false,
    };
  }

  function describeName(rt: Runtime, ref: string): NameInfo {
    if (
      ref === "$init" ||
      ref === "$start" ||
      ref === "$from" ||
      ref === "$self" ||
      ref === "$ack" ||
      ref === "$value" ||
      ref === "$previous" ||
      ref === "$input" ||
      ref === "$source" ||
      ref === "$ts"
    ) {
      return pseudoInfo(rt, ref);
    }
    const input = rt.inputs.get(ref);
    if (input) return inputInfo(input);
    if (memories.get(ref) || declaredMemory.has(ref)) return memoryInfo(ref);
    if (ref.includes(".")) return externalInfo(ref);
    const variable = deps.resolveVariable?.(ref);
    if (!variable) {
      return {
        value: undefined,
        ack: true,
        ts: deps.now(),
        changed: false,
        writable: true,
      };
    }
    if (variable.kind === "const") {
      return {
        value: variable.value,
        ack: true,
        from: "variable",
        ts: deps.now(),
        changed: false,
        writable: false,
      };
    }
    return externalInfo(variable.stateId);
  }

  function runExpr(rt: Runtime, expr: Expr, depth: number): unknown {
    if (!rt.vm) throw new Error("expression not compiled");
    return rt.vm.runExpr(expr, depth);
  }

  /** A goto ends the block even when its unknown target cannot transition. */
  function runCode(
    rt: Runtime,
    expr: Expr | undefined,
    depth: number,
  ): "none" | "jumped" | "transitioned" {
    if (!expr) return "none";
    try {
      rt.vm!.runStatements(expr, depth);
      return "none";
    } catch (error) {
      if (isGotoSignal(error)) {
        return transition(rt, error.state, depth, "action goto")
          ? "transitioned"
          : "jumped";
      }
      warn(logId(rt), `action failed: ${errorText(error)}`);
      return "none";
    }
  }

  function externalId(ref: string, rt: Runtime): string | undefined {
    const input = rt.inputs.get(ref);
    if (input) return undefined; // its sources are added explicitly below
    if (memories.get(ref) || declaredMemory.has(ref)) return undefined;
    if (ref.startsWith("$logic.")) return undefined;
    if (ref.includes(".")) return ref;
    const variable = deps.resolveVariable?.(ref);
    return variable?.kind === "state" ? variable.stateId : undefined;
  }

  function subscriptions(): string[] {
    const ids = new Set<string>();
    for (const rt of runtimes) {
      const refs: string[] = [];
      collectRefs(rt.def, refs);
      forEachExpression(rt.def, (expr) => refs.push(...extractRefs(expr.code)));
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
      if (job.task) job.task.done?.();
      return;
    }
    if (job.task) {
      const previousMeta = currentMeta;
      const previousJob = currentJob;
      currentMeta = job.meta;
      currentJob = job;
      try {
        job.task.run(job.task.data, job.task.error);
      } catch (error) {
        warn(logId(job.rt), `task failed: ${errorText(error)}`);
      } finally {
        currentMeta = previousMeta;
        currentJob = previousJob;
        job.task.done?.();
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
    const previousJob = currentJob;
    const previousStarting = job.rt.starting;
    if (job.input === "$start") {
      job.rt.starting = typeof job.value === "number" ? job.value : deps.now();
    }
    currentMeta = job.meta;
    currentJob = job;
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
      currentJob = previousJob;
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
          if (!runExpr(rt, row.if, job.depth)) continue;
        } catch (error) {
          warn(logId(rt), `condition failed: ${errorText(error)}`);
          continue;
        }
      }
      // A hook, not a handler: it must not swallow the `$self` output sync.
      if (!always) matched = true;
      if (row.log?.level) {
        deps.log(row.log.level, logId(rt), fillLog(rt, row.log.text));
      }
      if ((row.mode ?? "goto") === "function") {
        if (runCode(rt, row.do, job.depth) !== "none")
          return { matched, stopped: true };
      } else if (row.goto) {
        transition(rt, row.goto, job.depth, eventCause(job));
        return { matched, stopped: true };
      }
      // A `continue` row leaves the state untouched and lets the rows below
      // react to the same event; a goto always ends it.
      if (row.continue !== true) return { matched, stopped: true };
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
  ): boolean {
    const def = rt.def as MachineLogic;
    const next = def.states[name];
    if (!next) {
      warn(logId(rt), `unknown state ${name}`);
      return false;
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
        // A goto in the block already finalized its own transition.
        if (runCode(rt, previous.exit, depth) === "transitioned") return true;
      } else {
        stateLog(rt, `Logic “${def.name}” starts in “${name}”${because}`);
      }
      clearTimer(rt);
      rt.state = name;
      if (runCode(rt, next.enter, depth) === "transitioned") return true;
    }
    deps.report?.(def.id, { state: rt.state ?? name, ts: deps.now() });
    armAfter(rt, name, next);
    writeOutput(rt, name, depth, reason);
    return true;
  }

  /** `{{ref}}` in a log text is that ref's value, as the row sees it (D24). */
  function fillLog(rt: Runtime, text: string): string {
    return interpolate(text, (name) => describeName(rt, name));
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
    const current = memories.get(name);
    if (
      (forward ?? "changed") === "changed" &&
      current &&
      Object.is(current.value, value)
    ) {
      return false;
    }
    const { previous, hasPrevious } = memories.write(name, value, {
      ts: deps.now(),
      from: producer,
    });
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
    ts?: number,
  ): void {
    if (ref === "$self") {
      writeSelf(rt, value, depth);
      return;
    }
    const input = rt.inputs.get(ref);
    if (input) {
      if (input.input.from.type === "memory") {
        writeMemory(input.input.from.ref, value, forward, depth, rt.def.id);
      } else {
        for (const id of input.stateIds) {
          writeState(rt, id, value, ack, forward, ts);
        }
      }
      return;
    }
    if (declaredMemory.has(ref) || memories.get(ref)) {
      writeMemory(ref, value, forward, depth, rt.def.id);
      return;
    }
    if (ref.includes(".")) {
      writeState(rt, ref, value, ack, forward, ts);
      return;
    }
    const variable = deps.resolveVariable?.(ref);
    if (variable?.kind === "state") {
      writeState(rt, variable.stateId, value, ack, forward, ts);
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
    ts?: number,
  ): void {
    if (
      ts === undefined &&
      (forward ?? "changed") === "changed" &&
      Object.is(deps.read(id), value)
    ) {
      return;
    }
    noteWrite(id, value, rt.def.id);
    deps.write(id, value, ack, ts);
  }

  function runFunction(
    rt: Runtime,
    depth: number,
    cause = "",
  ): LogicTestResult {
    const def = rt.def as FunctionLogic;
    let value: unknown;
    try {
      value =
        def.mode === "statements"
          ? rt.vm!.runStatements(def.expr, depth)
          : runExpr(rt, def.expr, depth);
    } catch (error) {
      const message = errorText(error);
      warn(def.id, `expression failed: ${message}`);
      return { ok: false, error: message };
    }
    // A body without a return says nothing; the expression form keeps its own
    // rule (`noop()` only), so an expression that evaluates to undefined still
    // writes, as it always did.
    if (isNoop(value) || (value === undefined && def.mode === "statements")) {
      return { ok: true, value: undefined };
    }
    if (value && typeof (value as { then?: unknown }).then === "function") {
      // Consume a rejection: an unhandled one would terminate the adapter.
      void Promise.resolve(value).catch(() => {});
      warn(def.id, "expression failed: async is not supported");
      return { ok: false, error: "async is not supported" };
    }
    writeOutput(rt, value, depth, cause);
    return { ok: true, value };
  }

  function coerce(value: unknown, type: OutputType): unknown {
    if (type === "boolean") return Boolean(value);
    if (type === "number" || type === "multistate") return Number(value);
    if (type === "mixed") return value;
    // An object output is stored as JSON text; a string is taken as already
    // serialized, so a fetched JSON string is not quoted a second time.
    if (type === "object") {
      if (typeof value === "string") return value;
      return JSON.stringify(value ?? null);
    }
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
    // A machine state is its index (an ihome output is `multistate`); an
    // explicit number/multistate output asks for the same. A legacy boolean
    // machine output that wrote true/false is upgraded with the state object.
    if (
      output.type === "number" ||
      output.type === "multistate" ||
      (output.scope === "logic" &&
        output.type !== "object" &&
        output.type !== "mixed")
    ) {
      const index = Object.keys(rt.def.states).indexOf(name);
      return index < 0 ? 0 : index;
    }
    if (output.type === "boolean")
      return matchesPattern(name, output.on ?? "On*");
    if (output.type === "string") return name;
    return coerce(value, output.type);
  }

  function matchesPattern(name: string, pattern: string): boolean {
    return new RegExp(`^${globSource(pattern)}$`).test(name);
  }

  /** Object/mixed outputs hold data, not a device command. */
  function isDataOutput(output: { type: OutputType }): boolean {
    return output.type === "object" || output.type === "mixed";
  }

  function writeOutput(
    rt: Runtime,
    value: unknown,
    depth: number,
    cause = "",
  ): void {
    const because = cause ? ` because of ${cause}` : "";
    const output = rt.output;
    // A machine's object output is data, not its state: only `set("$self")`
    // writes it, a transition must not overwrite it with a state name.
    if (
      rt.def.kind === "machine" &&
      output.scope !== "memory" &&
      (output.type === "object" || output.type === "mixed")
    ) {
      return;
    }
    if (output.scope === "memory") {
      const name = output.name ?? rt.def.id;
      const entry = memories.get(name);
      const previous = entry?.value;
      const hasPrevious = entry !== undefined;
      rt.lastOutput = value;
      rt.hasOutput = true;
      if (rt.def.kind === "function") {
        deps.report?.(rt.def.id, { value, ts: deps.now() });
      }
      // The stored memory value is the reference (spec §5.6), not the last
      // write of this logic: a seeded value must not emit an event.
      const wrote = writeMemory(name, value, output.forward, depth, rt.def.id);
      if (wrote) {
        emitLogicOutput(rt, value, depth + 1, previous, hasPrevious);
      }
      return;
    }
    const mapped = outputValue(rt, value);
    if (rt.def.kind === "function") {
      deps.report?.(rt.def.id, { value: mapped, ts: deps.now() });
    }
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
    // A command, not a confirmation: devices act on ack=false only. Object and
    // mixed outputs are data, so those are written with ack=true.
    deps.write(target, mapped, isDataOutput(output));
    emitLogicOutput(rt, mapped, depth + 1, previous, hasPrevious);
  }

  /** `set("$self", value)` from a callback or block: the logic's own output. */
  function writeSelf(rt: Runtime, value: unknown, depth: number): void {
    if (rt.def.kind === "function") {
      writeOutput(rt, value, depth, "set($self)");
      return;
    }
    const output = rt.output;
    if (output.scope === "memory") {
      const name = output.name ?? rt.def.id;
      const entry = memories.get(name);
      const previous = entry?.value;
      const hasPrevious = entry !== undefined;
      rt.lastOutput = value;
      rt.hasOutput = true;
      const wrote = writeMemory(name, value, output.forward, depth, rt.def.id);
      if (wrote) {
        emitLogicOutput(rt, value, depth + 1, previous, hasPrevious);
      }
      return;
    }
    const target = outputTargetId(rt);
    if (!target) return;
    const mapped = coerce(value, output.type);
    if (!forwardAllows(rt, mapped, output.forward)) return;
    const previous = rt.lastOutput;
    const hasPrevious = rt.hasOutput;
    rt.lastOutput = mapped;
    rt.hasOutput = true;
    noteWrite(target, mapped, rt.def.id);
    // Object/mixed outputs are data: confirm them instead of commanding.
    deps.write(target, mapped, isDataOutput(output));
    emitLogicOutput(rt, mapped, depth + 1, previous, hasPrevious);
  }

  function startMachine(rt: Runtime): void {
    const def = rt.def as MachineLogic;
    const names = Object.keys(def.states);
    if (names.length === 0) return;
    const chosen = chooseStart(rt, def, names);
    rt.init = true;
    // Silent adoption (D27): set the state — no exit/enter and no output
    // command. The state's own `after` timer is armed (a timeout is a maximum
    // dwell time). Only an explicit `$init` goto transitions at start.
    rt.state = chosen;
    deps.report?.(def.id, { state: chosen, ts: deps.now() });
    // A timeout is a maximum dwell, so the adopted state gets its timer even
    // though no entry ran. Enter actions and the output stay untouched (D27).
    armAfter(rt, chosen, def.states[chosen]);
    const output = rt.output;
    if (output.scope === "memory") {
      // The machine's own state readout, stored without emitting an event.
      const name = output.name ?? def.id;
      memories.seed(name, chosen, { ts: deps.now(), from: "init" });
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
        source: "$init",
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
      (!!rt.output.map ||
        rt.output.type === "boolean" ||
        (rt.output.scope === "logic" &&
          rt.output.type !== "object" &&
          rt.output.type !== "mixed"));
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
            : runExpr(rt, init.state, 0);
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

  function addInputTimers(rt: Runtime): void {
    for (const input of rt.inputs.values()) {
      const from = input.input.from;
      if (from.type === "timer") {
        const spec = from.spec ?? from.every;
        if (spec) {
          timers.add({
            owner: rt,
            input: input.name,
            spec,
            label: timerSource(spec),
          });
        }
      }
      for (const spec of input.input.timers ?? []) {
        timers.add({
          owner: rt,
          input: input.name,
          spec,
          label: timerSource(spec),
        });
      }
    }
  }

  function fireTimer(binding: TimerBinding<Runtime>): void {
    const rt = binding.owner;
    const input = rt.inputs.get(binding.input);
    if (!input) return;
    const previous = input.last;
    const now = deps.now();
    input.last = now;
    input.hasLast = true;
    input.lastChanged = true;
    input.lastTs = now;
    input.lastStateId = undefined;
    input.lastFrom = "timer";
    input.lastAck = true;
    enqueue({
      rt,
      input: input.name,
      source: binding.label,
      value: now,
      previous,
      hasPrevious: previous !== undefined,
      depth: 0,
      fromTimer: true,
      meta: { from: "timer", self: true, ts: now },
    });
  }

  function emitMemory(
    name: string,
    value: unknown,
    depth: number,
    producer: string,
    previous: unknown,
    hasPrevious: boolean,
  ): void {
    for (const binding of [...memories.links(name)].sort(
      (a, b) => a.owner.seq - b.owner.seq,
    )) {
      const rt = binding.owner;
      const input = rt.inputs.get(binding.input);
      if (!input) continue;
      enqueue({
        rt,
        input: input.name,
        source: name,
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
    const hit = logicIndex.get(input);
    if (!hit) return;
    // Document order; for one logic its state rows come before its inputs, as
    // the loop did before the index existed.
    const items = [
      ...hit.rows.map((owner) => ({ owner, row: true, binding: undefined })),
      ...hit.inputs.map((binding) => ({
        owner: binding.owner,
        row: false,
        binding,
      })),
    ].sort(
      (a, b) => a.owner.seq - b.owner.seq || Number(b.row) - Number(a.row),
    );
    for (const item of items) {
      const rt = item.owner;
      const self = rt === producer;
      if (item.row) {
        const def = rt.def as MachineLogic;
        const rows = [
          ...(rt.state ? (def.states[rt.state]?.on ?? []) : []),
          ...(def.all?.on ?? []),
        ];
        if (!rows.some((row) => row.on === input)) continue;
        enqueue({
          rt,
          input,
          source: input,
          value,
          previous,
          hasPrevious,
          depth,
          meta: { ...meta, self },
        });
        continue;
      }
      const source = rt.inputs.get(item.binding!.input);
      if (!source || source.input.from.type !== "state") continue;
      source.last = value;
      source.hasLast = true;
      source.lastChanged = hasPrevious ? !Object.is(previous, value) : true;
      source.lastTs = meta.ts;
      source.lastStateId = input;
      source.lastFrom = meta.from;
      source.lastAck = meta.ack;
      enqueue({
        rt,
        input: source.name,
        source: input,
        value,
        previous,
        hasPrevious,
        depth,
        meta: { ...meta, self },
      });
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
    memoryValue: (name) => memories.get(name)?.value,
    test(logicId: string): LogicTestResult {
      if (!started) return { ok: false, error: "logic engine is not started" };
      const rt = runtimes.find((entry) => entry.def.id === logicId);
      if (!rt) {
        return {
          ok: false,
          error: "logic is not active — enable and save it first",
        };
      }
      if (rt.def.kind !== "function") {
        return { ok: false, error: "only action logics can be tested" };
      }
      return runFunction(rt, 0, "test");
    },
    update(nextDoc) {
      if (!started) throw new Error("logic engine is not started");
      const nextIssues = validateLogicDocument(nextDoc);
      const nextDeclared = declaredMemoryOf(nextDoc);
      const oldById = new Map(runtimes.map((rt) => [rt.id, rt]));
      const prepared = new Map<string, Runtime>();
      const unchanged: Runtime[] = [];
      const planned = new Set<string>();
      const added: string[] = [];
      const changed: string[] = [];
      for (const [seq, def] of nextDoc.logics.entries()) {
        if (def.enabled === false) continue;
        if (logicHasErrors(nextIssues, def.id)) {
          logValidationErrors(def.id, nextIssues);
          continue;
        }
        planned.add(def.id);
        const old = oldById.get(def.id);
        if (!old) {
          added.push(def.id);
          const rt = buildRuntime(def, seq, nextIssues, nextDeclared);
          if (rt) prepared.set(def.id, rt);
          continue;
        }
        const fingerprint = fingerprintOf(
          def,
          resolvedStateIds(def),
          nextDeclared,
        );
        if (fingerprint === old.fingerprint) {
          old.seq = seq;
          unchanged.push(old);
          continue;
        }
        changed.push(def.id);
        const rt = buildRuntime(def, seq, nextIssues, nextDeclared);
        if (rt) prepared.set(def.id, rt);
      }
      const keep = new Set(unchanged.map((rt) => rt.id));
      const stopping = runtimes.filter((rt) => !keep.has(rt.id));
      const changedSet = new Set(changed);
      const removed = stopping
        .map((rt) => rt.id)
        .filter((id) => !changedSet.has(id));

      // Document memory: untouched entries keep their live value. A removed
      // declaration goes only when no logic output declares the name as well.
      const oldDeclarations = currentDoc.memory ?? [];
      const nextDeclarations = nextDoc.memory ?? [];
      const nextByName = new Map(
        nextDeclarations.map((entry) => [entry.name, entry]),
      );
      for (const entry of nextDeclarations) {
        const old = oldDeclarations.find((prev) => prev.name === entry.name);
        if (
          !old ||
          old.type !== entry.type ||
          !Object.is(old.initial, entry.initial)
        ) {
          memories.seed(entry.name, entry.initial, {
            ts: deps.now(),
            from: "init",
          });
        }
      }
      for (const old of oldDeclarations) {
        if (!nextByName.has(old.name) && !nextDeclared.has(old.name)) {
          memories.remove(old.name);
        }
      }

      for (const rt of stopping) {
        clearTimer(rt);
        rt.tasks?.stop();
        rt.pluginTasks?.stop();
        unlinkRuntime(rt);
        const output = rt.output;
        if (output.scope !== "memory") continue;
        const name = output.name ?? rt.id;
        const declaration = nextByName.get(name);
        if (declaration) {
          memories.seed(name, declaration.initial, {
            ts: deps.now(),
            from: "init",
          });
        } else {
          const shared = nextDoc.logics.some(
            (def) =>
              def.id !== rt.id &&
              def.enabled !== false &&
              !logicHasErrors(nextIssues, def.id) &&
              def.output?.scope === "memory" &&
              (def.output.name ?? def.id) === name,
          );
          // A name another surviving logic also declares is left alone.
          if (!shared) memories.remove(name);
        }
      }

      for (const rt of prepared.values()) linkRuntime(rt);
      runtimes = [...unchanged, ...prepared.values()].sort(
        (a, b) => a.seq - b.seq,
      );
      currentDoc = nextDoc;
      declaredMemory = nextDeclared;

      for (const rt of prepared.values()) {
        if (rt.def.kind !== "function") continue;
        rt.init = true;
        if (rt.def.init?.run !== false) runFunction(rt, 0);
        rt.init = false;
      }
      for (const rt of prepared.values()) {
        if (rt.def.kind === "machine") startMachine(rt);
      }
      for (const rt of prepared.values()) addInputTimers(rt);
      timers.armAll();
      const startedAt = deps.now();
      for (const rt of prepared.values()) {
        if (rt.def.kind !== "machine") continue;
        enqueue({
          rt,
          input: "$start",
          source: "$start",
          value: startedAt,
          previous: 0,
          hasPrevious: false,
          depth: 0,
          meta: { from: "start", self: true, ts: startedAt },
        });
      }
      return { added, changed, removed };
    },
    start() {
      if (started) return;
      started = true;
      for (const rt of runtimes) linkRuntime(rt);
      for (const entry of currentDoc.memory ?? []) {
        memories.seed(entry.name, entry.initial, {
          ts: deps.now(),
          from: "init",
        });
      }
      // Seed every state-backed input from the warmed cache: old = current,
      // no event. The first real update then compares against the state at
      // start (the EState pattern), instead of counting as an edge.
      for (const rt of runtimes) {
        for (const input of rt.inputs.values()) {
          for (const id of input.stateIds) {
            const cached = deps.readState?.(id);
            const value = cached ? cached.val : deps.read(id);
            if (!cached && value === undefined) continue;
            input.last = value;
            input.hasLast = true;
            input.lastChanged = false;
            input.lastTs = cached?.ts;
            input.lastFrom = cached?.from;
            input.lastAck = cached?.ack;
            input.lastStateId = id;
          }
        }
      }
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
      for (const rt of runtimes) addInputTimers(rt);
      timers.armAll();
      // `$start` (D28): after every logic is up, each machine sees one event in
      // the state it adopted, carrying the start timestamp.
      for (const rt of runtimes) {
        if (rt.def.kind !== "machine") continue;
        enqueue({
          rt,
          input: "$start",
          source: "$start",
          value: startedAt,
          previous: 0,
          hasPrevious: false,
          depth: 0,
          meta: { from: "start", self: true, ts: startedAt },
        });
      }
    },
    stop() {
      timers.stop();
      for (const rt of runtimes) {
        clearTimer(rt);
        rt.tasks?.stop();
        rt.pluginTasks?.stop();
        unlinkRuntime(rt);
      }
      started = false;
      queue.length = 0;
      chainSeen = new Set<string>();
      chainWarned = new Set<string>();
    },
    onStateChange(change) {
      if (!started) return;
      const writer = claimWrite(change.id, change.from ?? "", change.val);
      const hit = states.change(change.id, change);
      if (!hit) return;
      const items = [
        ...hit.links.map((binding) => ({
          owner: binding.owner,
          self: false,
          binding: binding as Binding<Runtime> | undefined,
        })),
        ...hit.selves.map((owner) => ({
          owner,
          self: true,
          binding: undefined,
        })),
      ].sort(
        (a, b) => a.owner.seq - b.owner.seq || Number(a.self) - Number(b.self),
      );
      for (const item of items) {
        const rt = item.owner;
        if (item.self) {
          if (writer === rt.def.id) continue;
          enqueue({
            rt,
            input: "$self",
            source: "$self",
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
          continue;
        }
        const input = rt.inputs.get(item.binding!.input);
        if (!input) continue;
        input.last = change.val;
        input.hasLast = true;
        input.lastChanged = hit.entry.changed;
        input.lastTs = change.ts ?? deps.now();
        input.lastStateId = change.id;
        input.lastFrom = change.from;
        input.lastAck = change.ack;
        enqueue({
          rt,
          input: input.name,
          source: change.id,
          value: change.val,
          previous: hit.previous,
          hasPrevious: hit.hasPrevious,
          depth: 0,
          meta: {
            from: change.from ?? "",
            self: writer === rt.def.id,
            ack: change.ack,
            ts: change.ts,
          },
        });
      }
    },
  };
}
