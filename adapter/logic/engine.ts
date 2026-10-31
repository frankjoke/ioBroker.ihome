import { evaluate } from "./expr";
import { logicHasErrors, validateLogicDocument } from "./validate";
import type {
  Forward,
  FunctionLogic,
  Input,
  LogicDef,
  LogicDocument,
  Output,
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
}

interface Job {
  rt: Runtime;
  input: string;
  value: unknown;
  depth: number;
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
    });
  }

  const queue: Job[] = [];
  let running = false;
  let started = false;
  let chainSeen = new Set<string>();
  let chainWarned = new Set<string>();

  const warn = (logicId: string, message: string) =>
    deps.log("warn", logicId, message);

  function resolveIn(rt: Runtime, ref: string): unknown {
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
    const key = `${job.rt.def.id}|${job.input}|${JSON.stringify(job.value)}`;
    if (chainSeen.has(key)) {
      const warnKey = `loop:${job.rt.def.id}`;
      if (!chainWarned.has(warnKey)) {
        chainWarned.add(warnKey);
        warn(job.rt.def.id, "possible loop, event dropped");
      }
      return;
    }
    chainSeen.add(key);
    if (job.rt.def.kind === "function") {
      runFunction(job.rt, job.depth);
    }
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

  function writeOutput(rt: Runtime, value: unknown, depth: number): void {
    const output = rt.output;
    if (output.scope === "memory") {
      const name = output.name ?? rt.def.id;
      if (!forwardAllows(rt, value, output.forward)) return;
      memory.set(name, value);
      rt.lastOutput = value;
      rt.hasOutput = true;
      emitMemory(name, value, depth + 1);
      return;
    }
    const coerced = coerce(value, output.type);
    if (!forwardAllows(rt, coerced, output.forward)) return;
    rt.lastOutput = coerced;
    rt.hasOutput = true;
    deps.write(output.ref, coerced, true);
  }

  function emitMemory(name: string, value: unknown, depth: number): void {
    for (const rt of runtimes) {
      for (const input of rt.inputs.values()) {
        if (
          input.input.kind === "event" &&
          input.input.from.type === "memory" &&
          input.input.from.ref === name
        ) {
          enqueue({ rt, input: input.name, value, depth });
        }
      }
    }
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
      for (const rt of runtimes) {
        if (rt.def.kind === "function") runFunction(rt, 0);
      }
    },
    stop() {
      started = false;
      queue.length = 0;
      chainSeen = new Set<string>();
      chainWarned = new Set<string>();
    },
    onStateChange(change) {
      if (!started) return;
      if (ownFrom && change.from?.startsWith(ownFrom)) return;
      for (const rt of runtimes) {
        for (const input of rt.inputs.values()) {
          if (input.stateId !== change.id) continue;
          if ((input.input.kind ?? "variable") !== "event") continue;
          if (input.input.mode === "any") {
            // every update counts, even the same value
          } else if (input.hasLast && Object.is(input.last, change.val)) {
            input.last = change.val;
            continue;
          }
          if (!ackMatches(input.input.ack, change.ack)) continue;
          input.last = change.val;
          input.hasLast = true;
          enqueue({ rt, input: input.name, value: change.val, depth: 0 });
        }
      }
    },
  };
}
