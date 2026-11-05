import type { LogicDocument } from "./types";

type Row = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function printSet(action: Record<string, unknown>): string {
  const set = action.set as Record<string, any>;
  const code = set.value.code;
  const ref = set.target.ref;
  let suffix = "";
  if (set.ack === true && set.forward === "always") {
    suffix = ', { ack: true, forward: "always" }';
  } else if (set.ack === true) {
    suffix = ", true";
  } else if (set.forward === "always") {
    suffix = ', { forward: "always" }';
  }
  return `set(${JSON.stringify(ref)}, (${code}\n)${suffix})`;
}

function printAction(action: unknown): string {
  if (isRecord(action) && "set" in action) {
    return printSet(action);
  }
  if (isRecord(action) && "goto" in action) {
    return `goto(${JSON.stringify(action.goto)})`;
  }
  if (isRecord(action) && "log" in action) {
    const log = action.log as Record<string, unknown>;
    return `log(${JSON.stringify(log.text)}${log.level === "warn" ? ', "warn"' : ""})`;
  }
  throw new Error("migrate: unknown action");
}

export function printActions(actions: unknown): string | undefined {
  if (!Array.isArray(actions) || actions.length === 0) {
    return undefined;
  }
  return actions.map(printAction).join("\n");
}

function migrateRow(row: Row): Row {
  const next: Row = { ...row };
  const code = printActions(row.do);
  const hasGotoAction =
    Array.isArray(row.do) && row.do.some((a) => isRecord(a) && "goto" in a);

  delete next.do;
  if (row.goto !== undefined) {
    if (code) {
      next.mode = "function";
      next.do = {
        code: hasGotoAction
          ? code
          : `${code}\ngoto(${JSON.stringify(row.goto)})`,
      };
      delete next.goto;
      delete next.continue;
    } else {
      next.mode = "goto";
      delete next.continue;
    }
  } else if (code) {
    next.mode = "function";
    next.do = { code };
  } else if (row.continue === true) {
    next.mode = "function";
  } else {
    next.mode = "goto";
  }
  return next;
}

function migrateState(state: Row): Row {
  const next: Row = { ...state };
  for (const key of ["enter", "exit"] as const) {
    if (key in state) {
      const code = printActions(state[key]);
      if (code) {
        next[key] = { code };
      } else {
        delete next[key];
      }
    }
  }
  if (Array.isArray(state.on)) {
    next.on = state.on.map((row) => migrateRow(row as Row));
  }
  return next;
}

function migrateLogic(logic: Row): Row {
  const next: Row = { ...logic };
  if (logic.kind === "function" || !isRecord(logic.states)) {
    return next;
  }
  next.states = Object.fromEntries(
    Object.entries(logic.states).map(([name, state]) => [
      name,
      isRecord(state) ? migrateState(state) : state,
    ]),
  );
  if (isRecord(logic.all) && Array.isArray(logic.all.on)) {
    next.all = {
      ...logic.all,
      on: logic.all.on.map((row) => migrateRow(row as Row)),
    };
  }
  return next;
}

function migrateTemplate(template: Row): Row {
  return { ...template, logic: migrateLogic(template.logic as Row) };
}

export function migrateActionDocument(doc: unknown): LogicDocument {
  if (!isRecord(doc)) {
    throw new Error("migrate: document must be an object");
  }
  const next: Record<string, unknown> = { ...doc, version: 3 };
  if (Array.isArray(doc.logics)) {
    next.logics = doc.logics.map((logic) => migrateLogic(logic as Row));
  }
  if (Array.isArray(doc.templates)) {
    next.templates = doc.templates.map((template) =>
      migrateTemplate(template as Row),
    );
  }
  return next as unknown as LogicDocument;
}
