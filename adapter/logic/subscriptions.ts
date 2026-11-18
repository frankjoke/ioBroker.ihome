import { extractRefs } from "./expr-code";
import { forEachExpression } from "./runtime";
import { isRecord, logicHasErrors, validateLogicDocument } from "./validate";
import type { LogicDef, LogicDocument } from "./types";

/** The subscription set a logic document asks for, split for the adapter's two
 *  broker calls. Everything a logic no longer names (deleted logic, removed
 *  variable, disabled logic) lands in `remove`, so the broker stops sending it
 *  and no timer or handler keeps running for it. */
export interface SubscriptionDiff {
  own: { add: string[]; remove: string[] };
  foreign: { add: string[]; remove: string[] };
}

export type ResolveVariable = (
  name: string,
) =>
  | { kind: "const"; value: unknown }
  | { kind: "state"; stateId: string }
  | undefined;

/** Every `ref` value in a definition (inputs, outputs, rows). */
export function collectRefs(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      if (key === "ref" && typeof item === "string") out.push(item);
      else collectRefs(item, out);
    }
  }
}

/** A ref to a broker state: an id, or a variable name resolving to one. */
function stateId(
  ref: string,
  resolveVariable: ResolveVariable | undefined,
): string | undefined {
  if (ref.includes(".")) return ref;
  const variable = resolveVariable?.(ref);
  return variable?.kind === "state" ? variable.stateId : undefined;
}

function outputTarget(
  def: LogicDef,
  ownFrom: string | undefined,
  resolveVariable: ResolveVariable | undefined,
): string | undefined {
  const output = def.output;
  if (!output) return undefined;
  if (output.scope === "logic") {
    return ownFrom ? `${ownFrom}.Logic.${def.id}` : undefined;
  }
  if (output.scope !== "state") return undefined;
  return stateId(output.ref, resolveVariable) ?? output.ref;
}

/**
 * The broker states a document names, without building an engine. The adapter
 * uses this to subscribe and warm before the engine runs. A logic that fails
 * validation contributes nothing; a compile failure is only visible to the
 * engine and leaves its refs subscribed until the next save.
 */
export function logicSubscriptions(
  doc: LogicDocument,
  resolveVariable?: ResolveVariable,
  ownFrom?: string,
): string[] {
  const issues = validateLogicDocument(doc);
  const declaredMemory = new Set<string>(
    (doc.memory ?? []).map((entry) => entry.name),
  );
  for (const def of doc.logics) {
    if (def.output?.scope === "memory") {
      declaredMemory.add(def.output.name ?? def.id);
    }
  }
  const ids = new Set<string>();
  for (const def of doc.logics) {
    if (def.enabled === false) continue;
    if (logicHasErrors(issues, def.id)) continue;
    const inputNames = new Set(Object.keys(def.inputs ?? {}));
    const refs: string[] = [];
    collectRefs(def, refs);
    forEachExpression(def, (expr) => refs.push(...extractRefs(expr.code)));
    for (const ref of refs) {
      if (inputNames.has(ref) || declaredMemory.has(ref)) continue;
      if (ref.startsWith("$logic.")) continue;
      const id = stateId(ref, resolveVariable);
      if (id) ids.add(id);
    }
    for (const input of Object.values(def.inputs ?? {})) {
      if (input.from.type !== "state") continue;
      for (const ref of [input.from.ref, ...(input.from.refs ?? [])]) {
        if (ref.startsWith("$logic.")) continue;
        const id = stateId(ref, resolveVariable);
        if (id) ids.add(id);
      }
    }
    const target = outputTarget(def, ownFrom, resolveVariable);
    if (target) ids.add(target);
  }
  return [...ids];
}

export function subscriptionDiff(
  previous: string[],
  next: string[],
  namespace: string,
): SubscriptionDiff {
  const before = new Set(previous);
  const after = new Set(next);
  const isOwn = (id: string) => id.startsWith(`${namespace}.`);
  const diff: SubscriptionDiff = {
    own: { add: [], remove: [] },
    foreign: { add: [], remove: [] },
  };
  for (const id of after) {
    if (!before.has(id)) {
      (isOwn(id) ? diff.own.add : diff.foreign.add).push(id);
    }
  }
  for (const id of before) {
    if (!after.has(id)) {
      (isOwn(id) ? diff.own.remove : diff.foreign.remove).push(id);
    }
  }
  return diff;
}
