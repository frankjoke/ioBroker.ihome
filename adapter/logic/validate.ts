import { parseDuration } from "./duration";
import {
  checkExpression,
  checkStatement as checkStatementCode,
  extractGotos,
  extractRefCalls,
} from "./expr-code";
import { migrateActionDocument } from "./migrate-actions";
import { migrateDocument } from "./migrate-expr";
import { isAstroEvent, parseCronAt } from "./timer-ops";
import { OPERATORS } from "./types";
import type {
  FunctionLogic,
  Input,
  LogicDocument,
  MachineLogic,
  MemoryDecl,
  OnRow,
  Output,
  StateDef,
} from "./types";

export interface Issue {
  logicId?: string;
  path: string;
  message: string;
  severity: "error" | "warn";
}

/**
 * The document as the adapter and the SPA may use it, or null when it is not
 * one: not JSON, not an object, not `version: 1`/`2`/`3`, or no `logics` array. A
 * v1 document is migrated in memory. A null is never a reason to write: the
 * caller leaves the stored document alone.
 */
export function parseLogicDocument(raw: unknown): LogicDocument | null {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const doc = value as { version?: unknown; logics?: unknown };
  if (doc.version === 3 && Array.isArray(doc.logics)) {
    return doc as LogicDocument;
  }
  if (doc.version === 2 && Array.isArray(doc.logics)) {
    try {
      return migrateActionDocument(value);
    } catch {
      return null;
    }
  }
  if (doc.version === 1 && Array.isArray(doc.logics)) {
    try {
      return migrateActionDocument(migrateDocument(value));
    } catch {
      return null;
    }
  }
  return null;
}

export function logicHasErrors(issues: Issue[], logicId: string): boolean {
  return issues.some(
    (issue) => issue.logicId === logicId && issue.severity === "error",
  );
}

const OPS_NEEDING_VALUE = new Set<string>(OPERATORS);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function validateLogicDocument(doc: LogicDocument): Issue[] {
  const issues: Issue[] = [];
  const add = (
    logicId: string,
    path: string,
    message: string,
    severity: Issue["severity"] = "error",
  ) => issues.push({ logicId, path, message, severity });

  const seenIds = new Set<string>();
  const logicIds = new Set<string>(
    (Array.isArray(doc.logics) ? doc.logics : []).map((logic) => logic.id),
  );
  if (doc.memory !== undefined && !Array.isArray(doc.memory)) {
    issues.push({
      path: "memory",
      message: "memory must be an array",
      severity: "error",
    });
  }
  const memoryDecls = Array.isArray(doc.memory) ? doc.memory : [];
  const memoryNames = new Set<string>(memoryDecls.map((m) => m.name));

  // Memory declarations: a duplicate name with a different type is the only
  // conflict the document can express.
  const memoryTypes = new Map<string, string>();
  for (const entry of memoryDecls as MemoryDecl[]) {
    if (typeof entry?.name !== "string" || !entry.name) {
      issues.push({
        path: "memory",
        message: "memory entry without a name",
        severity: "error",
      });
      continue;
    }
    const previous = memoryTypes.get(entry.name);
    if (previous && previous !== entry.type) {
      issues.push({
        path: `memory.${entry.name}`,
        message: `memory type ${entry.type} conflicts with ${previous}`,
        severity: "warn",
      });
    }
    memoryTypes.set(entry.name, entry.type);
  }

  for (const logic of doc.logics ?? []) {
    if (!isRecord(logic)) {
      issues.push({
        path: "logics",
        message: "logic is not an object",
        severity: "error",
      });
      continue;
    }
    if (typeof logic.id !== "string" || !logic.id) {
      issues.push({
        path: "logics",
        message: "logic without an id",
        severity: "error",
      });
      continue;
    }
    const id = logic.id;
    if (seenIds.has(id)) add(id, "id", "duplicate logic id");
    seenIds.add(id);

    const inputs = (logic.inputs ?? {}) as Record<string, Input>;
    const inputNames = new Set(Object.keys(inputs));
    for (const [name, input] of Object.entries(inputs)) {
      const source = input?.from;
      const timers = input?.timers;
      if (timers !== undefined) {
        if ((input.kind ?? "variable") !== "event") {
          add(
            id,
            `inputs.${name}.timers`,
            "only an event can repeat on a timer",
          );
        }
        if (!Array.isArray(timers)) {
          add(id, `inputs.${name}.timers`, "timers must be an array");
        } else {
          timers.forEach((timer, index) => {
            const path = `inputs.${name}.timers.${index}`;
            if (typeof timer === "string") {
              const ms = parseDuration(timer);
              if (ms === null || ms <= 0) add(id, path, "invalid duration");
              return;
            }
            if (!isRecord(timer)) {
              add(id, path, "invalid timer");
              return;
            }
            if (timer.kind === "astro") {
              if (!isAstroEvent(String(timer.event))) {
                add(id, `${path}.event`, `unknown astro event`);
              }
              if (
                timer.offset !== undefined &&
                !Number.isFinite(timer.offset)
              ) {
                add(id, `${path}.offset`, "offset must be minutes");
              }
            } else if (timer.kind === "cron") {
              if (typeof timer.at !== "string" || !parseCronAt(timer.at)) {
                add(
                  id,
                  `${path}.at`,
                  "time is HH:MM[:SS]; * is allowed per part, but not all",
                );
              }
              const days = timer.days;
              if (
                days !== undefined &&
                days !== "*" &&
                (!Array.isArray(days) ||
                  days.some(
                    (day) => !Number.isInteger(day) || day < 0 || day > 6,
                  ))
              ) {
                add(id, `${path}.days`, "days are 0-6 or *");
              }
            } else {
              add(id, path, "unknown timer kind");
            }
          });
        }
      }
      if (!isRecord(source)) {
        add(id, `inputs.${name}.from`, "input without a source");
      } else if (source.type === "timer") {
        const every = parseDuration(source.every as string);
        if (every === null || every <= 0) {
          add(id, `inputs.${name}.from.every`, "invalid duration");
        }
        if ((input.kind ?? "variable") === "variable") {
          add(id, `inputs.${name}.from.type`, "a variable cannot be a timer");
        }
      } else if (source.type === "state" || source.type === "memory") {
        const hasTimers =
          input.kind === "event" &&
          Array.isArray(input.timers) &&
          input.timers.length > 0;
        if (typeof source.ref !== "string" || (!source.ref && !hasTimers)) {
          add(id, `inputs.${name}.from.ref`, "source without a ref");
        }
        if (source.type === "state" && source.refs !== undefined) {
          if (
            !Array.isArray(source.refs) ||
            source.refs.some((ref) => typeof ref !== "string" || !ref)
          ) {
            add(
              id,
              `inputs.${name}.from.refs`,
              "every extra state needs an id",
            );
          }
        }
        if (source.type === "state" && input.kind === "event") {
          const refs = [source.ref, ...(source.refs ?? [])];
          for (const ref of refs) {
            if (typeof ref !== "string" || !ref.startsWith("$logic.")) {
              continue;
            }
            const sourceId = ref.slice("$logic.".length);
            if (!logicIds.has(sourceId)) {
              add(id, `inputs.${name}.from.ref`, `unknown logic ${sourceId}`);
            }
          }
        }
        if (
          input.kind !== undefined &&
          input.kind !== "variable" &&
          input.kind !== "event"
        ) {
          add(id, `inputs.${name}.kind`, "unknown input kind");
        }
        if ((input.kind ?? "variable") === "variable") {
          if (source.type === "state" && (source.refs?.length ?? 0) > 0) {
            add(id, `inputs.${name}.from.refs`, "a variable has one source");
          }
        }
        if (
          input.source !== undefined &&
          input.source !== "external" &&
          input.source !== "self" &&
          input.source !== "any"
        ) {
          add(id, `inputs.${name}.source`, "unknown event source");
        }
      } else {
        add(id, `inputs.${name}.from.type`, "unknown source type");
      }
    }

    if (logic.kind === "function") {
      const fn = logic as FunctionLogic;
      if (!("expr" in fn) || fn.expr == null) {
        add(id, "expr", "function logic without an expression");
      } else {
        checkExpr(fn.expr, (path, message) => add(id, path, message), "expr");
      }
      const hasEvent = Object.values(inputs).some(
        (input) => input?.kind === "event" || input?.from?.type === "timer",
      );
      if (!hasEvent) {
        add(
          id,
          "inputs",
          "function logic has no event input; it runs once at start",
          "warn",
        );
      }
      checkOutput(id, logic.output, new Set(), add);
      if (logic.init?.state !== undefined || logic.init?.match !== undefined) {
        add(
          id,
          "init",
          "init.state/init.match are ignored for function logics",
          "warn",
        );
      }
    } else if (logic.kind === "machine") {
      if (!isRecord(logic.states)) {
        add(id, "states", "machine has no state object");
        continue;
      }
      const states = logic.states as Record<string, StateDef>;
      const stateNames = Object.keys(states);
      if (stateNames.length === 0) add(id, "states", "machine has no states");
      if (logic.start !== undefined && !stateNames.includes(logic.start)) {
        add(id, "start", `unknown start state ${String(logic.start)}`);
      }
      for (const stateName of stateNames) {
        const state = states[stateName] ?? {};
        const path = `states.${stateName}`;
        if (state.after) {
          const after = parseDuration(state.after.time);
          if (after === null || after <= 0) {
            add(id, `${path}.after.time`, "invalid duration");
          }
          if (!stateNames.includes(state.after.goto)) {
            add(id, `${path}.after.goto`, `unknown state ${state.after.goto}`);
          }
        }
        for (const key of ["enter", "exit"] as const) {
          if (state[key] !== undefined) {
            checkActionCode(
              id,
              state[key],
              `${path}.${key}`,
              inputNames,
              memoryNames,
              stateNames,
              add,
            );
          }
        }
        if (state.on !== undefined && !Array.isArray(state.on)) {
          add(id, `${path}.on`, "on must be an array of rows");
        } else {
          (Array.isArray(state.on) ? state.on : []).forEach((row, index) =>
            checkRow(
              id,
              row,
              `${path}.on.${index}`,
              inputNames,
              inputs,
              memoryNames,
              stateNames,
              logicIds,
              add,
            ),
          );
        }
      }
      const all = logic.all;
      if (all !== undefined) {
        if (!isRecord(all)) {
          add(id, "all", "all must be an object");
        } else {
          const extra = all as unknown as Partial<StateDef>;
          if (extra.enter || extra.exit || extra.after) {
            add(id, "all", "$all has no enter/exit/after", "warn");
          }
          if (all.on !== undefined && !Array.isArray(all.on)) {
            add(id, "all.on", "on must be an array of rows");
          } else {
            (Array.isArray(all.on) ? all.on : []).forEach((row, index) =>
              checkRow(
                id,
                row,
                `all.on.${index}`,
                inputNames,
                inputs,
                memoryNames,
                stateNames,
                logicIds,
                add,
              ),
            );
          }
        }
      }
      checkOutput(id, logic.output, new Set(stateNames), add);
      checkInit(id, logic, stateNames, add);
    } else {
      add(id, "kind", "unknown logic kind");
    }
  }

  return issues.sort(
    (a, b) =>
      (a.logicId ?? "").localeCompare(b.logicId ?? "") ||
      a.path.localeCompare(b.path),
  );
}

type Add = (
  logicId: string,
  path: string,
  message: string,
  severity?: Issue["severity"],
) => void;

function checkOutput(
  id: string,
  output: Output | undefined,
  stateNames: Set<string>,
  add: Add,
): void {
  if (!output) return;
  if (output.scope === "memory") return;
  if (output.scope === "logic") {
    // The adapter creates and names the state; only the type and mapping matter.
    if (
      output.type !== "boolean" &&
      output.type !== "number" &&
      output.type !== "string"
    ) {
      add(id, "output.type", "unknown output type");
    }
    if (output.on !== undefined && typeof output.on !== "string") {
      add(id, "output.on", "on must be a state-name pattern");
    }
    if (output.unit !== undefined && typeof output.unit !== "string") {
      add(id, "output.unit", "unit must be a string");
    }
    return;
  }
  if (output.scope !== "state") {
    add(id, "output.scope", "unknown output scope");
    return;
  }
  if (typeof output.ref !== "string" || !output.ref) {
    add(id, "output.ref", "output without a ref");
  }
  if (
    output.type !== "boolean" &&
    output.type !== "number" &&
    output.type !== "string"
  ) {
    add(id, "output.type", "unknown output type");
  }
  if (output.on !== undefined && typeof output.on !== "string") {
    add(id, "output.on", "on must be a state-name pattern");
  }
  // Map rules only apply to machines, but the ref/type checks always do.
  if (stateNames.size === 0) return;
  if (output.map === undefined) return;
  if (!isRecord(output.map)) {
    add(id, "output.map", "map must be an object");
    return;
  }
  for (const state of stateNames) {
    if (!(state in output.map)) {
      add(id, "output.map", `no map value for state ${state}`);
    }
  }
}

function checkInit(
  id: string,
  logic: MachineLogic,
  stateNames: string[],
  add: Add,
): void {
  const init = logic.init;
  if (!init) return;
  if (init.match !== undefined) {
    const output = logic.output;
    if (
      init.match !== "output" ||
      (output?.scope !== "state" && output?.scope !== "logic")
    ) {
      add(id, "init.match", "match needs an external output state");
    }
  }
  if (init.state !== undefined) {
    if (typeof init.state === "string") {
      if (!stateNames.includes(init.state)) {
        add(id, "init.state", `unknown state ${init.state}`);
      }
    } else {
      checkExpr(init.state, (path, message) =>
        add(id, `init.state${path ? `.${path}` : ""}`, message),
      );
    }
  }
}

function checkRow(
  id: string,
  row: OnRow,
  path: string,
  inputNames: Set<string>,
  inputs: Record<string, Input>,
  memoryNames: Set<string>,
  stateNames: string[],
  logicIds: Set<string>,
  add: Add,
): void {
  if (
    row?.edge !== undefined &&
    row.edge !== "change" &&
    row.edge !== "rising" &&
    row.edge !== "falling" &&
    row.edge !== "any"
  ) {
    add(id, `${path}.edge`, "unknown edge");
  }
  if (
    row?.ack !== undefined &&
    row.ack !== "any" &&
    row.ack !== "true" &&
    row.ack !== "false"
  ) {
    add(id, `${path}.ack`, "unknown ack filter");
  }
  if (
    row?.source !== undefined &&
    row.source !== "external" &&
    row.source !== "self" &&
    row.source !== "any"
  ) {
    add(id, `${path}.source`, "unknown event source");
  }
  const input = row?.on;
  if (
    input === "$init" ||
    input === "$self" ||
    input === "$start" ||
    input === "$always"
  ) {
    // Built-in machine triggers (D19, D22, D28, $always); only machines have rows.
  } else if (typeof input === "string" && input.startsWith("$var.")) {
    // A global state variable (D30); resolved and subscribed at load.
    if (!input.slice("$var.".length).trim()) {
      add(id, `${path}.on`, "empty variable name");
    }
  } else if (typeof input === "string" && input.startsWith("$logic.")) {
    // Another logic's output (D29): it must still exist.
    const source = input.slice("$logic.".length);
    if (!logicIds.has(source)) {
      add(id, `${path}.on`, `unknown logic ${source}`);
    }
  } else if (typeof input !== "string" || !inputNames.has(input)) {
    add(id, `${path}.on`, `unknown input ${String(input)}`);
  } else {
    const isEvent =
      inputs[input]?.kind === "event" || inputs[input]?.from?.type === "timer";
    if (!isEvent) add(id, `${path}.on`, `input ${input} is not an event`);
  }
  if (row?.is) {
    if (!isRecord(row.is) || !row.is.op) {
      add(id, `${path}.is`, "is without an operator");
    } else if (!OPS_NEEDING_VALUE.has(row.is.op)) {
      add(id, `${path}.is.op`, `unknown operator ${String(row.is.op)}`);
    } else if (row.is.value === undefined) {
      add(id, `${path}.is.value`, `operator ${row.is.op} needs a value`);
    } else if (isRecord(row.is.value)) {
      add(id, `${path}.is.value`, "is.value must be a plain value");
    }
  }
  if (row?.if) {
    checkExpr(row.if, (p, message) =>
      add(id, `${path}.if${p ? `.${p}` : ""}`, message),
    );
  }
  if (
    row?.log !== undefined &&
    (!isRecord(row.log) || typeof row.log.text !== "string")
  ) {
    add(id, `${path}.log.text`, "log without text");
  } else if (
    row?.log?.level !== undefined &&
    row.log.level !== "info" &&
    row.log.level !== "warn"
  ) {
    add(id, `${path}.log.level`, "unknown log level");
  }
  if (
    row?.mode !== undefined &&
    row.mode !== "goto" &&
    row.mode !== "function"
  ) {
    add(id, `${path}.mode`, "unknown row mode");
  }
  if (row?.goto !== undefined && !stateNames.includes(row.goto)) {
    add(id, `${path}.goto`, `unknown state ${row.goto}`);
  }
  if (row?.do !== undefined) {
    checkActionCode(
      id,
      row.do,
      `${path}.do`,
      inputNames,
      memoryNames,
      stateNames,
      add,
    );
  }
  const jumps =
    row?.mode === "function"
      ? typeof row.do?.code === "string" && extractGotos(row.do.code).length > 0
      : row?.goto !== undefined;
  if (row?.continue === true && jumps) {
    add(
      id,
      `${path}.continue`,
      "a goto ends the event; continue has no effect",
      "warn",
    );
  }
}

function checkActionCode(
  id: string,
  expr: unknown,
  path: string,
  inputNames: Set<string>,
  memoryNames: Set<string>,
  stateNames: string[],
  add: Add,
): void {
  if (!isRecord(expr) || typeof expr.code !== "string") {
    add(id, path, "action has no code");
    return;
  }
  const message = checkStatementCode(expr.code);
  if (message) {
    add(id, path, message);
    return;
  }
  for (const call of extractRefCalls(expr.code)) {
    if (
      call.fn === "set" &&
      !call.name.includes(".") &&
      !inputNames.has(call.name) &&
      !memoryNames.has(call.name)
    ) {
      add(
        id,
        path,
        `unknown ref ${call.name} (not a state id, input or memory name)`,
        "warn",
      );
    }
  }
  for (const target of extractGotos(expr.code)) {
    if (!stateNames.includes(target)) add(id, path, `unknown state ${target}`);
  }
}

function checkExpr(
  expr: unknown,
  add: (path: string, message: string) => void,
  path = "",
): void {
  if (!isRecord(expr) || typeof expr.code !== "string") {
    add(path, "expression has no code");
    return;
  }
  const message = checkExpression(expr.code);
  if (message) add(path, message);
}
