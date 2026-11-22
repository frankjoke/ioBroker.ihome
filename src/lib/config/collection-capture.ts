import { extractRefCalls } from "$logic/expr-code";
import type { LogicDef } from "$logic/types";
import type { Template } from "$lib/types/display";

export interface StateSuggestion {
  id: string;
  /** Logic names that read or write it. */
  usedBy: string[];
  /** The logic output: a new state the collection should own by default. */
  ownedByDefault: boolean;
}

/** Local copy: `$logic/subscriptions` pulls the node-only runtime into the SPA. */
function collectRefs(value: unknown, out: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectRefs(item, out);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "ref" && typeof item === "string") out.push(item);
      else collectRefs(item, out);
    }
  }
}

/** Every state the selected logics touch, with the output marked for ownership. */
export function suggestCollectionStates(
  logics: LogicDef[],
  resolveVariable: (name: string) => string | undefined,
): StateSuggestion[] {
  const rows = new Map<string, StateSuggestion>();
  const add = (ref: string, name: string, owned: boolean): void => {
    if (!ref || ref.startsWith("$")) return;
    const id = ref.includes(".") ? ref : resolveVariable(ref);
    if (!id || id.startsWith("$") || !id.includes(".")) return;
    const row = rows.get(id) ?? {
      id,
      usedBy: [],
      ownedByDefault: false,
    };
    if (!row.usedBy.includes(name)) row.usedBy.push(name);
    row.ownedByDefault = row.ownedByDefault || owned;
    rows.set(id, row);
  };

  for (const logic of logics) {
    const refs: string[] = [];
    collectRefs(logic, refs);
    const outputRef =
      logic.output?.scope === "state" ? logic.output.ref : undefined;
    for (const ref of refs) add(ref, logic.name, ref === outputRef);
    const calls =
      logic.kind === "function" ? extractRefCalls(logic.expr?.code ?? "") : [];
    for (const call of calls) {
      add(call.name, logic.name, false);
    }
  }

  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** A tile copy without the provenance that only the live template has. */
export function collectionTileDefinition(template: Template): Template {
  const copy = JSON.parse(JSON.stringify(template)) as Template & {
    builtin?: boolean;
    basedOn?: string;
  };
  delete copy.builtin;
  delete copy.basedOn;
  return copy;
}
