import { parseDuration } from "./duration";
import type {
  Action,
  Expr,
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
 * one: not JSON, not an object, not `version: 1`, or no `logics` array. A null
 * is never a reason to write: the caller leaves the stored document alone.
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
  const doc = value as Partial<LogicDocument>;
  if (doc.version !== 1 || !Array.isArray(doc.logics)) return null;
  return doc as LogicDocument;
}

export function logicHasErrors(issues: Issue[], logicId: string): boolean {
  return issues.some(
    (issue) => issue.logicId === logicId && issue.severity === "error",
  );
}

const OPS_NEEDING_VALUE = new Set(["eq", "ne", "gt", "gte", "lt", "lte"]);

function isRecord(value: unknown): value is Record<string, unknown> {
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
      if (!isRecord(source)) {
        add(id, `inputs.${name}.from`, "input without a source");
      } else if (source.type === "timer") {
        const every = parseDuration(source.every as string);
        if (every === null || every <= 0) {
          add(id, `inputs.${name}.from.every`, "invalid duration");
        }
      } else if (source.type === "state" || source.type === "memory") {
        if (typeof source.ref !== "string" || !source.ref) {
          add(id, `inputs.${name}.from.ref`, "source without a ref");
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
        walkExpr(fn.expr, true, (path, message) => add(id, path, message));
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
        add(id, "init", "init.state/init.match are ignored for function logics", "warn");
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
        (state.enter ?? []).forEach((action, index) =>
          checkAction(
            id,
            action,
            `${path}.enter.${index}`,
            inputNames,
            memoryNames,
            stateNames,
            add,
          ),
        );
        (state.exit ?? []).forEach((action, index) =>
          checkAction(
            id,
            action,
            `${path}.exit.${index}`,
            inputNames,
            memoryNames,
            stateNames,
            add,
          ),
        );
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
              add,
            ),
          );
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
  // Map rules only apply to machines, but the ref/type checks always do.
  if (stateNames.size === 0) return;
  if (output.type === "number" && !output.map) {
    add(id, "output.map", "a number output needs a map for every state");
    return;
  }
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
      output?.scope !== "state" ||
      !output.map
    ) {
      add(
        id,
        "init.match",
        "match needs an external output state with a complete map",
      );
    }
  }
  if (init.state !== undefined) {
    if (typeof init.state === "string") {
      if (!stateNames.includes(init.state)) {
        add(id, "init.state", `unknown state ${init.state}`);
      }
    } else {
      walkExpr(init.state, false, (path, message) =>
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
  add: Add,
): void {
  const input = row?.on;
  if (input === "$init") {
    // The built-in start trigger (D19); only machines have rows.
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
    } else if (OPS_NEEDING_VALUE.has(row.is.op) && row.is.value === undefined) {
      add(id, `${path}.is.value`, `operator ${row.is.op} needs a value`);
    } else if (isRecord(row.is.value)) {
      add(id, `${path}.is.value`, "is.value must be a plain value");
    }
  }
  if (row?.if) {
    walkExpr(row.if, false, (p, message) =>
      add(id, `${path}.if${p ? `.${p}` : ""}`, message),
    );
  }
  (row?.do ?? []).forEach((action, index) =>
    checkAction(
      id,
      action,
      `${path}.do.${index}`,
      inputNames,
      memoryNames,
      stateNames,
      add,
    ),
  );
  if (row?.goto !== undefined && !stateNames.includes(row.goto)) {
    add(id, `${path}.goto`, `unknown state ${row.goto}`);
  }
}

function checkAction(
  id: string,
  action: Action,
  path: string,
  inputNames: Set<string>,
  memoryNames: Set<string>,
  stateNames: string[],
  add: Add,
): void {
  if (!isRecord(action)) {
    add(id, path, "action is not an object");
    return;
  }
  if ("set" in action) {
    const set = action.set;
    if (!isRecord(set) || !isRecord(set.target)) {
      add(id, `${path}.set`, "set without a target");
      return;
    }
    if (typeof set.target.ref !== "string" || !set.target.ref) {
      add(id, `${path}.set.target.ref`, "set target without a ref");
    } else if (
      !set.target.ref.includes(".") &&
      !inputNames.has(set.target.ref) &&
      !memoryNames.has(set.target.ref)
    ) {
      add(
        id,
        `${path}.set.target.ref`,
        `unknown ref ${set.target.ref} (not a state id, input or memory name)`,
        "warn",
      );
    }
    if (!set.value) add(id, `${path}.set.value`, "set without a value");
    else
      walkExpr(set.value, false, (p, message) =>
        add(id, `${path}.set.value${p ? `.${p}` : ""}`, message),
      );
  } else if ("goto" in action) {
    if (!stateNames.includes(action.goto)) {
      add(id, `${path}.goto`, `unknown state ${action.goto}`);
    }
  } else if ("log" in action) {
    if (typeof action.log?.text !== "string") {
      add(id, `${path}.log.text`, "log without text");
    }
  } else {
    add(id, path, "unknown action");
  }
}

function walkExpr(
  expr: Expr | { noop: true } | undefined,
  allowNoop: boolean,
  add: (path: string, message: string) => void,
  path = "",
): void {
  if (!isRecord(expr)) {
    add(path, "expression is not an object");
    return;
  }
  if ("noop" in expr) {
    if (!allowNoop) add(path, "noop is only allowed in a function expression");
    return;
  }
  if ("const" in expr || "ref" in expr) return;
  const op = (expr as { op?: string }).op;
  if (!op) {
    add(path, "expression without an operator");
    return;
  }
  if (op === "if") {
    const conditional = expr as Extract<Expr, { op: "if" }>;
    walkExpr(conditional.cond, false, add, `${path}.cond`);
    walkExpr(conditional.then, allowNoop, add, `${path}.then`);
    walkExpr(conditional.else, allowNoop, add, `${path}.else`);
    return;
  }
  const binary = expr as { left?: Expr; right?: Expr; of?: Expr | Expr[] };
  if (binary.left) walkExpr(binary.left, false, add, `${path}.left`);
  if (binary.right) walkExpr(binary.right, false, add, `${path}.right`);
  if (Array.isArray(binary.of)) {
    binary.of.forEach((item, index) =>
      walkExpr(item, false, add, `${path}.of.${index}`),
    );
  } else if (binary.of) {
    walkExpr(binary.of, false, add, `${path}.of`);
  }
}
